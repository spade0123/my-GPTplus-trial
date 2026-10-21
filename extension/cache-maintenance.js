// Conservative character-count watermark, not a claim about exact browser
// quota. Quota failures also trigger cleanup even below this estimate.
export const CACHE_WATERMARK_UNITS=2*1024*1024;
export function createCacheMaintenance({inspect,clean,now=Date.now,watermark=CACHE_WATERMARK_UNITS,intervalMs=30000,retryMs=60000,forceIntervalMs=5000}){
  let running,nextCheck=0,nextForced=0,retryAfter=0;
  const quotaSeen=new Map();
  return {
    check(tabId,{force=false}={}){
      if(running)return running;
      const current=now();if(current<(force?nextForced:nextCheck))return Promise.resolve({status:'cooldown'});
      nextCheck=current+intervalMs;nextForced=current+forceIntervalMs;
      running=(async()=>{
        try{
          const info=await inspect(tabId);
          const page=info.pageId||info.url,quota=Number(info.quotaFailures)||0;
          const newQuota=quota>(quotaSeen.get(page)||0),nearLimit=info.usedUnits>=watermark;
          if(!nearLimit&&!newQuota)return {status:'healthy'};
          if(!info.cacheCount){quotaSeen.set(page,quota);return {status:newQuota?'no_safe_cache':'empty'};}
          if(now()<retryAfter)return {status:'cooldown'};
          const result=await clean(tabId);
          quotaSeen.set(page,quota);if(quotaSeen.size>100)quotaSeen.delete(quotaSeen.keys().next().value);
          return {status:result.cleared?'cleaned':'unchanged',...result};
        }catch(error){retryAfter=now()+retryMs;return {status:'blocked',error:String(error.message||'自动清理未完成。')};}
      })().finally(()=>{running=null;});
      return running;
    }
  };
}
