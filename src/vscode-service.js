import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {z} from 'zod';
import {dataDir,writeRecord,acquireLock,Capture,reviewSummary} from './browser-review.js';
import {saveAttempt,recordVerdict,getProblem} from './problem-history.js';
import {queueHint,queueDiscussion,readHint,hintSummary,assistHistory} from './hint-review.js';
import {browserRequest} from './browser-mailbox.js';
import {openJudgeUrl,sameProblem} from './openjudge-url.js';
import {readProblemDisplay} from './problem-display.js';
import {runSample,latestSample,latestLocalRun,saveSampleRequest,finishSample} from './sample-runner.js';
import {readSubmission,createSubmission,updateSubmission} from './oj-submissions.js';
import {readProblemLibrary,libraryProblem} from './problem-library.js';
import {readProblemStatistics} from './problem-statistics.js';
import {reportDirectory} from './report-location.js';
import {readModelSettings,readModelCatalog,saveModelSettings} from './model-settings.js';
import {listVersions,readVersion} from './version-history.js';
const sha=value=>createHash('sha256').update(value).digest('hex');
const normalize=code=>code.replace(/\r\n/g,'\n').trim();
const Source=z.object({uri:z.string().max(3000).refine(s=>/^(?:file|untitled):/.test(s)),name:z.string().max(500),code:z.string().min(5).max(100000),version:z.number().int().nonnegative(),selectedCode:z.string().max(8000).default(''),diagnostics:z.string().max(12000).default('')}).strict();
const TestSpec=z.object({input:z.string().max(20000),expected:z.string().max(20000).optional(),runTimeout:z.number().int().min(20).max(60000).default(2500),memoryLimitMiB:z.number().int().min(16).max(2048).default(256)}).strict();
const uuid=value=>{const h=sha(value).slice(0,32);return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;};
const validUri=uri=>Source.shape.uri.parse(uri);
const contextPath=uri=>path.join(dataDir(),'vscode-context',sha(validUri(uri))+'.json');
const topicKey=url=>{const parsed=openJudgeUrl(url,{kind:'problem'});if(!parsed)throw new Error('题目地址无效。');return parsed.key;};
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
export function createVscodeService({browser=browserRequest,launchReport=async()=>{},launchHint=async()=>{},currentProblem=readProblemDisplay,sampleRunner=runSample,statisticsReader=readProblemStatistics,modelCatalog=readModelCatalog}={}){
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
    if(!binding)throw new Error('请先将当前 C++ 文件关联到一个 Chrome 中的 OpenJudge 题目页。');
    let web,warning='';
    try{web=await browser('capture',binding,allowCached?1200:6000);}catch(e){
      if(!allowCached||!context.problem||e.code==='PROBLEM_CHANGED'||/关联|另一题|切换|不属于|核对/.test(e.message))throw e;
      warning='本轮未读到最新网页评测：'+e.message;web={problem:context.problem,submission:null};
    }
    const page=web.problem;
    if(!page?.problemMatches||!sameProblem(page.problemUrl,binding.problemUrl)||!page.problem)throw new Error('网页题面与当前文件绑定不一致，本次未保存。');
    if(!warning)await patchContext(source.uri,{problem:page},binding.problemUrl);
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
    const sample=await latestLocalRun(url,source.code);
    if(sample?.result){const r=sample.result,custom=r.testKind==='custom';runtime.input=r.input;runtime.output=r.actual.slice(0,20000);runtime.error=[runtime.error,r.compiler,r.stderr].filter(Boolean).join('\n').slice(0,20000);runtime.text+='\n'+(custom?'本机自定义测试':'本机样例测试')+'：'+r.status+'；不代表网站 AC。';if(custom)runtime.hints=[runtime.hints,r.expectedProvided===false?'自定义测试未提供预期输出。':'用户自定义的预期输出（不是题目样例）：\n'+r.expected.slice(0,8000)+(r.expected.length>8000?'\n（已截断）':'')].filter(Boolean).join('\n').slice(0,20000);}
    const result=Capture.parse({url,title:page.title,problem:page.problem,code:source.code,standard:context.standard||'c++17',runtime});
    return {capture:result,browserUrl:binding.problemUrl,missingSections:page.missingSections||[],judgment:judgeEvidence,submission,matching,warning};
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
  async function acceptSubmission(job,value){
    let updated=await updateSubmission(job,{...value,status:value.error?'uncertain':'submitted'});const s=value.submission;
    if(s?.problemMatches&&sameProblem(s.problemUrl,job.capture.url)&&s.submittedCode&&!s.sourceTruncated&&normalize(s.submittedCode)===normalize(job.capture.code)){
      const result={...job.capture,runtime:{...job.capture.runtime,status:s.verdict.status,text:'OpenJudge 提交 '+s.submissionId+'：'+s.verdict.text,error:s.runtime?.error||''}};
      try{await importVerdict({capture:result,submission:s,matching:true,judgment:{status:s.verdict.status,codeHash:sha(normalize(job.capture.code))}});await launchReport();}catch(e){updated.workerError=e.message;}
      if(s.verdict.status==='AC'&&!updated.submitPageClosed&&Number.isInteger(updated.receipt?.submissionTabId)){
        try{const closed=await browser('close_submission_tab',{problemUrl:job.browserUrl||job.capture.url,tabId:updated.receipt.submissionTabId,jobId:job.id,code:job.capture.code,verdict:'AC'},6000);updated=await updateSubmission(updated,{submitPageClosed:Boolean(closed.closed),closeReason:closed.reason||'',closeError:''});}
        catch(e){updated=await updateSubmission(updated,{closeError:e.message});}
      }
    }
    return updated;
  }
  return {async handle(message){
    const type=message.type;
    if(type==='model_settings_get'){
      const settings=await readModelSettings();try{return {type:'model_settings',settings,catalog:await modelCatalog({refresh:message.refresh===true})};}catch(error){return {type:'model_settings',settings,error:error.message};}
    }
    if(type==='model_settings_save')return {type:'model_settings_saved',settings:await saveModelSettings(message.settings,{catalog:await modelCatalog({refresh:true})})};
    if(type==='versions_list')return {type:'versions_list',...await listVersions(message.problemUrl)};
    if(type==='version_read')return {type:'version_read',...await readVersion(message.problemUrl,message.eventId,message.currentCode)};
    if(type==='status')return {ready:true,dataDirectory:dataDir(),reportDirectory:await reportDirectory(),version:'2.4.1',platform:'openjudge-vscode'};
    if(type==='problem_display')return currentProblem();
    if(type==='problem_completion'){
      const parsed=openJudgeUrl(message.url,{kind:'problem'});if(!parsed)throw new Error('题目地址无效。');
      const problem=await getProblem(parsed.url),events=problem.attempts||[],accepted=events.filter(a=>a.kind==='ac'&&a.verdict?.source==='judge-dom'&&a.verdict.status==='AC'&&events.some(s=>s.kind==='submission'&&s.submissionId===a.submissionId&&s.codeHash===a.codeHash&&s.verdict?.source==='judge-dom'&&s.verdict.status==='AC')).at(-1);
      return {type:'problem_completion',problemUrl:message.url,accepted:Boolean(accepted),verified:Boolean(accepted),latestSavedVersionAccepted:Boolean(accepted&&events.at(-1)?.codeHash===accepted.codeHash),acceptedAt:accepted?.savedAt,submissionUrl:accepted?.verdict?.sourceUrl};
    }
    if(type==='problem_statistics'){
      const problem=openJudgeUrl(message.url,{kind:'problem'});if(!problem)throw new Error('仅支持百练 / NOI 的具体题目。');
      return {type:'problem_statistics',...await statisticsReader(problem.url)};
    }
    if(type==='library_list')return {type:'problem_library',...await readProblemLibrary()};
    if(type==='library_open'){
      const item=await libraryProblem(message.key),display=await currentProblem();
      const opened=await browser('navigate_problem',{problemUrl:item.url,tabId:display.connected?display.tabId:undefined},10000);
      return {type:'library_opened',key:item.key,...opened};
    }
    if(type==='sample_history'){
      const source=Source.parse(message.source),context=await resolveContext(source.uri,message.problemUrl);
      const u=context.binding?.problemUrl;if(!u)return {type:'sample_result'};
      const prior=await latestSample('http://'+openJudgeUrl(u,{kind:'problem'}).key,source.code);return {type:'sample_result',result:prior?.result,codeHash:prior?.codeHash};
    }
    if(type==='browser_tabs')return {tabs:await browser('tabs')};
    if(type==='oj_prepare'){
      const context=await resolveContext(validUri(message.uri),message.problemUrl);if(!context.binding)throw new Error('请先打开题目。');
      const info=await browser('prepare_submit',{problemUrl:context.binding.problemUrl},10000);if(info.error)throw new Error(info.error);return {type:'oj_prepared',...info};
    }
    if(type==='oj_refresh'){
      const job=await readSubmission(message.id),value=await browser('refresh_submission',{problemUrl:job.browserUrl||job.capture.url,receipt:job.receipt||{},code:job.capture.code},24000);
      if(value.error)throw new Error(value.error);const updated=await acceptSubmission(job,value),s=value.submission;
      return {type:'oj_result',id:job.id,...updated,submission:s,capture:undefined};
    }
    if(type==='context_get')return resolveContext(validUri(message.uri),message.problemUrl);
    if(type==='context_bind'){
      const uri=validUri(message.uri),b=message.binding;
      if(!b||!openJudgeUrl(b.problemUrl,{kind:'problem'})||!Number.isInteger(b.tabId)||b.submissionTabId!==undefined&&!Number.isInteger(b.submissionTabId))throw new Error('请选择有效的 OpenJudge 题目标签。');
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
    if(!['quick_save','hint_open','hint','discuss','assist_history','run_sample','oj_submit'].includes(type))throw new Error('不支持的 VS Code 操作。');
    const source=Source.parse(message.source);
    const testSpec=type==='run_sample'&&message.testSpec!==undefined?TestSpec.parse(message.testSpec):undefined;
    if(type==='discuss'&&(typeof message.question!=='string'||!message.question.trim()||message.question.length>2000))throw new Error('请输入 1—2000 字的问题。');
    if(message.purpose!==undefined&&(type!=='discuss'||!['solution','discussion'].includes(message.purpose)))throw new Error('无效的问答用途。');
    const selected=await capture(source,{allowCached:['quick_save','hint_open','assist_history'].includes(type),problemUrl:message.problemUrl});
    if(type==='assist_history')return {type:'assist_history',context:selected,...await assistHistory(selected.capture.url)};
    if(!/^[-a-f0-9]{36}$/i.test(message.actionId||''))throw new Error('保存事件编号无效。');
    if(type==='oj_submit'){
      if(typeof message.language!=='string'||message.language.length>100)throw new Error('请选择 C++ 编译器。');
      let job=await createSubmission(selected.capture,message.actionId,message.language);
      if(job.status!=='prepared')return {type:'oj_result',...job,capture:undefined,message:job.message||'本次提交已处理，不会自动重复发送。'};
      job=await updateSubmission(job,{status:'sending',browserUrl:selected.browserUrl});
      await saveAttempt(selected.capture,{eventId:message.actionId,origin:'oj_submit_request',note:'主动提交到 OJ；记录 '+job.id});
      try{
        const value=await browser('submit',{jobId:job.id,problemUrl:job.browserUrl,code:job.capture.code,language:job.language},30000);
        job=await acceptSubmission(job,value);
      }catch(error){job=await updateSubmission(job,{status:'uncertain',error:error.message,message:'未确认是否提交成功，请先刷新/查看记录，不会自动重试。'});}
      let workerError;try{await launchReport();}catch(e){workerError=e.message;}return {type:'oj_result',...job,capture:undefined,workerError};
    }
    if(type==='run_sample'){
      if(!testSpec&&!selected.capture.problem.sampleOutput)throw new Error('题面没有提供可对照的样例输出，本次未运行。可使用自定义测试。');
      const request=await saveSampleRequest(selected.capture,message.actionId,testSpec);let complete=request;
      await saveAttempt(selected.capture,{eventId:message.actionId,origin:testSpec?'custom_run_request':'sample_run_request',note:'测试前保存完整代码；'+(testSpec?'自定义输入':'题目样例')});
      if(request.status!=='complete')complete=await finishSample(request,await sampleRunner(request.capture,testSpec?{...testSpec,expected:testSpec.expected??null,testKind:'custom'}:undefined));
      const r=complete.result,labels={passed:'样例输出一致',whitespace:'仅空白不同，需核对格式',wrong_answer:'WA · 答案错误',compile_error:'CE · 编译错误',runtime_error:'RE · 运行错误',timeout:'TLE · 超过本机时间限制',memory_limit:'MLE · 达到本机内存限制',output_limit:'OLE · 输出超限',compile_timeout:'编译超时，程序未运行',compile_output_limit:'编译输出超限，程序未运行',runner_error:'本机测试环境错误'};
      const label=testSpec?'本机自定义测试':'本机样例测试';
      const runCapture={...request.capture,runtime:{input:r.input,output:r.actual.slice(0,20000),error:[r.compiler,r.stderr].filter(Boolean).join('\n').slice(0,20000),hints:label+'；不代表网站 AC。',status:labels[r.status]||r.status,text:label+'：'+r.status+'；源码 '+complete.codeHash+'；耗时 '+r.durationMs+' ms'+(r.peakMemoryBytes?'；峰值提交内存 '+Math.ceil(r.peakMemoryBytes/1024)+' KiB':'')+(r.limits?'；本机限制 '+JSON.stringify(r.limits):'')}};
      const saved=await saveAttempt(runCapture,{eventId:uuid(message.actionId+':result'),origin:testSpec?'custom_run':'sample_run',note:label+'：'+r.status});
      let workerError;try{await launchReport();}catch(e){workerError=e.message;}return {type:'sample_result',id:complete.id,title:request.capture.title,codeHash:complete.codeHash,result:r,...reviewSummary(saved),workerError,snapshot:{problemUrl:selected.capture.url,title:selected.capture.title,sourceName:source.name,documentVersion:source.version,savedAt:request.createdAt,codeHash:complete.codeHash}};
    }
    const saved=await saveAttempt(selected.capture,{eventId:message.actionId,origin:type==='discuss'?'discussion':type==='hint'?'hint_request':type==='hint_open'?'hint_open':'quick_save',note:`${type==='hint_open'?'打开提示时自动保存；':''}VS Code：${source.name}，文档版本 ${source.version}`});
    let hint,hintError,workerError,hintWorkerError;
    try{
      await importVerdict(selected);
      if(type==='hint')hint=hintSummary(await queueHint(saved.id,{judgeEvidence:selected.judgment,eventId:saved.eventId,attemptNumber:saved.attemptNumber,requestedAt:message.requestedAt,force:message.force===true}));
      if(type==='discuss')hint=hintSummary(await queueDiscussion(saved.id,{question:message.question,purpose:message.purpose,selectedCode:source.selectedCode,eventId:saved.eventId,attemptNumber:saved.attemptNumber,requestedAt:message.requestedAt}));
    }catch(e){hintError=e.message;}
    const launches=await Promise.allSettled([launchReport(),hint?.status==='queued'?launchHint(hint.kind||'hint'):Promise.resolve()]);
    if(launches[0].status==='rejected')workerError=launches[0].reason.message;
    if(launches[1].status==='rejected')hintWorkerError=launches[1].reason.message;
    return {type:'saved',...reviewSummary(saved),eventId:saved.eventId,cached:Boolean(saved.cached),hint,hintError,workerError,hintWorkerError,context:selected,warning:selected.warning,snapshot:{problemUrl:selected.capture.url,title:selected.capture.title,sourceName:source.name,documentVersion:source.version,savedAt:new Date().toISOString(),codeHash:saved.codeHash}};
  }};
}
