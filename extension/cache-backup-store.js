// Runs only in the extension service worker, never in the host page. IndexedDB
// keeps rebuildable cache archives outside chrome.storage.local's draft quota.
export function createCacheBackupStore(factory=globalThis.indexedDB){
  let opened;
  const open=()=>opened||=(new Promise((resolve,reject)=>{
    if(!factory){reject(new Error('缓存备份存储不可用，尚未清理。'));return;}
    const request=factory.open('pku-coach-cache-backups',1);
    let blocked=false;
    request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains('records'))request.result.createObjectStore('records',{keyPath:'key'});};
    request.onerror=()=>reject(new Error('无法打开缓存备份，尚未清理。'));
    request.onblocked=()=>{blocked=true;reject(new Error('缓存备份暂被占用，尚未清理。'));};
    request.onsuccess=()=>{const db=request.result;if(blocked){db.close();return;}db.onversionchange=()=>{db.close();opened=null;};resolve(db);};
  })).catch(error=>{opened=null;throw error;});
  async function transaction(mode,action){
    const db=await open();
    return new Promise((resolve,reject)=>{
      const tx=db.transaction('records',mode);let result;
      tx.oncomplete=()=>resolve(result);
      tx.onabort=()=>reject(new Error('缓存备份未确认写入；网站缓存尚未删除。'));
      tx.onerror=()=>{};
      try{action(tx.objectStore('records'),value=>{result=value;});}catch(error){tx.abort();reject(error);}
    });
  }
  return {
    set:values=>transaction('readwrite',store=>{for(const [key,value] of Object.entries(values))store.put({key,value});}),
    get:key=>transaction('readonly',(store,done)=>{const request=store.get(key);request.onsuccess=()=>done({[key]:request.result?.value});})
  };
}
