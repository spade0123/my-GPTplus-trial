(()=>{
  const native=globalThis.chrome?.webview,session=document.body.dataset.floatingSession;
  if(!native||!session)throw new Error('学习教练浮窗连接不可用。');
  const post=message=>native.postMessage({floatingSession:session,message});
  globalThis.acquireVsCodeApi=()=>({postMessage:post});
  native.addEventListener('message',event=>{
    const value=event.data;if(value?.floatingSession!==session)return;
    if(value.message?.type==='floating_snapshot_request'){
      post({type:'floating_snapshot',id:value.message.id,ui:{question:document.getElementById('question')?.value||'',chatOpen:document.getElementById('chatPanel')?.open===true}});return;
    }
    window.dispatchEvent(new MessageEvent('message',{data:value.message}));
  });
  document.addEventListener('click',event=>{const a=event.target.closest?.('a[href]');if(!a)return;const href=a.getAttribute('href');if(!href||href.startsWith('#'))return;event.preventDefault();post({type:'open_link',url:a.href,...(document.body.dataset.session?{viewSession:document.body.dataset.session}:{})});});
  window.addEventListener('DOMContentLoaded',()=>post({type:'floating_ready'}),{once:true});
})();
