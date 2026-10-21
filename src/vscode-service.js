import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {z} from 'zod';
import {dataDir,writeRecord,acquireLock,Capture,reviewSummary} from './browser-review.js';
import {saveAttempt,recordVerdict,getProblem} from './problem-history.js';
import {queueHint,queueDiscussion,readHint,hintSummary,assistHistory} from './hint-review.js';
import {browserRequest} from './browser-mailbox.js';
import {gridUrl,sameProblem} from './grid-url.js';
import {readProblemDisplay} from './problem-display.js';
import {runSample,latestSample,saveSampleRequest,finishSample} from './sample-runner.js';
import {readSubmission,createSubmission,updateSubmission} from './oj-submissions.js';
import {readGridTestRun,createGridTestRun,updateGridTestRun} from './grid-test-runs.js';
const sha=value=>createHash('sha256').update(value).digest('hex');
const normalize=code=>code.replace(/\r\n/g,'\n').trim();
// VS Code can supply file, untitled, WSL/SSH, and other virtual document URIs.
// This value is only hashed as a local context key; it is never opened as a path or URL.
const DocumentUri=z.string().max(3000).refine(s=>/^[a-z][a-z0-9+.-]*:/i.test(s)&&!/[\u0000-\u001f\u007f]/.test(s),'当前 C++ 文档地址无效；请从 VS Code 打开一个 C++ 文件。');
const Source=z.object({uri:DocumentUri,name:z.string().max(500),code:z.string().min(5).max(100000),version:z.number().int().nonnegative(),selectedCode:z.string().max(8000).default(''),diagnostics:z.string().max(12000).default('')}).strict();
const uuid=value=>{const h=sha(value).slice(0,32);return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;};
const validUri=uri=>DocumentUri.parse(uri);
const contextPath=uri=>path.join(dataDir(),'vscode-context',sha(validUri(uri))+'.json');
const topicKey=url=>{const parsed=gridUrl(url,{kind:'problem'});if(!parsed)throw new Error('题目地址无效。');return parsed.key;};
async function readContext(uri){try{return JSON.parse(await fs.readFile(contextPath(uri),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;return {uri};}}
async function getContext(uri,problemUrl){
  const record=await readContext(uri);
  if(record.topics)return {uri,...record.topics[problemUrl?topicKey(problemUrl):record.activeProblem]};
  if(problemUrl&&record.binding&&!sameProblem(problemUrl,record.binding.problemUrl))return {uri};
  return record;
}
async function patchContext(uri,patch,problemUrl){
  const file=contextPath(uri);await fs.mkdir(path.dirname(file),{recursive:true});let release;
  for(let i=0;i<100&&!release;i++){release=await acquireLock(file+'.lock');if(!release)await new Promise(r=>setTimeout(r,10));}
  if(!release)throw new Error('本题设置正在保存，请重试。');
  try{
    const raw=await readContext(uri),target=problemUrl||patch.binding?.problemUrl||raw.binding?.problemUrl;
    if(!target&&!raw.topics){const result={...raw,...patch,uri};await writeRecord(file,result);return result;}
    const topics={...raw.topics};
    if(raw.binding&&!raw.topics){const {uri:_uri,...legacy}=raw;topics[topicKey(raw.binding.problemUrl)]=legacy;}
    const key=target?topicKey(target):raw.activeProblem,previous=topics[key]||{};
    if(patch.uiStamp&&previous.uiStamp&&(patch.uiStamp.startedAt<previous.uiStamp.startedAt||patch.uiStamp.session===previous.uiStamp.session&&patch.uiStamp.revision<=previous.uiStamp.revision))return {uri,...previous};
    const context={...previous,...patch};
    topics[key]=context;await writeRecord(file,{uri,activeProblem:patch.binding||!raw.activeProblem?key:raw.activeProblem,topics});return {uri,...context};
  }finally{await release();}
}
export function createVscodeService({browser=browserRequest,launchReport=async()=>{},launchHint=async()=>{},currentProblem=readProblemDisplay,sampleRunner=runSample}={}){
  const activeExecutions=new Set(),finalizingTests=new Set();
  async function resolveContext(uri,expectedProblemUrl){
    const display=await currentProblem();
    if(display.connected&&display.url){
      if(expectedProblemUrl&&!sameProblem(expectedProblemUrl,display.url))throw new Error('浏览器已切换题目，请从三个按钮重新打开当前题目的教练；本次没有混入旧题。');
      if(display.status!=='ready')throw new Error(display.error||'当前题面正在读取，请稍后再保存。');
      const context=await getContext(uri,display.url),binding={problemUrl:display.url,tabId:display.tabId,...(context.binding?.submissionTabId===undefined?{}:{submissionTabId:context.binding.submissionTabId})};
      return patchContext(uri,{binding,problem:display.page},display.url);
    }
    return getContext(uri,expectedProblemUrl);
  }
  async function capture(source,{allowCached=false,problemUrl}={}){
    const context=await resolveContext(source.uri,problemUrl),binding=context.binding;
    if(!binding)throw new Error('请先将当前 C++ 文件关联到 Chrome 中的编程网格 IDE 页。');
    let web,warning='';
    try{web=await browser('capture',{...binding,code:source.code},allowCached?1200:6000);}catch(e){
      if(!allowCached||!context.problem||e.code==='PROBLEM_CHANGED'||/关联|另一题|切换|不属于|核对/.test(e.message))throw e;
      warning='本轮未读到最新网页评测：'+e.message;web={problem:context.problem,submission:null};
    }
    const page=web.problem;
    if(!page?.problemMatches||!sameProblem(page.problemUrl,binding.problemUrl)||!page.problem)throw new Error('网页题面与当前文件绑定不一致，本次未保存。');
    if(!warning)await patchContext(source.uri,{problem:page},binding.problemUrl);
    const submission=web.submission;
    if(submission&&(!submission.problemMatches||!sameProblem(submission.problemUrl,binding.problemUrl)))throw new Error('提交详情属于另一题，本次未保存。');
    const codeHash=sha(normalize(source.code)),matching=Boolean(submission?.submittedCode&&!submission.sourceTruncated&&sha(normalize(submission.submittedCode))===codeHash),officialMatch=Boolean(matching&&submission?.submissionId);
    const site=web.runtime||{},read=(field,max=20000)=>typeof site[field]==='string'?site[field].slice(0,max):'';
    const siteInput=read('input'),siteStatus=read('status',1000),siteText=read('text'),siteOutput=read('output'),siteHints=read('hints'),siteError=read('error');
    const siteEvidence=[siteStatus&&`网页运行区显示状态（不能确认对应当前 VS Code 代码）：${siteStatus}`,siteText,siteOutput&&`网页执行输出（不能确认对应当前 VS Code 代码）：\n${siteOutput}`].filter(Boolean).join('\n\n');
    const runtime={input:siteInput,output:'',hints:[warning,siteHints&&`网页提示信息（代码关联未确认）：\n${siteHints}`].filter(Boolean).join('\n').slice(0,20000),error:[source.diagnostics&&'VS Code 当前静态诊断（不是运行输出）：\n'+source.diagnostics,siteError&&`网页错误信息（代码关联未确认）：\n${siteError}`].filter(Boolean).join('\n').slice(0,20000),status:siteStatus?`网页显示：${siteStatus}（代码关联未确认）`.slice(0,1000):'unknown',text:siteEvidence.slice(0,20000)};
    let judgeEvidence={status:'unknown',source:'none',codeHash,runtimeAssociation:'uncertain'};
    if(submission){
      const verdict=submission.verdict||{};
      runtime.hints=[runtime.hints,verdict.text].filter(Boolean).join('\n').slice(0,20000);runtime.error=[runtime.error,submission.runtime?.error].filter(Boolean).join('\n').slice(0,20000);
      if(officialMatch)runtime.status=verdict.status||'unknown';
      runtime.text=[runtime.text,`编程网格${submission.submissionId?'正式提交 '+submission.submissionId:'网页当前结果（可能是测试执行）'}：${verdict.text||'未知状态'}。${officialMatch?'已核对正式提交编号与源码；网页运行区内容仍可能属于另一次运行。':matching?'网页源码与当前 VS Code 代码相同，但没有正式提交编号，不能当成正式评测结果。':'尚未与本次 VS Code 代码匹配，不能把该状态当成当前代码的结果。'}`].filter(Boolean).join('\n\n').slice(0,20000);
      if(officialMatch&&['AC','WA','CE','RE','TLE','MLE','PE','OLE'].includes(verdict.status))judgeEvidence={status:verdict.status,source:'matching-submission',codeHash,runtimeAssociation:'matching-judgment'};
    }
    const u=gridUrl(binding.problemUrl,{kind:'problem'}),url='https://'+u.key+'ide.do';
    const sample=await latestSample(url,source.code);
    if(sample?.result){const r=sample.result;runtime.input=r.input;runtime.output=r.actual.slice(0,20000);runtime.error=[runtime.error,r.compiler,r.stderr].filter(Boolean).join('\n').slice(0,20000);runtime.text=[siteInput&&`网页当前输入框（不能确认已用于网页运行）：\n${siteInput}`,runtime.text,'本机样例测试：'+r.status+'；runtime.input/output 为本机样例输入与实际输出，不代表网站 AC。'].filter(Boolean).join('\n\n').slice(0,20000);if(!officialMatch)runtime.status=`本机样例：${r.status}`.slice(0,1000);}
    const result=Capture.parse({url,title:page.title,problem:page.problem,code:source.code,standard:context.standard||'c++17',runtime});
    return {capture:result,browserUrl:binding.problemUrl,missingSections:page.missingSections||[],judgment:judgeEvidence,submission,matching,warning};
  }
  async function executionCapture(source,problemUrl){
    const context=await resolveContext(source.uri,problemUrl),binding=context.binding,page=context.problem;
    if(!binding||!page?.problemMatches||!sameProblem(page.problemUrl,binding.problemUrl)||!page.problem)throw new Error('题目连接或题面尚未准备好，请在 Chrome 打开当前题目的 IDE。');
    const u=gridUrl(binding.problemUrl,{kind:'problem'});
    const capture=Capture.parse({url:'https://'+u.key+'ide.do',title:page.title,problem:page.problem,code:source.code,standard:context.standard||'c++17',runtime:{}});
    return {capture,browserUrl:binding.problemUrl};
  }
  function background(id,task){
    activeExecutions.add(id);
    void task.catch(()=>{}).finally(()=>activeExecutions.delete(id));
  }
  async function recentExecution(folder,url){
    const directory=path.join(dataDir(),folder);
    let names;try{names=await fs.readdir(directory);}catch(error){if(error.code==='ENOENT')return null;throw error;}
    const matches=[];
    for(const name of names.filter(name=>/^[a-f0-9]{64}\.json$/.test(name))){
      try{
        const record=JSON.parse(await fs.readFile(path.join(directory,name),'utf8'));
        if(record.capture?.url===url)matches.push(record);
      }catch{}
    }
    matches.sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||'')));
    return matches[0]||null;
  }
  async function importVerdict(selected){
    const s=selected.submission;if(!selected.matching||!s?.submissionId||selected.judgment.status==='unknown')return;
    const {capture}=selected,id=uuid(capture.url+':'+s.submissionId+':'+selected.judgment.codeHash),eventId=uuid('submission:'+id);
    const problem=await getProblem(capture.url);
    if(problem.attempts.some(a=>a.submissionId===id&&a.verdict?.status===s.verdict.status))return;
    const saved=await saveAttempt(capture,{kind:'submission',submissionId:id,eventId,origin:'programminggrid',note:`核对编程网格提交 ${s.submissionId}：${s.url}`});
    const verdict={source:'judge-dom',status:s.verdict.status,text:s.verdict.text,observedAt:s.observedAt||new Date().toISOString(),sourceUrl:s.url,platform:'programminggrid'};
    await recordVerdict(capture.url,id,verdict,capture.runtime);
    if(verdict.status==='AC')await saveAttempt(capture,{kind:'ac',eventId:uuid('ac:'+id),submissionId:id,verdict,origin:'programminggrid'});
    return saved;
  }
  function officialResultCapture(capture,submission){
    const raw=String(submission.runtime?.text||'');
    return {...capture,runtime:{...capture.runtime,status:submission.verdict.status,text:[`编程网格正式提交 ${submission.submissionId}：${submission.platformResult||submission.verdict.status}`,raw&&`网站返回的评测与提示（原文）：\n${raw}`].filter(Boolean).join('\n\n').slice(0,20000),error:String(submission.runtime?.error||'').slice(0,20000)}};
  }
  async function finishGridTest(job,value){
    if(value.submission&&!value.submission.websiteReplyRaw&&job.submission?.websiteReplyRaw)value.submission.websiteReplyRaw=job.submission.websiteReplyRaw;
    const submission=value.submission,final=Boolean(submission&&!['pending','unknown'].includes(submission.verdict?.status||'unknown'));
    const updated=await updateGridTestRun(job,{...value,status:job.saved?'complete':final?'result_received':'pending',websiteReplyAt:new Date().toISOString()});
    if(final&&!job.saved&&submission?.detailChecked)void persistGridTest(updated);
    return updated;
  }
  async function persistGridTest(job){
    if(finalizingTests.has(job.id))return;
    finalizingTests.add(job.id);
    const submission=job.submission;
    const raw=String(submission.runtime?.text||'').slice(0,20000),result=String(submission.platformResult||submission.verdict.status||'unknown');
    const runtime={input:job.input,output:'',hints:'编程网格网站测试执行；返回内容可能混合程序输出、编译信息和平台提示，不代表正式提交 AC。',error:String(submission.runtime?.error||'').slice(0,20000),status:`网站测试执行：${result}（非正式提交）`.slice(0,1000),text:[`网站测试执行编号 ${submission.submissionId}；源码 ${job.codeHash}。`,raw||'网站未提供可显示的输出或提示。'].join('\n\n').slice(0,20000)};
    try{
      const saved=await saveAttempt({...job.capture,runtime},{eventId:uuid('grid-test-result:'+job.id),origin:'grid_test_result',note:`编程网格网站测试执行：${result}`});
      let workerError;try{await launchReport();}catch(error){workerError=error.message;}
      await updateGridTestRun(await readGridTestRun(job.id),{status:'complete',saved:reviewSummary(saved),workerError});
    }catch(error){await updateGridTestRun(await readGridTestRun(job.id),{status:'result_received',workerError:'网站结果已收到，但本机保存失败：'+error.message});}
    finally{finalizingTests.delete(job.id);}
  }
  async function runGridTest(job){
    try{
      const value=await browser('test',{jobId:job.id,problemUrl:job.browserUrl,code:job.capture.code,language:'C++',input:job.input},30000,{onProgress:async browserStage=>{
        const current=await readGridTestRun(job.id);if(current.status==='sending')await updateGridTestRun(current,{browserStage});
      }});
      const timed={...value,responseMs:Date.now()-Date.parse(job.dispatchedAt)};
      if(value.error)await updateGridTestRun(await readGridTestRun(job.id),{...timed,status:value.uncertain?'uncertain':'rejected',message:value.error,websiteReplyAt:new Date().toISOString()});
      else await finishGridTest(await readGridTestRun(job.id),timed);
    }catch(error){await updateGridTestRun(await readGridTestRun(job.id),{status:error.code==='PROBLEM_CHANGED'?'rejected':'uncertain',error:error.message,message:error.code==='PROBLEM_CHANGED'?'未发送到网站：'+error.message:'网站测试是否已执行尚未确认；请先在编程网格查看记录，不会自动重复发送。'});}
  }
  async function runSubmission(job){
    try{
      const value=await browser('submit',{jobId:job.id,problemUrl:job.browserUrl,code:job.capture.code,language:job.language},30000,{onProgress:async browserStage=>{
        const current=await readSubmission(job.id);if(current.status==='sending')await updateSubmission(current,{browserStage});
      }});
      const updated=await updateSubmission(await readSubmission(job.id),{...value,status:value.error?value.uncertain?'uncertain':'rejected':'submitted',...(value.error?{message:value.error}:{}),websiteReplyAt:new Date().toISOString(),responseMs:Date.now()-Date.parse(job.dispatchedAt)});
      void (async()=>{
        let workerError;
        const s=value.submission;
        if(s?.submittedCode?.replace(/\r\n/g,'\n').trim()===job.capture.code.replace(/\r\n/g,'\n').trim()&&s.verdict?.status&&!['pending','unknown'].includes(s.verdict.status)){
          try{await importVerdict({capture:officialResultCapture(job.capture,s),submission:s,matching:true,judgment:{status:s.verdict.status,codeHash:sha(normalize(job.capture.code))}});}catch(error){workerError=error.message;}
        }
        try{await launchReport();}catch(error){workerError=error.message;}
        if(workerError)await updateSubmission(await readSubmission(updated.id),{workerError});
      })().catch(()=>{});
    }catch(error){await updateSubmission(await readSubmission(job.id),{status:error.code==='PROBLEM_CHANGED'?'rejected':'uncertain',error:error.message,message:error.code==='PROBLEM_CHANGED'?'未发送到网站：'+error.message:'未确认是否提交成功，请先刷新/查看记录，不会自动重试。'});}
  }
  return {async handle(message){
    const type=message.type;
    if(type==='status')return {ready:true,dataDirectory:dataDir(),version:'0.2.5',platform:'programminggrid-vscode'};
    if(type==='problem_display')return currentProblem();
    if(type==='judge_history'){
      const context=await getContext(validUri(message.uri),message.problemUrl);
      if(!context.binding)return {type:'judge_history'};
      const parsed=gridUrl(context.binding.problemUrl,{kind:'problem'}),url='https://'+parsed.key+'ide.do';
      const [test,submission]=await Promise.all([recentExecution('grid-tests',url),recentExecution('oj-submissions',url)]);
      return {type:'judge_history',test:test&&{...test,capture:undefined},submission:submission&&{...submission,capture:undefined}};
    }
    if(type==='sample_history'){
      const source=Source.parse(message.source),context=await resolveContext(source.uri,message.problemUrl);
      const u=context.binding?.problemUrl;if(!u)return {type:'sample_result'};
      const prior=await latestSample('https://'+gridUrl(u,{kind:'problem'}).key+'ide.do',source.code);return {type:'sample_result',result:prior?.result,codeHash:prior?.codeHash};
    }
    if(type==='browser_tabs')return {tabs:await browser('tabs')};
    if(type==='oj_prepare'){
      const context=await resolveContext(validUri(message.uri),message.problemUrl);if(!context.binding)throw new Error('请先打开题目。');
      const info=await browser('prepare_submit',{problemUrl:context.binding.problemUrl},10000);if(info.error)throw new Error(info.error);return {type:'oj_prepared',...info};
    }
    if(type==='oj_status'){
      const job=await readSubmission(message.id);
      if(job.status==='sending'&&!activeExecutions.has(job.id))return {type:'oj_result',...await updateSubmission(job,{status:'uncertain',message:'本机连接中断；请核对网站提交记录，不会自动重复发送。'}),capture:undefined};
      return {type:'oj_result',...job,capture:undefined};
    }
    if(type==='oj_refresh'){
      const job=await readSubmission(message.id),value=await browser('refresh_submission',{problemUrl:job.browserUrl||job.capture.url,receipt:job.receipt||{},code:job.capture.code},24000);
      if(value.error){const updated=await updateSubmission(job,{detailError:value.error});return {type:'oj_result',...updated,capture:undefined};}
      if(value.submission&&!value.submission.websiteReplyRaw&&job.submission?.websiteReplyRaw)value.submission.websiteReplyRaw=job.submission.websiteReplyRaw;
      const updated=await updateSubmission(job,{...value,status:'submitted'}),s=value.submission;
      if(s?.submittedCode?.replace(/\r\n/g,'\n').trim()===job.capture.code.replace(/\r\n/g,'\n').trim()&&!s.sourceTruncated&&s.verdict?.status&&!['pending','unknown'].includes(s.verdict.status)){
        const result=officialResultCapture(job.capture,s);
        void importVerdict({capture:result,submission:s,matching:true,judgment:{status:s.verdict.status,codeHash:sha(normalize(job.capture.code))}}).then(()=>launchReport()).catch(async e=>{await updateSubmission(await readSubmission(job.id),{workerError:e.message}).catch(()=>{});});
      }
      return {type:'oj_result',id:job.id,...updated,submission:s,capture:undefined};
    }
    if(type==='grid_test_status'){
      const job=await readGridTestRun(message.id);
      if(job.status==='sending'&&!activeExecutions.has(job.id))return {type:'grid_test_result',...await updateGridTestRun(job,{status:'uncertain',message:'本机连接中断；请核对网站测试记录，不会自动重复发送。'}),capture:undefined};
      return {type:'grid_test_result',...job,capture:undefined};
    }
    if(type==='grid_test_refresh'){
      const job=await readGridTestRun(message.id);
      if(['uncertain','rejected'].includes(job.status)||job.submission?.detailLoaded&&!['pending','unknown'].includes(job.submission.verdict?.status||'unknown'))return {type:'grid_test_result',...job,capture:undefined};
      if(!job.receipt?.solutionId)throw new Error('网站尚未返回本次测试编号，请稍后再刷新。');
      const value=await browser('refresh_test',{problemUrl:job.browserUrl,receipt:job.receipt,code:job.capture.code,input:job.input},24000);
      if(value.error){const updated=await updateGridTestRun(job,{detailError:value.error});if(job.status==='result_received'&&!job.saved)void persistGridTest(updated);return {type:'grid_test_result',...updated,capture:undefined};}
      return {type:'grid_test_result',...await finishGridTest(job,value),capture:undefined};
    }
    if(type==='context_get')return resolveContext(validUri(message.uri),message.problemUrl);
    if(type==='context_bind'){
      const uri=validUri(message.uri),b=message.binding;
      if(!b||!gridUrl(b.problemUrl,{kind:'problem'})||!Number.isInteger(b.tabId))throw new Error('请选择有效的编程网格 IDE 标签。');
      const binding={problemUrl:b.problemUrl,tabId:b.tabId,...(b.submissionTabId===undefined?{}:{submissionTabId:b.submissionTabId})};
      const web=await browser('capture',binding);if(!web.problem?.problemMatches||!sameProblem(web.problem.problemUrl,binding.problemUrl))throw new Error('所选网页与题目不对应。');
      return patchContext(uri,{binding,problem:web.problem});
    }
    if(type==='ui_save'){
      const ui=z.object({question:z.string().max(2000),chatOpen:z.boolean()}).strict().parse(message.ui);
      const uiStamp=message.uiStamp===undefined?undefined:z.object({session:z.string().uuid(),startedAt:z.number().int().nonnegative(),revision:z.number().int().positive()}).strict().parse(message.uiStamp);
      await patchContext(validUri(message.uri),{ui,...(uiStamp?{uiStamp}:{})},message.problemUrl);return {saved:true};
    }
    if(type==='hint_status'){if(!/^[a-f0-9]{64}$/.test(message.id||''))throw new Error('任务编号无效。');return {type:'hint_status',...hintSummary(await readHint(message.id))};}
    if(!['quick_save','hint_open','hint','discuss','assist_history','run_sample','grid_test','oj_submit'].includes(type))throw new Error('不支持的 VS Code 操作。');
    const source=Source.parse(message.source);
    if(type==='discuss'&&(typeof message.question!=='string'||!message.question.trim()||message.question.length>2000))throw new Error('请输入 1—2000 字的问题。');
    if(message.purpose!==undefined&&(type!=='discuss'||!['solution','discussion'].includes(message.purpose)))throw new Error('无效的问答用途。');
    const selected=['grid_test','oj_submit'].includes(type)?await executionCapture(source,message.problemUrl):await capture(source,{allowCached:['quick_save','hint_open','assist_history'].includes(type),problemUrl:message.problemUrl});
    if(type==='assist_history')return {type:'assist_history',context:selected,...await assistHistory(selected.capture.url)};
    if(!/^[-a-f0-9]{36}$/i.test(message.actionId||''))throw new Error('保存事件编号无效。');
    if(type==='grid_test'){
      const input=z.string().max(20000).parse(message.input);
      let job=await createGridTestRun(selected.capture,selected.browserUrl,message.actionId,input);
      if(job.status!=='prepared')return {type:'grid_test_result',...job,capture:undefined};
      job=await updateGridTestRun(job,{status:'sending',dispatchedAt:new Date().toISOString()});
      background(job.id,runGridTest(job));
      void saveAttempt({...selected.capture,runtime:{input,output:'',hints:'网站测试执行请求，等待编程网格返回结果。',error:'',status:'pending',text:''}},{eventId:message.actionId,origin:'grid_test_request',note:'从 VS Code 发起编程网格网站测试执行'}).catch(()=>{});
      return {type:'grid_test_result',...job,capture:undefined};
    }
    if(type==='oj_submit'){
      if(typeof message.language!=='string'||message.language.length>100)throw new Error('请选择 C++ 编译器。');
      let job=await createSubmission(selected.capture,message.actionId,message.language);
      if(job.status!=='prepared')return {type:'oj_result',...job,capture:undefined,message:job.message||'本次提交已处理，不会自动重复发送。'};
      job=await updateSubmission(job,{status:'sending',browserUrl:selected.browserUrl,dispatchedAt:new Date().toISOString()});
      background(job.id,runSubmission(job));
      void saveAttempt(selected.capture,{eventId:message.actionId,origin:'oj_submit_request',note:'主动提交到编程网格；记录 '+job.id}).catch(()=>{});
      return {type:'oj_result',...job,capture:undefined};
    }
    if(type==='run_sample'){
      if(!selected.capture.problem.sampleOutput)throw new Error('题面没有提供可对照的样例输出，本次未运行。');
      const request=await saveSampleRequest(selected.capture,message.actionId);let complete=request;
      if(request.status!=='complete')complete=await finishSample(request,await sampleRunner(request.capture));
      const r=complete.result,labels={passed:'样例输出一致',whitespace:'仅空白不同，需核对格式',wrong_answer:'与样例输出不同',compile_error:'编译失败',runtime_error:'运行错误',timeout:'超过时间限制',output_limit:'输出超过限制'};
      const runCapture={...request.capture,runtime:{input:r.input,output:r.actual.slice(0,20000),error:[r.compiler,r.stderr].filter(Boolean).join('\n').slice(0,20000),hints:'本机运行题目样例；不代表网站 AC。',status:labels[r.status]||r.status,text:'本机样例测试：'+r.status+'；源码 '+complete.codeHash+'；耗时 '+r.durationMs+' ms'}};
      const saved=await saveAttempt(runCapture,{eventId:message.actionId,origin:'sample_run',note:'本机样例测试：'+r.status});
      let workerError;try{await launchReport();}catch(e){workerError=e.message;}return {type:'sample_result',id:complete.id,title:request.capture.title,codeHash:complete.codeHash,result:r,...reviewSummary(saved),workerError};
    }
    const saved=await saveAttempt(selected.capture,{eventId:message.actionId,origin:type==='discuss'?'discussion':type==='hint'?'hint_request':type==='hint_open'?'hint_open':'quick_save',note:`${type==='hint_open'?'打开提示时自动保存；':''}VS Code：${source.name}，文档版本 ${source.version}`});
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
