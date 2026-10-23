import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {dataDir,writeRecord,acquireLock} from './browser-review.js';
const folder=()=>path.join(dataDir(),'code-help');
const file=id=>{if(!/^[-a-f0-9]{36}$/i.test(id||''))throw new Error('代码问答记录 ID 无效。');return path.join(folder(),id+'.json');};
export async function saveCodeQuestion(mode,evidence){
  const id=randomUUID(),createdAt=new Date().toISOString(),record={schemaVersion:1,id,mode,createdAt,updatedAt:createdAt,status:'awaiting_reply',source:evidence.source,sourceSnapshotId:evidence.snapshotId,question:evidence.question,code:evidence.capture.code,codeHash:createHash('sha256').update(evidence.capture.code).digest('hex'),statement:evidence.capture.statement,title:evidence.capture.title,url:evidence.capture.url};
  await fs.mkdir(folder(),{recursive:true});await writeRecord(file(id),record);return record;
}
export async function saveCodeReply({id,answer}){
  if(typeof answer!=='string'||!answer.trim()||answer.length>20000)throw new Error('请保存 1—20000 字的真实回复。');
  const target=file(id),release=await acquireLock(target+'.lock');if(!release)throw new Error('这份代码回复正在保存，请重试。');
  try{
    const record=JSON.parse(await fs.readFile(target,'utf8'));
    if(record.codeHash!==createHash('sha256').update(record.code).digest('hex'))throw new Error('原始源码记录核对失败，停止保存回复。');
    if(record.status==='complete'&&record.answer===answer)return {id,saved:true,file:target,reused:true};
    const previousAnswers=record.answer&&record.answer!==answer?[...(record.previousAnswers||[]),{answer:record.answer,completedAt:record.completedAt}]:record.previousAnswers;
    const updatedAt=new Date().toISOString();
    await writeRecord(target,{...record,status:'complete',completedAt:updatedAt,updatedAt,answer,...(previousAnswers?{previousAnswers}:{})});
    return {id,saved:true,file:target};
  }finally{await release();}
}
export async function codeHelpHistory({since,until,limit=30,includeSource=false}={}){
  let names;try{names=await fs.readdir(folder());}catch(error){if(error.code==='ENOENT')return {total:0,records:[],truncated:false};throw error;}
  const records=[];
  for(const name of names)if(/^[-a-f0-9]{36}\.json$/i.test(name)){
    const record=JSON.parse(await fs.readFile(path.join(folder(),name),'utf8'));
    const activityAt=record.updatedAt||record.completedAt||record.createdAt;
    if((since&&Date.parse(activityAt)<Date.parse(since))||(until&&Date.parse(activityAt)>=Date.parse(until)))continue;
    if(!includeSource){delete record.code;delete record.statement;}
    records.push(record);
  }
  records.sort((a,b)=>(b.updatedAt||b.createdAt).localeCompare(a.updatedAt||a.createdAt));
  return {total:records.length,records:records.slice(0,limit),truncated:records.length>limit};
}
