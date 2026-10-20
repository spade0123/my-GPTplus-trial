import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {dataDir,writeRecord} from './browser-review.js';

const hash=value=>createHash('sha256').update(value).digest('hex');
const directory=()=>path.join(dataDir(),'grid-tests');
const file=id=>path.join(directory(),id+'.json');

export async function readGridTestRun(id){
  if(!/^[a-f0-9]{64}$/.test(id||''))throw new Error('网站测试记录编号无效。');
  return JSON.parse(await fs.readFile(file(id),'utf8'));
}

export async function createGridTestRun(capture,browserUrl,actionId,input){
  await fs.mkdir(directory(),{recursive:true});
  const id=hash('grid-test:'+actionId);
  try{
    const prior=await readGridTestRun(id);
    if(prior.capture.url!==capture.url||prior.capture.code!==capture.code||prior.input!==input)throw new Error('测试事件已用于另一份代码或输入。');
    return prior;
  }catch(error){if(error.code!=='ENOENT')throw error;}
  const record={id,actionId,browserUrl,capture,input,codeHash:hash(capture.code.replace(/\r\n/g,'\n').trim()),status:'prepared',createdAt:new Date().toISOString()};
  await writeRecord(file(id),record);return record;
}

export async function updateGridTestRun(record,fields){
  const value={...record,...fields,updatedAt:new Date().toISOString()};
  await writeRecord(file(value.id),value);return value;
}
