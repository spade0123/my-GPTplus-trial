import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {ROOT} from './core.js';
import {dataDir,acquireLock,processAlive,processReview,readReview,saveCapture} from './browser-review.js';

export async function queuedReviews() {
  const dir=dataDir();await fs.mkdir(dir,{recursive:true});const jobs=[];
  for(const name of await fs.readdir(dir)) {
    if(!/^[a-f0-9]{64}\.json$/.test(name))continue;
    try {
      const record=JSON.parse(await fs.readFile(path.join(dir,name),'utf8'));
      if(['queued','pending'].includes(record.status)||(record.status==='running'&&!processAlive(record.workerPid)))jobs.push(record);
    }catch{}
  }
  return jobs.sort((a,b)=>String(a.queuedAt||a.createdAt).localeCompare(String(b.queuedAt||b.createdAt)));
}
export async function drainQueue(options={}) {
  const dir=dataDir();await fs.mkdir(dir,{recursive:true});
  const release=await acquireLock(path.join(dir,'queue-worker.lock'));
  if(!release)return {busy:true,processed:0,attempted:[]};
  let processed=0;const attempted=new Set();
  try {
    await fs.unlink(path.join(dir,'queue-worker.launch')).catch(()=>{});
    for(;;) {
      const jobs=(await queuedReviews()).filter(r=>!attempted.has(r.id));
      if(!jobs.length)break;
      const job=jobs[0];attempted.add(job.id);
      try{await processReview(job.id,options);processed++;}catch{/* Failed reports retain their source snapshot and error. */}
    }
    if(options.onIdle)await options.onIdle();
  }finally{await release();}
  return {busy:false,processed,attempted:[...attempted]};
}
export async function ensureWorker({workerFile=path.join(ROOT,'src/queue-worker.js'),workerArgs=[],queueDir=dataDir()}={}) {
  const dir=queueDir;await fs.mkdir(dir,{recursive:true});
  try{const lock=JSON.parse(await fs.readFile(path.join(dir,'queue-worker.lock'),'utf8'));if(processAlive(lock.pid))return {started:false};}catch{}
  const launch=path.join(dir,'queue-worker.launch');
  try{await fs.writeFile(launch,String(Date.now()),{flag:'wx'});}catch(e){
    if(e.code!=='EEXIST')throw e;
    if(Date.now()-(await fs.stat(launch)).mtimeMs<10000)return {started:false};
    await fs.unlink(launch).catch(()=>{});return ensureWorker({workerFile,workerArgs,queueDir});
  }
  try {
    await new Promise((resolve,reject)=>{
      const child=spawn(process.execPath,[workerFile,...workerArgs],{cwd:ROOT,env:{...process.env},detached:true,stdio:'ignore',windowsHide:true,shell:false});
      child.once('error',reject);child.once('spawn',()=>{child.unref();resolve();});
    });
    return {started:true};
  }catch(e){await fs.unlink(launch).catch(()=>{});throw e;}
}
export async function retryReview(id) {
  const record=await readReview(id);
  if(record.status!=='failed')return record;
  let runtime;
  if(/^run-snapshots\/[a-f0-9]{64}\.json$/.test(record.runtimeFile||'')) {
    const saved=JSON.parse(await fs.readFile(path.join(dataDir(),record.runtimeFile),'utf8'));
    runtime=Object.fromEntries(['input','output','hints','error','status','text'].filter(k=>saved[k]!==undefined).map(k=>[k,saved[k]]));
  }
  return saveCapture(Object.fromEntries(['url','title','statement','problem','code','standard'].filter(k=>record[k]!==undefined).map(k=>[k,record[k]]).concat(runtime?[['runtime',runtime]]:[])));
}
