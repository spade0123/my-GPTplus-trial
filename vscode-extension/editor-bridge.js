(()=>{
  const api=acquireVsCodeApi(),session=document.body.dataset.editorSession;
  if(!session)throw new Error('学习教练标签页连接不可用。');
  const post=message=>api.postMessage({...message,editorSession:session});
  globalThis.acquireVsCodeApi=()=>Object.freeze({postMessage:post});
  const ui=()=>({question:document.getElementById('question')?.value||'',chatOpen:document.getElementById('chatPanel')?.open===true});
  window.addEventListener('message',event=>{if(event.data?.type==='editor_snapshot_request')post({type:'editor_snapshot',id:event.data.id,ui:ui()});});
  document.addEventListener('input',event=>{if(event.target.id==='question')post({type:'editor_draft',ui:ui()});});
  document.addEventListener('toggle',event=>{if(event.target.id==='chatPanel')post({type:'editor_draft',ui:ui()});},true);
  document.addEventListener('click',event=>{const a=event.target.closest?.('a[href]');if(!a)return;const href=a.getAttribute('href');if(!href||href.startsWith('#'))return;event.preventDefault();post({type:'open_link',url:a.href,...(document.body.dataset.session?{viewSession:document.body.dataset.session}:{})});});
  window.addEventListener('DOMContentLoaded',()=>post({type:'editor_ready'}),{once:true});
})();
