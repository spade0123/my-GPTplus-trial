// This page runs on chrome-extension://, not on programming.pku.edu.cn.
export function chromeDataArea(name,storage){
  return {name,keys:async()=>Object.keys(await storage.get(null)),get:async key=>(await storage.get(key))[key],removeIfUnchanged:async(key,expected)=>{
    if(JSON.stringify((await storage.get(key))[key])!==expected)return false;
    await storage.remove(key);return (await storage.get(key))[key]===undefined;
  }};
}
export async function legacyCacheArea(factory=globalThis.indexedDB){
  const db=await new Promise((resolve,reject)=>{
    if(!factory){resolve(null);return;}
    const request=factory.open('pku-coach-cache-backups',1);let absent=false,blocked=false;
    // Do not create an empty persistent database when the old one is absent.
    request.onupgradeneeded=event=>{if(event.oldVersion===0){absent=true;request.transaction.abort();}};
    request.onerror=()=>absent?resolve(null):reject(new Error('无法读取旧版扩展缓存备份。'));
    request.onblocked=()=>{blocked=true;reject(new Error('旧版扩展备份被占用，请关闭旧扩展窗口后重试。'));};
    request.onsuccess=()=>{if(blocked){request.result.close();return;}resolve(request.result);};
  });
  if(!db)return null;
  if(!db.objectStoreNames.contains('records')){db.close();return null;}
  function transaction(mode,action){return new Promise((resolve,reject)=>{
    const tx=db.transaction('records',mode);let result;
    tx.oncomplete=()=>resolve(result);tx.onabort=()=>reject(tx.error||new Error('旧备份未能读取或移除，本机副本仍保留。'));
    tx.onerror=()=>{};
    try{action(tx.objectStore('records'),value=>result=value);}catch(error){tx.abort();reject(error);}
  });}
  return {name:'indexeddb',close:()=>db.close(),keys:()=>transaction('readonly',(store,done)=>{const request=store.getAllKeys();request.onsuccess=()=>done(request.result);}),get:key=>transaction('readonly',(store,done)=>{const request=store.get(key);request.onsuccess=()=>done(request.result?.value);}),removeIfUnchanged:(key,expected)=>transaction('readwrite',(store,done)=>{
    const request=store.get(key);request.onsuccess=()=>{if(JSON.stringify(request.result?.value)!==expected){done(false);return;}store.delete(key);done(true);};
  })};
}
