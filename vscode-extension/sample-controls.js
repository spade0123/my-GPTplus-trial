(()=>{
  const api=acquireVsCodeApi(),listeners=[],$=id=>document.getElementById(id);
  // Reuse the same official-submit controller as the hint window; no browser storage.
  globalThis.chrome={runtime:{connect:()=>({postMessage:message=>api.postMessage(message),onMessage:{addListener:fn=>listeners.push(fn)}})}};
  $('closeCoach').onclick=()=>api.postMessage({type:'sample_collapse'});
  window.addEventListener('message',event=>{
    const value=event.data;
    if(value.type==='sample_view'){
      $('sampleTitle').textContent=value.title||'保存并运行题目样例';
      $('sampleSaved').hidden=!value.saved;
      $('sampleWorker').hidden=!value.workerError;
      $('sampleWorker').textContent=value.workerError?'源码已保存，后台分析启动失败：'+value.workerError:'';
      if(!value.result){
        $('sampleState').textContent=value.error?(value.saved?'代码已保存；测试未完成：':'尚未确认保存：')+value.error:value.message||'正在保存当前完整代码…';
        $('sampleState').className='state'+(value.error?' error':'');
        return;
      }
      for(const listener of listeners)listener({...value,type:'sample_result'});
    }else for(const listener of listeners)listener(value);
  });
  window.addEventListener('DOMContentLoaded',()=>api.postMessage({type:'sample_ready'}),{once:true});
})();
