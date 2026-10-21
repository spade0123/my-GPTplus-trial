import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {ROOT} from './core.js';

export const ModelSettings=z.object({
  model:z.string().trim().min(1).max(120).regex(/^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/),
  effort:z.enum(['none','low','medium','high','xhigh','max'])
}).strict().refine(value=>value.effort!=='none'||!['gpt-6.1-sol','gpt-6-astra','gpt-6-sol'].includes(value.model),
  '此模型不支持 none 推理强度，请选择 low 或更高。');
const settingsPath=()=>path.join(path.resolve(process.env.PKU_DATA_DIR||path.join(ROOT,'data')),'coach-model-settings.json');
export async function readModelSettings(){
  try{return ModelSettings.parse(JSON.parse(await fs.readFile(settingsPath(),'utf8')));}
  catch(error){if(error.code!=='ENOENT')throw error;}
  return ModelSettings.parse({model:process.env.PKU_MODEL||'gpt-6-luna',effort:process.env.PKU_MODEL_EFFORT||'low'});
}
export async function writeModelSettings(value){
  const settings=ModelSettings.parse(value),file=settingsPath(),temporary=file+'.'+randomUUID()+'.tmp';
  await fs.mkdir(path.dirname(file),{recursive:true});
  try{await fs.writeFile(temporary,JSON.stringify(settings,null,2)+'\n');await fs.rename(temporary,file);}
  finally{await fs.rm(temporary,{force:true});}
  return settings;
}
