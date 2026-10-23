import {DiscussionStream} from './discussion-stream.js';
import {resolveCodexCommand} from './model-runner.js';

// Account metadata only: no thread/start, turn/start, source code or prompt.
let pending,cached,lastAttempt=0,lastError;
export function readAccountUsage(){
  if(pending)return pending;
  if(Date.now()-lastAttempt<15000){
    if(lastError)return Promise.reject(lastError);
    if(cached)return Promise.resolve(cached);
  }
  lastAttempt=Date.now();
  pending=(async()=>{
    const connection=new DiscussionStream({resolveCommand:resolveCodexCommand,rpcTimeoutMs:8000});
    try{
      await connection.open();
      const result=await connection.rpc('account/rateLimits/read',{});
      const mapped=result.rateLimitsByLimitId;
      const entries=mapped&&typeof mapped==='object'&&Object.keys(mapped).length?Object.entries(mapped):result.rateLimits?[['codex',result.rateLimits]]:[];
      const buckets=entries.slice(0,30).map(([id,bucket])=>({
        id:String(bucket?.limitId||id).slice(0,120),name:String(bucket?.limitName||bucket?.limitId||id).slice(0,120),
        windows:['primary','secondary'].flatMap(key=>{
          const item=bucket?.[key];if(!item)return [];
          return [{key,usedPercent:typeof item.usedPercent==='number'&&Number.isFinite(item.usedPercent)?Math.max(0,Math.min(100,item.usedPercent)):null,
            minutes:Number.isFinite(item.windowDurationMins)&&item.windowDurationMins>0?item.windowDurationMins:null,
            resetsAt:Number.isFinite(item.resetsAt)&&item.resetsAt>0?item.resetsAt:null}];
        })
      }));
      cached={checkedAt:new Date().toISOString(),buckets};lastError=null;return cached;
    }catch{
      // Never forward raw authentication/network errors or credentials to UI.
      lastError=new Error('无法读取账户额度。请确认本机 Codex 已用 ChatGPT 登录、网络可用且版本支持额度查询；API Key 登录可能不提供此数据。');throw lastError;
    }finally{await connection.close();}
  })().finally(()=>pending=null);
  return pending;
}
