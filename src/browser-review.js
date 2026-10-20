import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { ROOT, TOPICS, inspectCode, compilerCheck } from './core.js';
import { runModel } from './model-runner.js';
import {debugContext} from './problem-history.js';
import {openJudgeUrl} from './openjudge-url.js';

export const dataDir = () => path.resolve(process.env.PKU_DATA_DIR || path.join(ROOT,'data'));
export const Problem = z.object(Object.fromEntries(['description','input','output','sampleInput','sampleOutput'].map(key=>[key,z.string().max(20000).default('')]))).strict();
export const Runtime = z.object({input:z.string().max(20000).default(''),output:z.string().max(20000).default(''),hints:z.string().max(20000).default(''),error:z.string().max(20000).default(''),status:z.string().max(1000).default(''),text:z.string().max(20000).default('')}).strict().default({});
export function formatProblem(problem) {
  const labels={description:'题目描述',input:'关于输入',output:'关于输出',sampleInput:'例子输入',sampleOutput:'例子输出'};
  return Object.entries(labels).map(([key,label])=>problem[key]?`${label}\n${problem[key]}`:'').filter(Boolean).join('\n\n');
}
export const Capture = z.object({
  url: z.string().url().max(1000).refine(s => { try { const u=new URL(s);return Boolean(openJudgeUrl(s,{kind:'problem'}))||u.origin==='https://programming.pku.edu.cn' && !u.username && !u.password && /^\/probset\/[a-f0-9]{32}\/[a-f0-9]{32}\/ide\.do$/.test(u.pathname) && !u.search && !u.hash; } catch {return false;} }, '只支持北大 IDE 或百练/NOI OpenJudge 的具体题目页面'),
  title: z.string().trim().min(1).max(300), statement: z.string().trim().max(100000).optional(), problem:Problem.optional(),runtime:Runtime,
  code: z.string().trim().min(5).max(100000), standard:z.enum(['c++11','c++14','c++17','c++20']).default('c++17')
}).strict().superRefine((data,ctx)=>{
  const text=data.problem?Object.values(data.problem).join('\n'):data.statement||'';
  if(text.trim().length<(openJudgeUrl(data.url,{kind:'problem'})?1:20))ctx.addIssue({code:'custom',message:'请提供题目各部分或旧版完整题面。'});
}).transform(data=>({...data,statement:data.problem?formatProblem(data.problem):data.statement}));
export const Report = z.object({
  markdown:z.string().min(20).max(50000), topics:z.array(z.enum(Object.keys(TOPICS))).max(8),
  evidence:z.string().max(8000), next_step:z.string().max(4000)
}).strict();
export function fingerprint(capture) {
  const runtime=Runtime.parse(capture.runtime);
  // Preserve existing identities when the new optional hints field is empty.
  if(!runtime.hints)delete runtime.hints;
  const parts=[capture.url,capture.problem?formatProblem(capture.problem):capture.statement,capture.code,capture.standard];
  if(Object.values(runtime).some(Boolean))parts.push(runtime);
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex');
}
export async function writeRecord(file,record) {
  const temp=`${file}.${process.pid}.${createHash('sha256').update(String(Math.random())).digest('hex').slice(0,8)}.tmp`;
  await fs.writeFile(temp,JSON.stringify(record,null,2));
  await fs.rename(temp,file);
}
export function processAlive(pid) {
  if(!Number.isInteger(pid)||pid<1)return false;
  try{process.kill(pid,0);return true;}catch(e){return e.code==='EPERM';}
}
export async function acquireLock(file) {
  for(let attempt=0;attempt<2;attempt++) {
    try {
      const handle=await fs.open(file,'wx');
      await handle.writeFile(JSON.stringify({pid:process.pid,startedAt:new Date().toISOString()}));
      return async()=>{await handle.close();await fs.unlink(file).catch(e=>{if(e.code!=='ENOENT')throw e;});};
    }catch(e) {
      if(e.code!=='EEXIST')throw e;
      try {
        const value=await fs.readFile(file,'utf8');let owner;
        try{owner=JSON.parse(value);}catch{}
        const stale=owner?.pid?!processAlive(owner.pid):Date.now()-(await fs.stat(file)).mtimeMs>15*60*1000;
        if(!stale)return null;
        await fs.unlink(file);
      }catch(error){if(error.code!=='ENOENT')throw error;}
    }
  }
  return null;
}
export async function readReview(id) {
  if(!/^[a-f0-9]{64}$/.test(id))throw new Error('无效的记录 ID。');
  return JSON.parse(await fs.readFile(path.join(dataDir(),`${id}.json`),'utf8'));
}
export async function recordAssistance(id,event){
  if(!/^[a-f0-9]{64}$/.test(id))throw new Error('无效的辅助记录 ID。');
  const dir=path.join(dataDir(),'assistance');await fs.mkdir(dir,{recursive:true});const target=path.join(dir,`${id}.json`);let release;
  for(let i=0;i<100;i++){release=await acquireLock(target+'.lock');if(release)break;await new Promise(r=>setTimeout(r,10));}
  if(!release)throw new Error('提问记录正在保存，请重试。');
  try{
    let data;try{data=JSON.parse(await fs.readFile(target,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
    data ||= {snapshotId:id,events:[]};
    if(!data.events.some(e=>e.eventId===event.eventId))data.events.push(event);
    await writeRecord(target,data);
  }finally{await release();}
}
export async function assistanceContext(id){
  if(!/^[a-f0-9]{64}$/.test(id))return null;
  try{
    const index=JSON.parse(await fs.readFile(path.join(dataDir(),'assistance',`${id}.json`),'utf8'));
    const events=await Promise.all(index.events.slice(-30).map(async event=>{
      try{const job=JSON.parse(await fs.readFile(path.join(dataDir(),'hints',`${event.jobId}.json`),'utf8'));return {...event,status:job.status,instantAnalysis:job.instantAnalysis,partialAnalysis:job.status!=='complete'?job.partialAnalysis:undefined,firstTokenAt:job.firstTokenAt,analysis:job.status==='complete'?job.analysis:undefined};}catch{return {...event,status:'unavailable'};}
    }));
    return {snapshotId:id,events,total:index.events.length,truncated:index.events.length>30};
  }catch(error){if(error.code==='ENOENT')return null;return {unavailable:true};}
}
export function reviewSummary(record) {
  return {id:record.id,title:record.title,sourceUrl:record.sourceUrl,createdAt:record.createdAt,status:record.status,error:record.error,...(record.status==='complete'?{analysis:record.analysis}: {})};
}
export async function saveCapture(input) {
  const capture=Capture.parse(input);
  if(Buffer.byteLength(JSON.stringify(capture))>250000) throw new Error('题面与代码过长。');
  const id=fingerprint(capture), dir=dataDir(), file=path.join(dir,`${id}.json`);
  await fs.mkdir(dir,{recursive:true});
  const release=await acquireLock(`${file}.save.lock`);
  if(!release) {
    // Another save is committing this exact version. It is safe to acknowledge only after its file exists.
    for(let i=0;i<50;i++){try{return {...await readReview(id),cached:true};}catch(e){if(e.code!=='ENOENT')throw e;}await new Promise(r=>setTimeout(r,10));}
    throw new Error('同一版本正在保存，请稍后重试。');
  }
  try {
    let previous;
    try{previous=await readReview(id);}catch(e){if(e.code!=='ENOENT')throw e;}
    if(previous&&['complete','queued','running','pending'].includes(previous.status))return {...previous,cached:true};
    const {runtime,...source}=capture;
    const runtimeFile=`run-snapshots/${id}.json`;
    const record={schemaVersion:3,id,createdAt:previous?.createdAt||new Date().toISOString(),queuedAt:new Date().toISOString(),title:capture.title,sourceUrl:capture.url,codeHash:createHash('sha256').update(capture.code).digest('hex'),...source,runtimeFile,runtimeSummary:{status:runtime.status,hasInput:Boolean(runtime.input),hasOutput:Boolean(runtime.output),hasHints:Boolean(runtime.hints),hasError:Boolean(runtime.error),hasText:Boolean(runtime.text)},status:'queued'};
    await fs.mkdir(path.join(dir,'run-snapshots'),{recursive:true});
    await fs.writeFile(path.join(dir,runtimeFile),JSON.stringify({schemaVersion:1,reviewId:id,capturedAt:record.createdAt,sourceUrl:capture.url,codeHash:record.codeHash,...runtime},null,2),{flag:'wx'}).catch(e=>{if(e.code!=='EEXIST')throw e;});
    await writeRecord(file,record);
    return {...record,cached:false};
  }finally{await release();}
}
export async function captureFromRecord(record){
  let runtime=Runtime.parse();
  if(/^run-snapshots\/[a-f0-9]{64}\.json$/.test(record.runtimeFile||'')){
    const saved=JSON.parse(await fs.readFile(path.join(dataDir(),record.runtimeFile),'utf8'));
    runtime=Runtime.parse(Object.fromEntries(['input','output','hints','error','status','text'].filter(k=>saved[k]!==undefined).map(k=>[k,saved[k]])));
  }
  return Capture.parse(Object.fromEntries(['url','title','statement','problem','code','standard'].filter(k=>record[k]!==undefined).map(k=>[k,record[k]]).concat([['runtime',runtime]])));
}
export async function processReview(id,{model=runModel,compile=compilerCheck,progress=()=>{}}={}) {
  const initial=await readReview(id);
  if(initial.status==='complete')return {...initial,cached:true};
  const file=path.join(dataDir(),`${id}.json`);
  const release=await acquireLock(`${file}.lock`);
  if(!release)throw new Error('同一版本正在分析。');
  let record=initial;
  try {
    record=await readReview(id);
    if(record.status==='complete')return {...record,cached:true};
    record={...record,status:'running',workerPid:process.pid,startedAt:new Date().toISOString()};delete record.error;
    await writeRecord(file,record);
    const capture=await captureFromRecord(record);
    progress('已保存，正在后台检查 C++。');
    const diagnostics=await compile(capture.code,capture.standard), risks=inspectCode(capture.code);
    progress('正在生成分析报告，通常需要几十秒到数分钟。');
    const debugHistory=await debugContext(capture.url,id);
    const report=Report.parse(await model({capture,diagnostics,risks,debugHistory,assistance:await assistanceContext(id)}));
    record={...record,status:'complete',completedAt:new Date().toISOString(),compiler:diagnostics,analysis:report.markdown,topics:[...new Set(report.topics)],evidence:report.evidence,next_step:report.next_step};
    await writeRecord(file,record);
    return {...record,cached:false};
  } catch(e) {await writeRecord(file,{...record,status:'failed',error:String(e.message).slice(0,2000)});throw e;}
  finally {await release();}
}
export async function reviewCapture(input,options={}) {
  const saved=await saveCapture(input);
  if(saved.status==='complete')return saved;
  return processReview(saved.id,options);
}
export async function reviewHistory({since,until,limit=30,includeSource=false}={}) {
  const dir=dataDir();await fs.mkdir(dir,{recursive:true});const records=[];
  for(const name of await fs.readdir(dir)) {
    if(!/^(?:[a-f0-9-]{36}|[a-f0-9]{64})\.json$/.test(name))continue;
    try {
      const r=JSON.parse(await fs.readFile(path.join(dir,name),'utf8'));
      if((since&&new Date(r.createdAt)<new Date(since))||(until&&new Date(r.createdAt)>=new Date(until)))continue;
      if(!includeSource) {delete r.code;delete r.statement;delete r.problem;delete r.compiler;}
      else if(/^run-snapshots\/[a-f0-9]{64}\.json$/.test(r.runtimeFile||'')) {try{r.runtime=JSON.parse(await fs.readFile(path.join(dir,r.runtimeFile),'utf8'));}catch{r.runtimeUnavailable=true;}}
      r.assistance=await assistanceContext(r.id);records.push(r);
    }catch{}
  }
  records.sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)));
  return {total:records.length,records:records.slice(0,limit),truncated:records.length>limit};
}
