import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {createTwoFilesPatch} from 'diff';
import {Capture,Runtime,dataDir,acquireLock,writeRecord,readReview,saveCapture,assistanceContext} from './browser-review.js';
import {attemptContentKey,resultFingerprint,groupIdenticalAttempts} from './attempt-groups.js';

export const problemId=url=>createHash('sha256').update(new URL(url).origin+new URL(url).pathname).digest('hex');
const manifestPath=id=>path.join(dataDir(),'problems',`${id}.json`);
export async function problemManifests() {
  const dir=path.join(dataDir(),'problems');await fs.mkdir(dir,{recursive:true});const records=[];
  for(const name of await fs.readdir(dir))if(/^[a-f0-9]{64}\.json$/.test(name))try{records.push(JSON.parse(await fs.readFile(path.join(dir,name),'utf8')));}catch{}
  return records;
}
export async function getProblem(url,{importBefore=null}={}) {
  const id=problemId(url);
  try{return JSON.parse(await fs.readFile(manifestPath(id),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
  const attempts=[];
  // Import old snapshots once so upgrading does not erase the work already saved.
  await fs.mkdir(dataDir(),{recursive:true});
  for(const name of await fs.readdir(dataDir()))if(/^[a-f0-9]{64}\.json$/.test(name))try{
    const r=JSON.parse(await fs.readFile(path.join(dataDir(),name),'utf8'));
    if((r.url||r.sourceUrl)===url&&(!importBefore||r.createdAt<importBefore))attempts.push({id:`legacy-${r.id}`,snapshotId:r.id,codeHash:r.codeHash,savedAt:r.createdAt,kind:'legacy',note:'升级前保存的版本'});
  }catch{}
  attempts.sort((a,b)=>String(a.savedAt).localeCompare(String(b.savedAt)));attempts.forEach((a,i)=>{a.number=i+1;});
  return {schemaVersion:1,id,url,title:'',attempts,finalizations:[]};
}
export async function updateProblem(url,change,options={}) {
  await fs.mkdir(path.join(dataDir(),'problems'),{recursive:true});const file=manifestPath(problemId(url));let release;
  for(let i=0;i<100;i++){release=await acquireLock(`${file}.lock`);if(release)break;await new Promise(r=>setTimeout(r,10));}
  if(!release)throw new Error('题目时间线正在写入，请重试。');
  try{const current=await getProblem(url,options);const result=await change(current);await writeRecord(file,current);return result;}finally{await release();}
}
export async function saveAttempt(input,{kind='draft',note='',eventId=randomUUID(),submissionId=null,verdict=null,origin}={}) {
  if(!['draft','submission','ac'].includes(kind)||!/^[-a-f0-9]{36}$/i.test(eventId)||typeof note!=='string'||note.length>2000)throw new Error('无效的保存阶段、事件ID或调试备注。');
  const startedAt=new Date().toISOString(),capture=Capture.parse(input),snapshot=await saveCapture(capture);
  const result=await updateProblem(capture.url,problem=>{
    const existing=problem.attempts.find(a=>a.id===eventId);
    if(existing){if(existing.kind!==kind||existing.snapshotId!==snapshot.id||(existing.note||'')!==note||(existing.title&&existing.title!==capture.title)||existing.submissionId!==submissionId)throw new Error('保存事件已用于其他版本或内容。');return {attempt:existing,finalization:problem.finalizations.find(f=>f.id===eventId)};}
    if(kind==='ac') {
      const submitted=problem.attempts.find(a=>a.kind==='submission'&&a.submissionId===submissionId);
      if(!submitted||submitted.codeHash!==snapshot.codeHash||verdict?.source!=='judge-dom'||verdict.status!=='AC'||!verdict.text||!Number.isFinite(Date.parse(verdict.observedAt)))throw new Error('没有与当前代码匹配的提交和评测 AC 证据，不会自动归档。');
      const prior=problem.finalizations.find(f=>f.submissionId===submissionId);
      if(prior)return {attempt:problem.attempts.find(a=>a.id===prior.id),finalization:prior};
    }
    const attempt={id:eventId,number:problem.attempts.length+1,snapshotId:snapshot.id,codeHash:snapshot.codeHash,savedAt:new Date().toISOString(),title:capture.title,kind,note,submissionId,verdict,...(origin?{origin}:{})};
    if(kind==='ac') {
      const submitted=problem.attempts.find(a=>a.kind==='submission'&&a.submissionId===submissionId);
      attempt.resultRuntimeFile=submitted?.resultRuntimeFile;
      attempt.resultFingerprint=submitted?.resultFingerprint;
    }
    attempt.contentKey=attemptContentKey(attempt);
    problem.title=capture.title;problem.attempts.push(attempt);
    let finalization;
    if(kind==='ac') {finalization={id:eventId,submissionId,eventNumber:attempt.number,snapshotId:snapshot.id,createdAt:attempt.savedAt,status:'queued',verdict};problem.finalizations.push(finalization);}
    return {attempt,finalization};
  },{importBefore:startedAt});
  return {...snapshot,problemId:problemId(capture.url),attemptNumber:result.attempt.number,eventId:result.attempt.id,finalizationId:result.finalization?.id};
}
export async function recordVerdict(url,submissionId,verdict,runtime={}) {
  if(!/^[-a-f0-9]{36}$/i.test(submissionId||'')||verdict?.source!=='judge-dom'||!['AC','WA','CE','RE','TLE','MLE','PE','OLE'].includes(verdict.status))throw new Error('无效的提交评测证据。');
  return updateProblem(url,async problem=>{
    const event=problem.attempts.find(a=>a.kind==='submission'&&a.submissionId===submissionId);
    if(!event)throw new Error('找不到对应的提交快照。');
    const file=`run-snapshots/submission-${submissionId}.json`;
    await writeRecord(path.join(dataDir(),file),{submissionId,codeHash:event.codeHash,capturedAt:new Date().toISOString(),...Runtime.parse(runtime),verdict});
    Object.assign(event,{verdict,resultRuntimeFile:file,resultFingerprint:resultFingerprint(runtime)});
    if(!event.title)event.title=(await readReview(event.snapshotId)).title;
    event.contentKey=attemptContentKey(event);return event;
  });
}
const legacyKeys=new Map();
async function keyedAttempts(problem) {
  const records=new Map();
  return Promise.all(problem.attempts.map(async event=>{
    if(event.contentKey)return event;
    const cacheId=`${dataDir()}:${problem.id}:${event.id}`,signature=JSON.stringify(event),cached=legacyKeys.get(cacheId);
    if(cached?.signature===signature)return {...event,contentKey:cached.key};
    if(!records.has(event.snapshotId))records.set(event.snapshotId,readReview(event.snapshotId));
    const record=await records.get(event.snapshotId);
    const copy={...event,title:event.title||record.title};
    if(/^run-snapshots\/submission-[-a-f0-9]{36}\.json$/i.test(event.resultRuntimeFile||'')) {
      try{copy.resultFingerprint=resultFingerprint(JSON.parse(await fs.readFile(path.join(dataDir(),event.resultRuntimeFile),'utf8')));}
      catch {copy.resultFingerprint=event.resultRuntimeFile;} // Missing evidence must not merge with a different result.
    }
    const key=attemptContentKey(copy);
    if(legacyKeys.size>2000)legacyKeys.clear();
    legacyKeys.set(cacheId,{signature,key});
    return {...copy,contentKey:key};
  }));
}
export async function timeline(url,{throughNumber=Infinity,mergeDuplicates=true}={}) {
  const problem=await getProblem(url),attempts=[];
  const events=await keyedAttempts(problem);
  for(const event of events.filter(a=>a.number<=throughNumber)) {
    const record=await readReview(event.snapshotId);let runtime={};
    if(/^run-snapshots\/[a-f0-9]{64}\.json$/.test(record.runtimeFile||''))try{runtime=JSON.parse(await fs.readFile(path.join(dataDir(),record.runtimeFile),'utf8'));}catch{}
    if(/^run-snapshots\/submission-[-a-f0-9]{36}\.json$/i.test(event.resultRuntimeFile||''))try{runtime=JSON.parse(await fs.readFile(path.join(dataDir(),event.resultRuntimeFile),'utf8'));}catch{}
    attempts.push({...event,record,runtime,assistance:await assistanceContext(event.snapshotId)});
  }
  const groups=groupIdenticalAttempts(attempts);
  return {...problem,attempts:mergeDuplicates?groups:attempts,rawAttemptCount:attempts.length,mergedAttemptCount:groups.length};
}
export function codeDiff(before,after,beforeName='previous.cpp',afterName='current.cpp') {
  return createTwoFilesPatch(beforeName,afterName,before.replace(/\r\n/g,'\n')+'\n',after.replace(/\r\n/g,'\n')+'\n','','',{context:3});
}
export async function debugContext(url,snapshotId) {
  const problem=await getProblem(url),index=problem.attempts.findIndex(a=>a.snapshotId===snapshotId);
  if(index<0)return null;
  const current=problem.attempts[index],previous=index>0?problem.attempts[index-1]:null;
  const context={attemptNumber:current.number,note:current.note,kind:current.kind,recentNotes:problem.attempts.slice(Math.max(0,index-5),index+1).map(a=>({number:a.number,kind:a.kind,note:a.note,savedAt:a.savedAt}))};
  context.assistance=await assistanceContext(snapshotId);
  if(previous) {
    const a=await readReview(previous.snapshotId),b=await readReview(snapshotId);
    context.previous={number:previous.number,code:a.code,codeHash:a.codeHash,evidence:a.evidence||null,assistance:await assistanceContext(previous.snapshotId)};
    const diff=codeDiff(a.code,b.code);context.diff=diff.slice(0,40000);context.diffTruncated=diff.length>40000;
  }
  return context;
}
export async function problemSummary(url,{mergeDuplicates=true}={}) {
  const p=await getProblem(url);
  const events=await keyedAttempts(p),groups=groupIdenticalAttempts(events);
  return {id:p.id,url:p.url,title:p.title,attempts:(mergeDuplicates?groups:events).map(({record,runtime,...a})=>a),rawAttemptCount:events.length,mergedAttemptCount:groups.length,finalizations:p.finalizations.map(({workerPid,localDirectory,...f})=>f)};
}
