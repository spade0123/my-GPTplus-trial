import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {dataDir,writeRecord,acquireLock,readReview} from './browser-review.js';
import {gridUrl,sameProblem} from './grid-url.js';

const valid=id=>/^[a-f0-9]{64}$/.test(id||'');
const hash=value=>createHash('sha256').update(value).digest('hex');
const folder=()=>path.join(dataDir(),'conversations');
const metadataFile=id=>{if(!valid(id))throw new Error('对话编号无效。');return path.join(folder(),id+'.json');};
const jobFile=id=>{if(!valid(id))throw new Error('消息编号无效。');return path.join(dataDir(),'hints',id+'.json');};
const cache=new Map();
export function conversationIdFor(job){
  if(valid(job.conversationId))return job.conversationId;
  const type=job.kind==='discussion'?(job.purpose==='solution'?'solution':'discussion'):'hint';
  return hash('legacy:'+type+':'+(gridUrl(job.sourceUrl)?.key||job.sourceUrl));
}
const kindOf=job=>job.kind==='discussion'?(job.purpose==='solution'?'solution':'discussion'):'hint';
async function files(directory){try{return (await fs.readdir(directory)).filter(name=>/^[a-f0-9]{64}\.json$/.test(name));}catch(error){if(error.code==='ENOENT')return [];throw error;}}
async function index(){
  const jobs=[],active=new Set();
  for(const name of await files(path.join(dataDir(),'hints'))){
    const file=path.join(dataDir(),'hints',name);active.add(file);
    try{
      const stat=await fs.stat(file);let cached=cache.get(file);
      if(!cached||cached.mtime!==stat.mtimeMs||cached.size!==stat.size){
        const raw=JSON.parse(await fs.readFile(file,'utf8'));
        const value=gridUrl(raw.sourceUrl,{kind:'problem'})&&raw.id===name.slice(0,-5)?Object.fromEntries(['id','conversationId','parentJobId','snapshotId','sourceUrl','title','question','kind','purpose','createdAt','status','codeHash'].map(key=>[key,raw[key]])):null;
        cached={mtime:stat.mtimeMs,size:stat.size,value};cache.set(file,cached);
      }
      if(cached.value)jobs.push(cached.value);
    }catch{/* A partial/corrupt old record must not hide other conversations. */}
  }
  for(const file of cache.keys())if(!active.has(file))cache.delete(file);
  const threads=new Map();
  for(const job of jobs.sort((a,b)=>String(a.createdAt).localeCompare(String(b.createdAt))||a.id.localeCompare(b.id))){
    const id=conversationIdFor(job),kind=kindOf(job);
    if(!threads.has(id))threads.set(id,{id,problemUrl:job.sourceUrl,problemTitle:job.title||'未命名题目',title:kind==='hint'?'简短提示':kind==='solution'?'参考解答':'历史交流',kind,createdAt:job.createdAt,updatedAt:job.createdAt,snapshotId:job.snapshotId,archived:false,jobs:[]});
    const thread=threads.get(id);thread.jobs.push(job);thread.updatedAt=job.createdAt;thread.snapshotId=job.snapshotId;
  }
  for(const name of await files(folder()))try{
    const saved=JSON.parse(await fs.readFile(path.join(folder(),name),'utf8'));
    if(saved.id!==name.slice(0,-5)||!gridUrl(saved.problemUrl,{kind:'problem'})||!valid(saved.snapshotId))continue;
    const prior=threads.get(saved.id);
    if(prior&&!sameProblem(prior.problemUrl,saved.problemUrl))continue;
    threads.set(saved.id,{...(prior||{jobs:[]}),...saved,jobs:prior?.jobs||[],snapshotId:prior?.snapshotId||saved.snapshotId,updatedAt:[prior?.updatedAt,saved.updatedAt].filter(Boolean).sort().at(-1)});
  }catch{}
  return threads;
}
export async function listConversations({includeArchived=false}={}){
  const topics=new Map();
  for(const thread of (await index()).values()){
    if(thread.archived&&!includeArchived)continue;
    const key=gridUrl(thread.problemUrl).key;
    if(!topics.has(key))topics.set(key,{key,url:thread.problemUrl,title:thread.problemTitle||'未命名题目',updatedAt:thread.updatedAt,snapshotId:thread.snapshotId,threads:[]});
    const topic=topics.get(key),last=thread.jobs.at(-1);
    if(thread.updatedAt>topic.updatedAt){topic.updatedAt=thread.updatedAt;topic.snapshotId=thread.snapshotId;}
    topic.threads.push({id:thread.id,title:thread.title,kind:thread.kind,archived:thread.archived,updatedAt:thread.updatedAt,count:thread.jobs.length,status:last?.status||'empty'});
  }
  for(const topic of topics.values())topic.threads.sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt)));
  return {type:'conversation_topics',topics:[...topics.values()].sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt)))};
}
export async function readConversation(id,{before,limit=30}={}){
  const thread=(await index()).get(id);if(!thread)throw new Error('没有找到这段对话。');
  let end=thread.jobs.length;
  if(before){end=thread.jobs.findIndex(job=>job.id===before);if(end<0)throw new Error('历史分页位置已改变，请刷新对话。');}
  const start=Math.max(0,end-Math.min(50,Math.max(1,limit))),turns=[];
  for(const entry of thread.jobs.slice(start,end))try{
    const job=JSON.parse(await fs.readFile(jobFile(entry.id),'utf8'));
    turns.push({id:job.id,question:job.question||(job.kind==='discussion'?'获取完整参考解答':'获取简短提示'),answer:job.status==='complete'?job.analysis||'':job.partialAnalysis||job.message||job.instantAnalysis||'',status:job.status,error:job.error,createdAt:job.createdAt,codeHash:job.codeHash,parentJobId:job.parentJobId,snapshotId:job.snapshotId});
  }catch{}
  return {type:'conversation_detail',id:thread.id,title:thread.title,problemUrl:thread.problemUrl,problemTitle:thread.problemTitle,archived:thread.archived,snapshotId:thread.snapshotId,latestJobId:thread.jobs.at(-1)?.id||null,total:thread.jobs.length,earlierBefore:start>0?thread.jobs[start]?.id:null,turns};
}
export async function createConversation({problemUrl,snapshotId,problemTitle,title='新对话',quick=false}){
  if(!gridUrl(problemUrl,{kind:'problem'})||!valid(snapshotId))throw new Error('对话缺少有效的题目快照。');
  const id=hash(randomUUID()),now=new Date().toISOString();
  const record={id,problemUrl,snapshotId,problemTitle:String(problemTitle||'未命名题目').slice(0,300),title:String(title).trim().slice(0,80)||'新对话',kind:'discussion',quick,archived:false,createdAt:now,updatedAt:now};
  await fs.mkdir(folder(),{recursive:true});await writeRecord(metadataFile(id),record);return readConversation(id);
}
export async function updateConversation(id,{title,archived}={}){
  if(title!==undefined&&(typeof title!=='string'||!title.trim()||title.trim().length>80))throw new Error('对话名称须为 1–80 个字符。');
  if(archived!==undefined&&typeof archived!=='boolean')throw new Error('归档选项无效。');
  await fs.mkdir(folder(),{recursive:true});let release;
  for(let i=0;i<100&&!release;i++){release=await acquireLock(metadataFile(id)+'.lock');if(!release)await new Promise(resolve=>setTimeout(resolve,10));}
  if(!release)throw new Error('对话正在修改，请重试。');
  try{
    const thread=(await index()).get(id);if(!thread)throw new Error('没有找到这段对话。');
    const {jobs,...saved}=thread;
    await writeRecord(metadataFile(id),{...saved,...(title===undefined?{}:{title:title.trim()}),...(archived===undefined?{}:{archived}),updatedAt:new Date().toISOString()});
  }finally{await release();}
  return readConversation(id);
}
export async function validateConversationLink({conversationId,parentJobId,problemUrl}){
  const thread=(await index()).get(conversationId);
  if(!thread||!sameProblem(thread.problemUrl,problemUrl))throw new Error('对话与题目不一致。');
  if(thread.archived)throw new Error('请先恢复归档对话，再继续追问。');
  if(parentJobId&&!thread.jobs.some(job=>job.id===parentJobId))throw new Error('追问引用的消息不属于这段对话。');
  return thread;
}
export async function conversationContext(job){
  const thread=(await index()).get(conversationIdFor(job));if(!thread)return [];
  let selected=[];
  if(job.parentJobId){
    const byId=new Map(thread.jobs.map(entry=>[entry.id,entry])),seen=new Set();let parent=byId.get(job.parentJobId);
    while(parent&&!seen.has(parent.id)&&selected.length<6){seen.add(parent.id);selected.unshift(parent);if(parent.parentJobId)parent=byId.get(parent.parentJobId);else{if(!parent.conversationId){const at=thread.jobs.findIndex(item=>item.id===parent.id);selected=[...thread.jobs.slice(Math.max(0,at-(6-selected.length)),at),...selected];}break;}}
  }else{const at=thread.jobs.findIndex(entry=>entry.id===job.id);selected=thread.jobs.slice(Math.max(0,at-6),Math.max(0,at));}
  const history=[];
  for(const entry of selected)try{const raw=JSON.parse(await fs.readFile(jobFile(entry.id),'utf8'));if(raw.status==='complete')history.push({id:raw.id,question:raw.question||(raw.kind==='discussion'?'获取完整参考解答':'获取简短提示'),status:raw.status,analysis:raw.analysis||''});}catch{}
  return history;
}

