// Serialized into MAIN by chrome.scripting. Only rebuildable question caches.
export function inspectSiteStorage(){
  if(location.origin!=='https://programming.pku.edu.cn'||!/^\/probset\/[a-f0-9]{32}\/[a-f0-9]{32}\/ide\.do$/.test(location.pathname))throw new Error('请在北大题目 IDE 页面检查缓存。');
  let usedUnits=0,cacheCount=0;
  for(let i=0;i<localStorage.length;i++){const key=localStorage.key(i),value=localStorage.getItem(key);if(value===null)continue;usedUnits+=key.length+value.length;if(/^(?:problem|problemlist)_[a-f0-9]{32}$/.test(key))cacheCount++;}
  const guard=window.__pkuCoachCacheGuard;
  return {url:location.origin+location.pathname,usedUnits,cacheCount,pageId:guard?.pageId,quotaFailures:guard?.quotaFailures||0};
}
export function readSiteCache(){
  if(location.origin!=='https://programming.pku.edu.cn'||!/^\/probset\/[a-f0-9]{32}\/[a-f0-9]{32}\/ide\.do$/.test(location.pathname))throw new Error('请在北大题目 IDE 页面清理。');
  const entries=[];let bytes=0;
  for(let i=0;i<localStorage.length;i++){
    const key=localStorage.key(i);if(!/^(?:problem|problemlist)_[a-f0-9]{32}$/.test(key))continue;
    const value=localStorage.getItem(key);if(value===null)continue;
    bytes+=2*(key.length+value.length);entries.push({key,value});
  }
  return {url:location.origin+location.pathname,entries,estimatedBytes:bytes};
}
export function clearSiteCache(snapshot){
  if(location.origin!=='https://programming.pku.edu.cn'||snapshot?.url!==location.origin+location.pathname||!/^\/probset\/[a-f0-9]{32}\/[a-f0-9]{32}\/ide\.do$/.test(location.pathname))throw new Error('题目页面已改变，已停止清理。');
  if(!Array.isArray(snapshot.entries)||snapshot.entries.some(e=>typeof e?.key!=='string'||typeof e?.value!=='string'||!/^(?:problem|problemlist)_[a-f0-9]{32}$/.test(e.key)))throw new Error('缓存备份范围无效，已停止清理。');
  let cleared=0,changed=0,estimatedBytes=0;
  for(const {key,value} of snapshot.entries){
    if(localStorage.getItem(key)!==value){changed++;continue;}
    localStorage.removeItem(key);cleared++;estimatedBytes+=2*(key.length+value.length);
  }
  return {cleared,changed,estimatedBytes};
}

// Independent extension storage must confirm the full backup before deletion.
// A backup quota failure leaves the website untouched.
export async function backupAndClearSiteCache({storage,snapshot,id,clear}){
  if(!snapshot.entries?.length)return {cleared:0,changed:0,estimatedBytes:0};
  const backupKey='pku-site-cache-backup-'+id;
  const backup={...snapshot,createdAt:new Date().toISOString(),kind:'rebuildable-question-cache'};
  const matches=saved=>saved?.url===snapshot.url&&saved.entries?.length===snapshot.entries.length&&snapshot.entries.every((e,i)=>saved.entries[i]?.key===e.key&&saved.entries[i]?.value===e.value);
  const existing=(await storage.get(backupKey))[backupKey];
  await storage.set({...(!matches(existing)?{[backupKey]:backup}:{}),'pku-site-cache-last-backup':backupKey});
  const confirmed=(await storage.get(backupKey))[backupKey];
  if(!matches(confirmed))throw new Error('清理前备份未核对成功，网站数据保持原样。');
  try{return {...await clear(snapshot),backupKey};}
  catch(error){throw new Error('清理未完成，清理前备份仍保留在扩展中，可下载核对。'+String(error.message||''));}
}
