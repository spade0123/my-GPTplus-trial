import fs from 'node:fs/promises';
import {watch} from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {Problem,writeRecord,processAlive} from './browser-review.js';
import {mailboxDir} from './browser-mailbox.js';
import {gridUrl,sameProblem} from './grid-url.js';
const Url=z.string().max(1000).refine(value=>Boolean(gridUrl(value,{kind:'problem'})));
export const ProblemImages=z.array(z.object({id:z.string().regex(/^figure-\d+-[a-f0-9]{1,8}$/),section:z.enum(['description','input','output','sampleInput','sampleOutput']),alt:z.string().max(200),offset:z.number().int().min(0).max(50000)})).max(24);
const Notice=z.object({type:z.literal('problem_notice'),sequence:z.number().int().positive(),tabId:z.number().int(),url:Url,status:z.enum(['loading','ready','error']),error:z.string().max(1000).optional(),page:z.object({problemMatches:z.literal(true),problemUrl:Url,title:z.string().min(1).max(300),problem:Problem,images:ProblemImages.default([]),missingSections:z.array(z.string().max(30)).max(5).default([])}).optional()});
export const problemDisplayFile=()=>path.join(mailboxDir(),'problem-display.json');
export function normalizeProblemNotice(input){
  const value=Notice.parse(input);
  if(value.status==='ready'&&(!value.page||!sameProblem(value.url,value.page.problemUrl)))throw new Error('自动题面与题号不一致。');
  return {revision:randomUUID(),receivedAt:new Date().toISOString(),tabId:value.tabId,url:value.url,status:value.status,...(value.status==='ready'?{page:value.page}:{}),...(value.error?{error:value.error}:{})};
}
export async function saveProblemNotice(input){const record=normalizeProblemNotice(input);await writeRecord(problemDisplayFile(),record);return record;}
export async function readProblemDisplay(){
  let record,ready;try{record=JSON.parse(await fs.readFile(problemDisplayFile(),'utf8'));}catch{}
  try{ready=JSON.parse(await fs.readFile(path.join(mailboxDir(),'ready.json'),'utf8'));}catch{}
  return {type:'problem_display',...(record||{status:'waiting'}),connected:Boolean(ready?.connected&&processAlive(ready.pid))};
}
export async function watchProblemDisplay(listener){
  const dir=mailboxDir();await fs.mkdir(dir,{recursive:true});let timer,closed=false;
  const notify=()=>{clearTimeout(timer);timer=setTimeout(()=>{if(!closed)void readProblemDisplay().then(value=>{if(!closed)listener(value);}).catch(()=>{});},40);};
  const watcher=watch(dir,(_event,name)=>{if(['problem-display.json','ready.json'].includes(String(name)))notify();});
  notify();return {dispose(){closed=true;clearTimeout(timer);watcher.close();}};
}