// Keep quick questions in their familiar stream; archiving that stream starts a fresh one.
export async function quickConversation({problemUrl,snapshotId,problemTitle,question}){
  const threads=[...(await index()).values()].filter(thread=>sameProblem(thread.problemUrl,problemUrl));
  const quick=threads.filter(thread=>thread.quick&&!thread.archived).sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)))[0];
  if(quick)return quick.id;
  const legacy=threads.find(thread=>thread.id===conversationIdFor({kind:'discussion',sourceUrl:problemUrl}));
  if(!legacy?.archived&&!threads.some(thread=>thread.quick))return undefined;
  return (await createConversation({problemUrl,snapshotId,problemTitle,title:String(question).trim().slice(0,40)||'快捷交流',quick:true})).id;
}

export async function conversationSnapshot(id,jobId){
  const thread=(await index()).get(id);if(!thread)throw new Error('没有找到这段对话。');
  const entry=thread.jobs.find(job=>job.id===jobId);if(!entry)throw new Error('这条消息不属于当前对话。');
  const snapshot=await readReview(entry.snapshotId);
  if(!sameProblem(snapshot.url,thread.problemUrl))throw new Error('代码快照与题目不一致。');
  return {type:'conversation_snapshot',code:String(snapshot.code||''),standard:snapshot.standard,createdAt:snapshot.createdAt};
}
