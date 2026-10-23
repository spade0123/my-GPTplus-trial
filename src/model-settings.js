import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {ROOT} from './core.js';

const directory=()=>path.join(path.resolve(process.env.PKU_DATA_DIR||path.join(ROOT,'data')),'preferences');
const settingsFile=()=>path.join(directory(),'models.json');
const cacheFile=()=>path.join(directory(),'model-catalog.json');
export const sameModelConfig=(a,b)=>Boolean(a&&b&&a.model===b.model&&a.effort===b.effort);
export function modelConfig(value){
  if(!value||typeof value.model!=='string'||!/^[-a-zA-Z0-9._:/]{1,120}$/.test(value.model)||typeof value.effort!=='string'||!/^[-a-zA-Z0-9_]{1,30}$/.test(value.effort))throw new Error('模型或推理强度设置无效。');
  return {model:value.model,effort:value.effort};
}
async function write(file,value){await fs.mkdir(directory(),{recursive:true});const temp=file+'.'+randomUUID()+'.tmp';try{await fs.writeFile(temp,JSON.stringify(value,null,2));await fs.rename(temp,file);}finally{await fs.rm(temp,{force:true}).catch(()=>{});}}
export async function readModelSettings(){
  const model=process.env.PKU_MODEL||'gpt-6.1-sol';
  try{const saved=JSON.parse(await fs.readFile(settingsFile(),'utf8'));return {interactive:modelConfig(saved.interactive),report:modelConfig(saved.report),updatedAt:saved.updatedAt};}
  catch(error){if(error.code!=='ENOENT')throw new Error('本机模型设置无法读取，请在插件中重新设置；不会静默换用其他模型。');return {interactive:{model,effort:'high'},report:{model,effort:'xhigh'}};}
}
export const modelProfile=async kind=>(await readModelSettings())[kind==='report'?'report':'interactive'];
export async function queryModelCatalog(){
  const [{DiscussionStream},{resolveCodexCommand}]=await Promise.all([import('./discussion-stream.js'),import('./model-runner.js')]);
  const stream=new DiscussionStream({resolveCommand:resolveCodexCommand});
  try{
    await stream.open();let cursor;const models=[];
    for(let page=0;page<20;page++){
      const response=await stream.rpc('model/list',{limit:100,includeHidden:false,...(cursor?{cursor}:{})});
      for(const item of response.data||[]){
        const efforts=(item.supportedReasoningEfforts||[]).map(x=>({effort:x.reasoningEffort,description:x.description||''})).filter(x=>typeof x.effort==='string');
        if(!item.hidden&&typeof (item.model||item.id)==='string'&&efforts.length)models.push({model:item.model||item.id,name:item.displayName||item.model||item.id,description:item.description||'',efforts,defaultEffort:item.defaultReasoningEffort});
      }
      cursor=response.nextCursor;if(!cursor)break;if(page===19)throw new Error('模型列表过长，请稍后刷新。');
    }
    if(!models.length)throw new Error('本机 Codex 未返回可选模型。');
    return {models:[...new Map(models.map(m=>[m.model,m])).values()],fetchedAt:new Date().toISOString(),source:'codex-model/list'};
  }finally{await stream.close();}
}
export async function readModelCatalog({refresh=false,query=queryModelCatalog}={}){
  let cached;try{cached=JSON.parse(await fs.readFile(cacheFile(),'utf8'));}catch{}
  if(!refresh&&cached?.models?.length&&Date.now()-Date.parse(cached.fetchedAt)<300000)return {...cached,cached:true};
  try{const result=await query();await write(cacheFile(),result);return {...result,cached:false};}
  catch(error){if(cached?.models?.length)return {...cached,cached:true,warning:'未能刷新模型清单，显示上次成功读取的列表：'+error.message};throw error;}
}
export async function saveModelSettings(value,{catalog}={}){
  const settings={interactive:modelConfig(value?.interactive),report:modelConfig(value?.report)};
  const available=catalog||await readModelCatalog({refresh:true});
  for(const profile of Object.values(settings)){
    const model=available.models.find(x=>x.model===profile.model);
    if(!model||!model.efforts.some(x=>x.effort===profile.effort))throw new Error('所选模型或推理强度不在本机 Codex 模型清单中，请刷新后重新选择。');
  }
  const saved={...settings,updatedAt:new Date().toISOString()};await write(settingsFile(),saved);return saved;
}
