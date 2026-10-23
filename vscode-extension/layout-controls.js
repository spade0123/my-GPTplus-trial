(()=>{
  const $=id=>document.getElementById(id),header=document.querySelector('header');if(!header||!$('closeCoach'))return;
  document.body.classList.add('coach-workspace');
  const port=chrome.runtime.connect(),hint=$('hintPanel'),sample=$('samplePanel'),judge=$('ojPanel');
  const row=document.createElement('div');row.className='coach-top-row';
  const brand=document.createElement('span');brand.className='coach-brand';brand.textContent='OpenJudge';
  const actions=document.createElement('div');actions.className='coach-primary-actions';
  for(const [id,label]of [['runSample',hint?'运行样例':'重新运行'],['submitOJ',null],['closeCoach',null]]){const button=$(id);if(!button)continue;if(label)button.textContent=label;actions.append(button);}
  const more=document.createElement('details');more.id='coachMore';more.className='coach-more';
  const summary=document.createElement('summary');summary.textContent='更多';more.append(summary);
  const menu=document.createElement('div');menu.className='coach-more-menu';more.append(menu);
  for(const element of [document.querySelector('.coach-utility-actions'),$('bindingControls'),$('context'),document.querySelector('.coach-snapshot-meta')])if(element)menu.append(element);
  row.append(brand,actions,more);header.prepend(row);
  const current=document.createElement('p');current.className='coach-current';current.textContent=hint?'提示与交流':'测试运行';
  const freshness=document.createElement('p');freshness.className='coach-freshness';freshness.setAttribute('role','status');header.append(current,freshness);
  if(hint){
    for(const panel of [sample,judge])if(panel&&hint.contains(panel)){const custom=panel.nextElementSibling?.classList.contains('custom-test')?panel.nextElementSibling:null;hint.after(panel);if(custom)panel.after(custom);}
  }
  const tabs=document.createElement('nav');tabs.className='coach-tabs';tabs.setAttribute('aria-label','教练内容导航');header.append(tabs);
  const modes=hint?[['hint','解题提示'],['chat','交流'],['test','测试结果'],['oj','OJ 提交']]:[['test','测试结果'],['oj','OJ 提交']];
  const buttons=new Map();let focus=hint?'hint':'test',snapshot,version;
  function sync(){for(const [mode,button]of buttons){const panel=mode==='test'?sample:mode==='oj'?judge:hint;button.disabled=!panel||panel.hidden;button.setAttribute('aria-pressed',String(mode===focus));}}
  function select(mode,{scroll=false}={}){
    if(!buttons.has(mode))return;focus=mode;document.body.dataset.coachFocus=mode;
    if(mode==='chat'&&$('chatPanel'))$('chatPanel').open=true;
    if(mode==='hint'&&$('chatPanel'))$('chatPanel').open=false;
    sync();if(scroll){more.open=false;window.scrollTo({top:0,behavior:'auto'});}
  }
  for(const [mode,label]of modes){const button=document.createElement('button');button.type='button';button.textContent=label;button.dataset.coachTab=mode;button.onclick=()=>select(mode,{scroll:true});buttons.set(mode,button);tabs.append(button);}
  function fresh(){if(!snapshot)return;current.textContent=snapshot.title;document.body.dataset.hasSnapshot='true';const stale=Number.isInteger(version)&&version!==snapshot.documentVersion;freshness.textContent=snapshot.sourceName+' · '+new Date(snapshot.savedAt).toLocaleTimeString('zh-CN',{hour12:false})+(stale?' · 代码已修改，请重新运行或更新提示':' · 本次代码已保存');freshness.classList.toggle('stale',stale);}
  document.addEventListener('click',event=>{
    if(more.open&&!more.contains(event.target))more.open=false;
    const id=event.target.closest?.('button')?.id;
    if(['submitOJ','refreshOJ'].includes(id))select('oj');
    if(id==='runSample'||event.target.closest?.('.custom-test button[type=submit]'))select('test');
    if(['refreshHint','forceHint','giveSolution'].includes(id))select('hint');
    if(id==='send')select('chat');
  });
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&more.open){more.open=false;summary.focus();event.preventDefault();}});
  const toolbarHeight=()=>document.body.style.setProperty('--coach-toolbar-height',Math.ceil(header.getBoundingClientRect().height+12)+'px');
  if(globalThis.ResizeObserver)new ResizeObserver(toolbarHeight).observe(header);toolbarHeight();
  port.onMessage.addListener(message=>{
    if(message.snapshot){snapshot=message.snapshot;version=message.currentDocumentVersion??version;fresh();}
    if(message.type==='source_changed'){version=message.version;fresh();}
    if(message.type==='resume_context')select(message.mode==='discussion'?'chat':'hint');
    queueMicrotask(sync);
  });
  select(focus);
})();
