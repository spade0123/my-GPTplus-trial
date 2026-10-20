(() => {
  const api=acquireVsCodeApi(),listeners=[],pendingCopies=new Map();
  globalThis.chrome={runtime:{connect:()=>({onMessage:{addListener:fn=>listeners.push(fn)},onDisconnect:{addListener(){}},postMessage:message=>api.postMessage(message)})}};
  window.addEventListener('message',event=>{
    const message=event.data;
    if(message.type==='copy_reply'){
      const pending=pendingCopies.get(message.id);if(pending){pendingCopies.delete(message.id);clearTimeout(pending.timer);message.error?pending.reject(new Error(message.error)):pending.resolve();}return;
    }
    for(const listener of listeners)listener(message);
  });
  Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:text=>new Promise((resolve,reject)=>{
    const id=crypto.randomUUID(),timer=setTimeout(()=>{pendingCopies.delete(id);reject(new Error('复制未确认'));},5000);
    pendingCopies.set(id,{resolve,reject,timer});api.postMessage({type:'copy_code',id,text});
  })}});
  const state=()=>({question:document.getElementById('question')?.value||'',chatOpen:document.getElementById('chatPanel')?.open||false});
  document.getElementById('closeCoach').onclick=()=>api.postMessage({type:'collapse',ui:state()});
  document.getElementById('bindProblem').onclick=()=>api.postMessage({type:'bind_problem'});
  document.getElementById('showRecords').onclick=()=>api.postMessage({type:'show_records'});
  let timer;
  document.getElementById('question')?.addEventListener('input',()=>{clearTimeout(timer);timer=setTimeout(()=>api.postMessage({type:'draft',ui:state()}),150);});
})();
