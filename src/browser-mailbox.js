import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {dataDir,writeRecord,processAlive} from './browser-review.js';
export const mailboxDir=()=>path.join(dataDir(),'browser-bridge');
export async function browserRequest(action,params={},timeoutMs=6000){
  if(!['tabs','capture','inspect_submit','prepare_submit','submit','refresh_submission'].includes(action))throw new Error('不支持的浏览器操作。');
  const dir=mailboxDir();let ready;
  try{ready=JSON.parse(await fs.readFile(path.join(dir,'ready.json'),'utf8'));}catch{}
  if(!ready?.connected||!processAlive(ready.pid))throw new Error('Chrome 尚未连接。请在 编程网格 页面点击独立的“编程网格 · VS Code 连接”扩展图标。');
  const id=randomUUID(),request=path.join(dir,'requests',id+'.json'),response=path.join(dir,'responses',id+'.json');
  await fs.mkdir(path.dirname(request),{recursive:true});await fs.mkdir(path.dirname(response),{recursive:true});
  await writeRecord(request,{id,action,params,expiresAt:Date.now()+timeoutMs});
  try{
    const deadline=Date.now()+timeoutMs;
    while(Date.now()<deadline){
      try{const result=JSON.parse(await fs.readFile(response,'utf8'));if(result.error)throw Object.assign(new Error(result.error),{code:result.code});return result.value;}catch(e){if(e.code!=='ENOENT')throw e;}
      await new Promise(resolve=>setTimeout(resolve,40));
    }
    throw new Error('Chrome 读取超时，请检查浏览器连接、登录状态和关联标签。');
  }finally{await Promise.all([fs.unlink(request).catch(()=>{}),fs.unlink(response).catch(()=>{})]);}
}
