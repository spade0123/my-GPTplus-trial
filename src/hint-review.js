import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {z} from 'zod';
import {ROOT,compilerCheck} from './core.js';
import {dataDir,acquireLock,writeRecord,readReview,captureFromRecord,processAlive,recordAssistance,formatProblem} from './browser-review.js';
import {getProblem} from './problem-history.js';
import {runHintModel,runDiscussionModel} from './model-runner.js';
import {formatHintReport,formatStreamHint,HINT_REVISION} from './hint-format.js';
import {hintAnswerContext} from './hint-context.js';
import {ensureWorker} from './review-queue.js';
import '../extension/instant-hints.js';

const dir=()=>path.join(dataDir(),'hints');
const queueDir=kind=>kind?path.join(dir(),'queues',kind):dir();
const file=id=>{if(!/^[a-f0-9]{64}$/.test(id))throw new Error('无效的提示 ID。');return path.join(dir(),`${id}.json`);};
const skipped='当前这份代码已有对应的 AC 证据，已保存并安排后台学习分析，本次不再生成排错提示。';
async function update(id,change){
  await fs.mkdir(dir(),{recursive:true});let release;
  for(let i=0;i<100;i++){release=await acquireLock(file(id)+'.save.lock');if(release)break;await new Promise(r=>setTimeout(r,10));}
  if(!release)throw new Error('提示任务正在保存，请稍后重试。');
  try{
    let prior;try{prior=JSON.parse(await fs.readFile(file(id),'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
    const record=await change(prior);await writeRecord(file(id),record);return record;
  }finally{await release();}
}
async function judgment(record,evidence){
  const problem=await getProblem(record.url);
  const accepted=problem.attempts.find(a=>a.codeHash===record.codeHash&&a.verdict?.source==='judge-dom'&&a.verdict.status==='AC');
  if(accepted)return {status:'AC',source:'saved-submission',codeHash:record.codeHash,runtimeAssociation:'uncertain'};
  if(evidence?.codeHash===record.codeHash&&['matching-submission','site-solution'].includes(evidence.source)&&['AC','WA','CE','RE','TLE','MLE','PE','OLE'].includes(evidence.status))return {status:evidence.status,source:evidence.source,codeHash:record.codeHash,runtimeAssociation:evidence.runtimeAssociation==='matching-judgment'?'matching-judgment':'uncertain'};
  return {status:'unknown',source:'none',runtimeAssociation:'uncertain'};
}
export function hintSummary(record){
  return {id:record.id,eventId:record.eventId,snapshotId:record.snapshotId,kind:record.kind||'hint',purpose:record.purpose,question:record.question,instantAnalysis:record.instantAnalysis,partialAnalysis:record.partialAnalysis,firstTokenAt:record.firstTokenAt,title:record.title,sourceUrl:record.sourceUrl,codeHash:record.codeHash,createdAt:record.createdAt,status:record.status,judgment:record.judgment,message:record.message,error:record.error,compiler:record.compiler,...(record.status==='complete'?{analysis:record.analysis}:{})};
}
export async function queueHint(id,{judgeEvidence,eventId=randomUUID(),attemptNumber,requestedAt}={}){
  const source=await readReview(id),current=await judgment(source,judgeEvidence);
  const instantAnalysis=globalThis.PkuInstantHints.generate(await captureFromRecord(source),current).markdown;
  const result=await update(id,prior=>{
    const base=prior||{schemaVersion:1,kind:'hint',id,snapshotId:id,title:source.title,sourceUrl:source.url,codeHash:source.codeHash,instantAnalysis,createdAt:new Date().toISOString()};
    if(current.status==='AC')return {...base,status:'skipped',judgment:current,message:skipped};
    if(prior&&(['queued','running'].includes(prior.status)||(prior.status==='complete'&&prior.hintRevision===HINT_REVISION)))return prior;
    const previousReports=prior?.status==='complete'?[...(prior.previousReports||[]),{hintRevision:prior.hintRevision||1,completedAt:prior.completedAt,report:prior.report,analysis:prior.analysis}]:prior?.previousReports;
    const previousRuns=prior?.status==='failed'?[...(prior.previousRuns||[]),{startedAt:prior.startedAt,error:prior.error,partialAnalysis:prior.partialAnalysis}]:prior?.previousRuns;
    const result={...base,status:'queued',queuedAt:new Date().toISOString(),judgment:current,instantAnalysis,...(previousReports?{previousReports}:{}),...(previousRuns?{previousRuns}:{})};
    for(const field of ['error','analysis','report','partialAnalysis','firstTokenAt','outputUpdatedAt','completedAt','startedAt','workerPid','compiler'])delete result[field];
    return result;
  });
  await recordAssistance(id,{type:'hint',jobId:id,eventId,attemptNumber,requestedAt:Number.isFinite(Date.parse(requestedAt))?requestedAt:new Date().toISOString(),codeHash:source.codeHash});
  return result;
}
export async function queueDiscussion(snapshotId,{question,purpose='discussion',selectedCode='',eventId=randomUUID(),attemptNumber,requestedAt}={}){
  if(!['discussion','solution'].includes(purpose))throw new Error('无效的问答用途。');
  if(typeof question!=='string'||!question.trim()||question.length>2000||typeof selectedCode!=='string'||selectedCode.length>8000)throw new Error('请填写 1—2000 字的问题；选中片段最多 8000 字符。');
  const source=await readReview(snapshotId),id=createHash('sha256').update(`${snapshotId}:${eventId}`).digest('hex');
  const createdAt=Number.isFinite(Date.parse(requestedAt))?requestedAt:new Date().toISOString();
  const instantAnalysis=purpose==='solution'?'已保存本次题目与完整代码；完整参考解答将在后台生成。':globalThis.PkuInstantHints.discuss(await captureFromRecord(source),question,selectedCode).markdown;
  const result=await update(id,prior=>{
    if(prior&&(prior.purpose||'discussion')!==purpose)throw new Error('同一问答事件不能改作另一用途。');
    return prior?(prior.status==='failed'?{...prior,status:'queued',error:undefined,queuedAt:new Date().toISOString()}:prior):{schemaVersion:1,kind:'discussion',purpose,id,snapshotId,title:source.title,sourceUrl:source.url,codeHash:source.codeHash,createdAt,queuedAt:new Date().toISOString(),eventId,question:question.trim(),selectedCode,instantAnalysis,status:'queued',judgment:{status:'unknown',runtimeAssociation:'uncertain'}};
  });
  await recordAssistance(snapshotId,{type:'discussion',purpose,jobId:id,eventId,attemptNumber,requestedAt:createdAt,codeHash:source.codeHash,question:question.trim()});
  return result;
}
async function assistanceHistory(url,{beforeEventId,types=['discussion'],purpose,limit=30}={}){
  const problem=await getProblem(url),before=beforeEventId?problem.attempts.find(a=>a.id===beforeEventId)?.number:Infinity;
  const attempts=problem.attempts.filter(a=>['discussion','hint_request'].includes(a.origin)&&a.number<(before??Infinity)),byEvent=new Map(attempts.map(a=>[a.id,a])),seen=new Set(),events=[];
  for(const attempt of attempts){
    if(seen.has(attempt.snapshotId))continue;seen.add(attempt.snapshotId);
    if(!/^[a-f0-9]{64}$/.test(attempt.snapshotId))continue;
    let assistance;
    try{assistance=JSON.parse(await fs.readFile(path.join(dataDir(),'assistance',attempt.snapshotId+'.json'),'utf8'));}catch(error){if(error.code==='ENOENT')continue;throw error;}
    for(const event of assistance?.events||[])if(types.includes(event.type)&&byEvent.has(event.eventId)){
      if(purpose!==undefined&&(event.purpose||'discussion')!==purpose)continue;
      events.push({...event,number:byEvent.get(event.eventId).number});
    }
  }
  events.sort((a,b)=>a.number-b.number);
  const entries=[];
  // Read only the requested replies, rather than truncating a mixed-purpose
  // snapshot index or loading all old answer bodies on every reopen.
  for(const event of events.slice(-limit))try{
    const job=await readHint(event.jobId);
    if(job.sourceUrl!==url||(purpose!==undefined&&(job.purpose||'discussion')!==purpose))continue;
    entries.push({...hintSummary(job),eventId:event.eventId,number:event.number});
  }catch{}
  return {url,total:events.length,entries};
}
export async function discussionHistory(url,{beforeEventId,limit=30,purpose='discussion'}={}){
  return assistanceHistory(url,{beforeEventId,limit,purpose});
}
export async function hintHistory(url){
  const [hints,solutions]=await Promise.all([assistanceHistory(url,{types:['hint'],limit:1}),assistanceHistory(url,{purpose:'solution',limit:1})]);
  return {url,total:hints.total+solutions.total,hint:hints.entries.at(-1)||null,solution:solutions.entries.at(-1)||null};
}
export async function assistHistory(url){
  const [hints,discussion]=await Promise.all([hintHistory(url),discussionHistory(url)]);
  return {url,hints,discussion};
}
export async function previousSolutionContext(capture,eventId){
  const history=await discussionHistory(capture.url,{beforeEventId:eventId,limit:30,purpose:'solution'});
  const statement=value=>(value.problem?formatProblem(value.problem):value.statement||'').replace(/\r\n/g,'\n').trim();
  for(const entry of [...history.entries].reverse())if(entry.purpose==='solution'&&entry.status==='complete'&&entry.analysis){
    try{
      const source=await readReview(entry.snapshotId);
      if(source.url!==capture.url||statement(source)!==statement(capture))continue;
      return {jobId:entry.id,source:'previous-generated-solution',standard:source.standard,codeHash:source.codeHash,code:source.code.slice(0,16000),codeTruncated:source.code.length>16000,answer:entry.analysis.slice(0,15000),notVerifiedAnswer:true};
    }catch{/* A damaged old snapshot must not block a fresh answer. */}
  }
  return null;
}
export async function readHint(id){
  let record=JSON.parse(await fs.readFile(file(id),'utf8'));
  if(record.kind!=='discussion'&&record.status!=='skipped'){
    const source=await readReview(record.snapshotId),current=await judgment(source,record.judgment);
    if(current.status==='AC')record=await update(id,prior=>({...prior,status:'skipped',judgment:current,message:skipped}));
  }
  return record;
}
async function streamReply(id,produce){
  let latest='',written='',timer,writing=Promise.resolve(),firstTokenAt;
  const flush=()=>{clearTimeout(timer);timer=null;if(latest===written)return writing;const text=latest;written=text;writing=writing.then(()=>update(id,prior=>prior.status==='skipped'?prior:{...prior,partialAnalysis:text,firstTokenAt:firstTokenAt||prior.firstTokenAt,outputUpdatedAt:new Date().toISOString()}));return writing;};
  try{return await produce(text=>{
    if(typeof text!=='string'||!text)return;latest=text.slice(0,15000);firstTokenAt||=new Date().toISOString();
    if(!written&&!timer)flush().catch(()=>{});else if(!timer)timer=setTimeout(()=>flush().catch(()=>{}),150);
  });}finally{await flush();}
}
export async function processHint(id,{model=runHintModel,discussionModel=runDiscussionModel,compile=compilerCheck}={}){
  const initial=await readHint(id);if(['complete','skipped'].includes(initial.status))return initial;
  const release=await acquireLock(file(id)+'.lock');if(!release)throw new Error('这份提示正在后台生成。');
  try{
    const current=await readHint(id);if(['complete','skipped'].includes(current.status))return current;
    await update(id,prior=>prior.status==='skipped'?prior:{...prior,status:'running',workerPid:process.pid,startedAt:new Date().toISOString()});
    const source=await readReview(current.snapshotId),capture=await captureFromRecord(source);
    // General discussion needs the current source, not a compiler startup and
    // a recursive review/debug evidence tree before every short question.
    const diagnostics=current.kind==='discussion'?{status:'not_requested',ranProgram:false}:await compile(capture.code,capture.standard,{timeoutMs:1500});
    await update(id,prior=>prior.status==='skipped'?prior:{...prior,compiler:diagnostics,...(current.kind==='discussion'?{}:{instantAnalysis:globalThis.PkuInstantHints.generate(capture,prior.judgment,diagnostics).markdown})});
    const ready=await readHint(id);if(ready.status==='skipped')return ready;
    const evidence={task:current.kind==='discussion'?'code_discussion':'debug_hint',capture,diagnostics,...(current.kind==='discussion'?{}:{answerContext:await hintAnswerContext(capture)}),judgment:ready.judgment,runtimeAssociation:ready.judgment.runtimeAssociation};
    let result;
    if(current.kind==='discussion'){
      const history=current.purpose==='solution'?[]:(await discussionHistory(capture.url,{beforeEventId:current.eventId,limit:6})).entries;
      const previousSolution=current.purpose==='solution'?await previousSolutionContext(capture,current.eventId):undefined;
      const response=await streamReply(id,onDelta=>discussionModel({...evidence,purpose:current.purpose,question:current.question,selectedCode:current.selectedCode,history,previousSolution},{onDelta,...(current.purpose==='solution'?{timeoutMs:120000}:{})}));
      const report=z.object({answer:z.string().min(1).max(15000),next_step:z.string().max(3000)}).strict().parse(response);
      result={report,markdown:report.answer+(report.next_step?`\n\n**下一步：** ${report.next_step}`:'')};
    }else{
      const response=await streamReply(id,onDelta=>model(evidence,{onDelta}));
      result=typeof response?.markdown==='string'?formatStreamHint(response):formatHintReport(response,{answerContext:evidence.answerContext});
    }
    // An AC arriving during inference wins over the now-obsolete hint.
    await readHint(id);
    return update(id,prior=>prior.status==='skipped'?prior:{...prior,status:'complete',completedAt:new Date().toISOString(),compiler:diagnostics,report:result.report,analysis:result.markdown,...(current.kind==='discussion'?{}:{hintRevision:HINT_REVISION,answerContext:evidence.answerContext})});
  }catch(error){await update(id,prior=>prior.status==='skipped'?prior:{...prior,status:'failed',error:String(error.message).slice(0,2000)});throw error;}
  finally{await release();}
}
export async function queuedHints(){
  await fs.mkdir(dir(),{recursive:true});const jobs=[];
  for(const name of await fs.readdir(dir()))if(/^[a-f0-9]{64}\.json$/.test(name)){
    try{const job=JSON.parse(await fs.readFile(path.join(dir(),name),'utf8'));if(job.status==='queued'||(job.status==='running'&&!processAlive(job.workerPid)))jobs.push(job);}catch{}
  }
  return jobs.sort((a,b)=>String(a.queuedAt||a.createdAt).localeCompare(String(b.queuedAt||b.createdAt)));
}
export async function drainHints(options={}){
  const {kind,idleMs=0}=options,queue=queueDir(kind);
  await fs.mkdir(queue,{recursive:true});const release=await acquireLock(path.join(queue,'queue-worker.lock'));
  if(!release)return {busy:true,attempted:[]};const attempted=new Set();
  try{
    await fs.unlink(path.join(queue,'queue-worker.launch')).catch(()=>{});
    if(options.onStart)await options.onStart();
    let idleSince=Date.now();
    for(;;){
      const job=(await queuedHints()).find(j=>!attempted.has(j.id)&&(!kind||(j.kind||'hint')===kind));
      if(!job){if(Date.now()-idleSince>=idleMs)break;await new Promise(r=>setTimeout(r,250));continue;}
      attempted.add(job.id);try{await processHint(job.id,options);}catch{}idleSince=Date.now();
    }
  }finally{await release();}
  return {busy:false,attempted:[...attempted]};
}
export async function ensureHintWorker(kind){
  if(!kind)return Promise.all(['hint','discussion'].map(ensureHintWorker));
  if(!['hint','discussion'].includes(kind))throw new Error('无效的交流任务类型。');
  return ensureWorker({workerFile:path.join(ROOT,'src/hint-worker.js'),workerArgs:[kind],queueDir:queueDir(kind)});
}
