// MAIN world, document_start: the website caches problem JSON before rendering
// it and before binding its Test button. A full cache must not abort that chain.
(() => {
  if(location.origin!=='https://programming.pku.edu.cn'||!/^\/probset\/[a-f0-9]{32}\/[a-f0-9]{32}\/ide\.do$/.test(location.pathname)||window.__pkuCoachCacheGuard)return;
  const original=Storage.prototype.setItem;
  const state={skippedCacheWrites:0,quotaFailures:0,pageId:crypto.randomUUID()};window.__pkuCoachCacheGuard=state;
  let scanTimer;
  const pressure=()=>document.dispatchEvent(new CustomEvent('pku-coach-storage-pressure'));
  function scan(){
    clearTimeout(scanTimer);
    scanTimer=null;
    try{
      let units=0;for(let i=0;i<localStorage.length;i++){const key=localStorage.key(i);units+=key.length+(localStorage.getItem(key)?.length||0);}
      if(units>=2*1024*1024)pressure();
    }catch{/* A blocked Storage API keeps its original errors. */}
  }
  const schedule=()=>{if(!scanTimer)scanTimer=setTimeout(scan,1000);};
  Storage.prototype.setItem=function(key,value){
    try{const result=Reflect.apply(original,this,arguments);if(this===window.localStorage)schedule();return result;}
    catch(error){
      if(error?.name==='QuotaExceededError'&&this===window.localStorage){state.quotaFailures++;pressure();}
      // Only expendable website problem/problem-list caches. Never suppress
      // a failed write of source, backup, account, session, or arbitrary data.
      if(error?.name!=='QuotaExceededError'||this!==window.localStorage||typeof key!=='string'||!/^(?:problem|problemlist)_[a-f0-9]{32}$/.test(key))throw error;
      state.skippedCacheWrites++;
      document.dispatchEvent(new CustomEvent('pku-coach-cache-notice'));
      // The AJAX handler already holds the fresh problem in memory. Returning
      // lets its original renderer, code loader, and button setup continue.
    }
  };
  window.addEventListener('storage',schedule);
  scan();setInterval(scan,30000);
})();
