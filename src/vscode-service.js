import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {z} from 'zod';
import {dataDir,writeRecord,acquireLock,Capture,reviewSummary} from './browser-review.js';
import {saveAttempt,recordVerdict,getProblem} from './problem-history.js';
import {queueHint,queueDiscussion,readHint,hintSummary,assistHistory} from './hint-review.js';
import {browserRequest} from './browser-mailbox.js';
import {openJudgeUrl,sameProblem} from './openjudge-url.js';
const sha=value=>createHash('sha256').update(value).digest('hex');
const normalize=code=>code.replace(/\r\n/g,'\n').trim();
const Source=z.object({uri:z.string().max(3000).refine(s=>/^(?:file|untitled):/.test(s)),name:z.string().max(500),code:z.string().min(5).max(100000),version:z.number().int().nonnegative(),selectedCode:z.string().max(8000).default(''),diagnostics:z.string().max(12000).default('')}).strict();
const uuid=value=>{const h=sha(value).slice(0,32);return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;};
const validUri=uri=>Source.shape.uri.parse(uri);
const contextPath=uri=>path.join(dataDir(),'vscode-context',sha(validUri(uri))+'.json');
async function getContext(uri){try{return JSON.parse(await fs.readFile(contextPath(uri),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;return {uri};}}
async function patchContext(uri,patch){
  const file=contextPath(uri);await fs.mkdir(path.dirname(file),{recursive:true});let release;
  for(let i=0;i<100&&!release;i++){release=await acquireLock(file+'.lock');if(!release)await new Promise(r=>setTimeout(r,10));}
  if(!release)throw new Error('本题设置正在保存，请重试。');
  try{const context={...await getContext(uri),...patch,uri};await writeRecord(file,context);return context;}finally{await release();}
}
export function createVscodeService({browser=browserRequest,launchReport=async()=>{},launchHint=async()=>{}}={}){
  async function capture(source,{allowCached=false}={}){
    const context=await getContext(source.uri),binding=context.binding;
    if(!binding)throw new Error('请先将当前 C++ 文件关联到一个 Chrome 中的 OpenJudge 题目页。');
    let web,warning='';
    try{web=await browser('capture',binding,allowCached?1200:6000);}catch(e){
      if(!allowCached||!context.problem||e.code==='PROBLEM_CHANGED'||/关联|另一题|切换|不属于|核对/.test(e.message))throw e;
      warning='本轮未读到最新网页评测：'+e.message;web={problem:context.problem,submission:null};
    }
    const page=web.problem;
    if(!page?.problemMatches||!sameProblem(page.problemUrl,binding.problemUrl)||!page.problem)throw new Error('网页题面与当前文件绑定不一致，本次未保存。');
    if(!warning)await patchContext(source.uri,{problem:page});
    const submission=web.submission;
    if(submission&&(!submission.problemMatches||!sameProblem(submission.problemUrl,binding.problemUrl)))throw new Error('提交详情属于另一题，本次未保存。');
    const codeHash=sha(normalize(source.code)),matching=Boolean(submission?.submittedCode&&!submission.sourceTruncated&&sha(normalize(submission.submittedCode))===codeHash);
    const runtime={input:'',output:'',hints:warning,error:source.diagnostics?'VS Code 当前静态诊断（不是运行输出）：\n'+source.diagnostics:'',status:'unknown',text:''};
    let judgeEvidence={status:'unknown',source:'none',codeHash,runtimeAssociation:'uncertain'};
    if(submission){
      const verdict=submission.verdict||{};
      runtime.hints=[runtime.hints,verdict.text].filter(Boolean).join('\n');runtime.error=[runtime.error,submission.runtime?.error].filter(Boolean).join('\n').slice(0,20000);
      runtime.status=matching?verdict.status||'unknown':'unknown';runtime.text=`OpenJudge 提交 ${submission.submissionId||'未知编号'}：${verdict.text||'未知状态'}。${matching?'已核对提交源码，与本次 VS Code 完整代码相同。':'尚未与本次 VS Code 代码匹配，不能把该状态当成当前代码的结果。'}`;
      if(matching&&['AC','WA','CE','RE','TLE','MLE','PE','OLE'].includes(verdict.status))judgeEvidence={status:verdict.status,source:'matching-submission',codeHash,runtimeAssociation:'matching-judgment'};
    }
    const u=openJudgeUrl(binding.problemUrl,{kind:'problem'}),url='http://'+u.key;
    const result=Capture.parse({url,title:page.title,problem:page.problem,code:source.code,standard:context.standard||'c++17',runtime});
    return {capture:result,missingSections:page.missingSections||[],judgment:judgeEvidence,submission,matching,warning};
  }
  async function importVerdict(selected){
    const s=selected.submission;if(!selected.matching||!s?.submissionId||selected.judgment.status==='unknown')return;
    const {capture}=selected,id=uuid(capture.url+':'+s.submissionId+':'+selected.judgment.codeHash),eventId=uuid('submission:'+id);
    const problem=await getProblem(capture.url);
    if(problem.attempts.some(a=>a.submissionId===id&&a.verdict?.status===s.verdict.status))return;
    const saved=await saveAttempt(capture,{kind:'submission',submissionId:id,eventId,origin:'openjudge',note:`只读核对 OpenJudge 提交 ${s.submissionId}：${s.url}`});
    const verdict={source:'judge-dom',status:s.verdict.status,text:s.verdict.text,observedAt:s.observedAt||new Date().toISOString(),sourceUrl:s.url,platform:'openjudge'};
    await recordVerdict(capture.url,id,verdict,capture.runtime);
    if(verdict.status==='AC')await saveAttempt(capture,{kind:'ac',eventId:uuid('ac:'+id),submissionId:id,verdict,origin:'openjudge'});
    return saved;
  }
  return {async handle(message){
    const type=message.type;
    if(type==='status')return {ready:true,dataDirectory:dataDir(),version:'2.0.0',platform:'openjudge-vscode'};
    if(type==='browser_tabs')return {tabs:await browser('tabs')};
    if(type==='context_get')return getContext(validUri(message.uri));
    if(type==='context_bind'){
      const uri=validUri(message.uri),b=message.binding;
      if(!b||!openJudgeUrl(b.problemUrl,{kind:'problem'})||!Number.isInteger(b.tabId)||b.submissionTabId!==undefined&&!Number.isInteger(b.submissionTabId))throw new Error('请选择有效的 OpenJudge 题目标签。');
      const binding={problemUrl:b.problemUrl,tabId:b.tabId,...(b.submissionTabId===undefined?{}:{submissionTabId:b.submissionTabId})};
      const web=await browser('capture',binding);if(!web.problem?.problemMatches||!sameProblem(web.problem.problemUrl,binding.problemUrl))throw new Error('所选网页与题目不对应。');
      return patchContext(uri,{binding,problem:web.problem});
    }
    if(type==='ui_save'){
      const ui=z.object({question:z.string().max(2000),chatOpen:z.boolean()}).strict().parse(message.ui);
      await patchContext(validUri(message.uri),{ui});return {saved:true};
    }
    if(type==='hint_status'){if(!/^[a-f0-9]{64}$/.test(message.id||''))throw new Error('任务编号无效。');return {type:'hint_status',...hintSummary(await readHint(message.id))};}
    if(!['quick_save','hint','discuss','assist_history'].includes(type))throw new Error('不支持的 VS Code 操作。');
    const source=Source.parse(message.source);
    if(type==='discuss'&&(typeof message.question!=='string'||!message.question.trim()||message.question.length>2000))throw new Error('请输入 1—2000 字的问题。');
    if(message.purpose!==undefined&&(type!=='discuss'||!['solution','discussion'].includes(message.purpose)))throw new Error('无效的问答用途。');
    const selected=await capture(source,{allowCached:['quick_save','assist_history'].includes(type)});
    if(type==='assist_history')return {type:'assist_history',context:selected,...await assistHistory(selected.capture.url)};
    if(!/^[-a-f0-9]{36}$/i.test(message.actionId||''))throw new Error('保存事件编号无效。');
    const saved=await saveAttempt(selected.capture,{eventId:message.actionId,origin:type==='discuss'?'discussion':type==='hint'?'hint_request':'quick_save',note:`VS Code：${source.name}，文档版本 ${source.version}`});
    let hint,hintError,workerError,hintWorkerError;
    try{
      await importVerdict(selected);
      if(type==='hint')hint=hintSummary(await queueHint(saved.id,{judgeEvidence:selected.judgment,eventId:saved.eventId,attemptNumber:saved.attemptNumber,requestedAt:message.requestedAt}));
      if(type==='discuss')hint=hintSummary(await queueDiscussion(saved.id,{question:message.question,purpose:message.purpose,selectedCode:source.selectedCode,eventId:saved.eventId,attemptNumber:saved.attemptNumber,requestedAt:message.requestedAt}));
    }catch(e){hintError=e.message;}
    const launches=await Promise.allSettled([launchReport(),hint?.status==='queued'?launchHint(hint.kind||'hint'):Promise.resolve()]);
    if(launches[0].status==='rejected')workerError=launches[0].reason.message;
    if(launches[1].status==='rejected')hintWorkerError=launches[1].reason.message;
    return {type:'saved',...reviewSummary(saved),eventId:saved.eventId,cached:Boolean(saved.cached),hint,hintError,workerError,hintWorkerError,context:selected,warning:selected.warning};
  }};
}
