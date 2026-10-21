import fs from 'node:fs/promises';
import {watch} from 'node:fs';
import path from 'node:path';
import {dataDir} from './browser-review.js';
import {gridUrl} from './grid-url.js';

const cache=new Map(),verdicts=new Set(['AC','WA','CE','TLE','RE','MLE','PE','OLE']);
function summarize(record,source){
  const problem=gridUrl(record.browserUrl||record.capture?.url,{kind:'problem'});if(!problem)return null;
  const s=record.submission,manual=source==='test'&&Boolean(record.input?.length);
  const result=s?.runtime?.text?.match(/^Result:\s*([^\r\n]+)/m)?.[1]?.trim(),names={Passed:'AC',Accepted:'AC',WrongAnswer:'WA','Wrong Answer':'WA',CompileError:'CE',RuntimeError:'RE',TimeOut:'TLE',OutOfMemory:'MLE',OutputExceeded:'OLE',EmptyOutput:'WA'};
  const raw=verdicts.has(s?.verdict?.status)?s.verdict.status:names[result];
  let status=verdicts.has(raw)?raw:'UNKNOWN';
  if(manual&&status==='AC')status='MANUAL';
  if(['uncertain','rejected','failed'].includes(record.status))status='UNKNOWN';
  else if(manual&&s?.runtime?.text&&/Complete/i.test(result||'')&&!verdicts.has(raw))status='MANUAL';
  else if(!verdicts.has(raw)&&['prepared','sending','pending'].includes(record.status))status='PENDING';
  else if(manual&&s?.runtime?.text&&!verdicts.has(raw))status='MANUAL';
  return {url:problem.url,key:problem.key,group:problem.group,status,source,manual,createdAt:record.createdAt||'',jobStatus:record.status||'',id:record.id};
}
export async function readProblemProgress({group}={}){
  const active=new Set(),latest=new Map();
  for(const [folder,source]of [['grid-tests','test'],['oj-submissions','submit']]){
    const directory=path.join(dataDir(),folder);let names=[];
    try{names=await fs.readdir(directory);}catch(error){if(error.code!=='ENOENT')throw error;}
    for(let offset=0;offset<names.length;offset+=16)await Promise.all(names.slice(offset,offset+16).filter(name=>/^[a-f0-9]{64}\.json$/.test(name)).map(async name=>{
      const file=path.join(directory,name);active.add(file);
      try{
        const stat=await fs.stat(file),prior=cache.get(file);let item=prior?.item;
        if(!prior||prior.mtime!==stat.mtimeMs||prior.size!==stat.size){item=summarize(JSON.parse(await fs.readFile(file,'utf8')),source);cache.set(file,{mtime:stat.mtimeMs,size:stat.size,item});}
        if(!item||group&&item.group!==group)return;
        const old=latest.get(item.key);
        // A late refresh of an old attempt must never replace a newer attempt.
        if(!old||item.createdAt>old.createdAt||item.createdAt===old.createdAt&&item.id>old.id)latest.set(item.key,item);
      }catch{/* Ignore incomplete/deleted files; the next filesystem event retries. */}
    }));
  }
  for(const file of cache.keys())if(!active.has(file))cache.delete(file);
  return {type:'problem_progress',group:group||null,items:[...latest.values()].map(({key,group,...item})=>item)};
}
export async function watchProblemProgress(listener){
  let timer,closed=false,queue=Promise.resolve();const watchers=[];
  const notify=()=>{clearTimeout(timer);timer=setTimeout(()=>{
    queue=queue.catch(()=>{}).then(async()=>{if(!closed){const value=await readProblemProgress();if(!closed)listener(value);}}).catch(()=>{});
  },120);};
  for(const folder of ['grid-tests','oj-submissions']){
    const directory=path.join(dataDir(),folder);await fs.mkdir(directory,{recursive:true});
    watchers.push(watch(directory,(_event,name)=>{if(!name||String(name).endsWith('.json'))notify();}));
  }
  notify();return {dispose(){closed=true;clearTimeout(timer);for(const watcher of watchers)watcher.close();}};
}
