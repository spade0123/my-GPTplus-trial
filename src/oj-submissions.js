import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {dataDir,writeRecord} from './browser-review.js';
const hash=s=>createHash('sha256').update(s).digest('hex');
const directory=()=>path.join(dataDir(),'oj-submissions');
export async function readSubmission(id){if(!/^[a-f0-9]{64}$/.test(id||''))throw new Error('提交编号无效。');return JSON.parse(await fs.readFile(path.join(directory(),id+'.json'),'utf8'));}
export async function createSubmission(capture,actionId,language){
  await fs.mkdir(directory(),{recursive:true});const id=hash('oj:'+actionId),file=path.join(directory(),id+'.json');
  try{return await readSubmission(id);}catch(e){if(e.code!=='ENOENT')throw e;}
  const record={id,actionId,language,capture,codeHash:hash(capture.code.replace(/\r\n/g,'\n').trim()),status:'prepared',createdAt:new Date().toISOString()};await writeRecord(file,record);return record;
}
export async function updateSubmission(record,fields){const value={...record,...fields,updatedAt:new Date().toISOString()};await writeRecord(path.join(directory(),value.id+'.json'),value);return value;}
