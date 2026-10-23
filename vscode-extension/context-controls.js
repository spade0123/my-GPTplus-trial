(()=>{
  const port=chrome.runtime.connect(),header=document.querySelector('header');if(!header)return;
  const nav=document.createElement('div');nav.className='coach-utility-actions';
  for(const [label,type]of [['历史版本','show_versions'],['模型设置','show_models']]){const button=document.createElement('button');button.type='button';button.textContent=label;button.onclick=()=>port.postMessage({type});nav.append(button);}
  header.after(nav);const meta=document.createElement('p');meta.className='coach-snapshot-meta';meta.setAttribute('role','status');nav.after(meta);
  let snapshot,currentVersion;
  function display(){if(!snapshot)return;const changed=Number.isInteger(currentVersion)&&currentVersion!==snapshot.documentVersion;meta.textContent=snapshot.title+' · '+new URL(snapshot.problemUrl).pathname+' · '+snapshot.sourceName+' · 文档版本 '+snapshot.documentVersion+' · '+new Date(snapshot.savedAt).toLocaleTimeString('zh-CN')+' · 源码 '+snapshot.codeHash.slice(0,8)+(changed?' · 编辑器代码已修改，以上内容对应保存时的版本':'');meta.classList.toggle('stale',changed);}
  port.onMessage.addListener(m=>{if(m.type==='source_changed'){currentVersion=m.version;display();}if(m.snapshot){snapshot=m.snapshot;currentVersion=m.currentDocumentVersion??currentVersion;display();}});
})();
