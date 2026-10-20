// Only our own controls and collapsible frame live in the website. No site storage,
// source reads, document/editor listeners, function patches, test or submit calls.
(() => {
  if(location.origin!=='https://programming.pku.edu.cn'||!/^\/probset\/[a-f0-9]{32}\/[a-f0-9]{32}\/ide\.do$/.test(location.pathname))return;
  const version='1.8.7',previous=document.getElementById('pku-coach-buttons');
  if(previous?.dataset.pkuCoachVersion===version)return;
  // Replace only a known previous coach host, never a website node with this id.
  if(previous&&!(previous.dataset.pkuCoachVersion||previous.style.zIndex==='2147483647'&&previous.style.contain==='layout style'))return;
  const host=document.createElement('div');host.id='pku-coach-buttons';
  host.dataset.pkuCoachVersion=version;
  host.style.cssText='all:initial!important;position:fixed!important;right:12px!important;bottom:66px!important;z-index:2147483647!important;display:block!important;width:max-content!important;height:auto!important;contain:layout style!important;';
  const root=host.attachShadow({mode:'closed'}),style=document.createElement('style');
  style.textContent='*{box-sizing:border-box}[hidden]{display:none!important}.buttons{display:flex;justify-content:flex-end;gap:5px}button{font:13px/1.4 system-ui,"Microsoft YaHei",sans-serif;padding:6px 10px;border:1px solid #b6ccd5;border-radius:7px;background:#fff;color:#18394d;cursor:pointer;box-shadow:0 2px 8px #173c4b22}.buttons button:first-child{background:#126b82;color:#fff;border-color:#126b82}button:disabled{opacity:.65;cursor:wait}button:focus-visible{outline:3px solid #86d0da;outline-offset:2px}button.error{background:#fff1f0;color:#a83535;border-color:#d6928a}.panel{display:flex;flex-direction:column;width:min(430px,calc(100vw - 24px));height:min(740px,calc(100dvh - 112px));max-height:calc(100vh - 112px);margin-bottom:8px;border:1px solid #bed1dc;border-radius:12px;background:#f7fafb;box-shadow:0 8px 30px #173c4b30;overflow:hidden;contain:layout style paint}.heading{display:flex;align-items:center;justify-content:space-between;flex:none;padding:9px 12px;border-bottom:1px solid #dce7ed;color:#16354b;font:600 14px/1.4 system-ui,"Microsoft YaHei",sans-serif}.heading button{padding:4px 9px;box-shadow:none;font-weight:400}.loading{padding:14px;color:#456574;font:13px/1.6 system-ui,"Microsoft YaHei",sans-serif}iframe{display:block;width:100%;flex:1;min-height:0;border:0;background:#f7fafb}';
  const panel=document.createElement('section');panel.className='panel';panel.hidden=true;panel.setAttribute('aria-label','C++ 学习教练');
  const heading=document.createElement('div');heading.className='heading';
  const title=document.createElement('span'),collapse=document.createElement('button');collapse.type='button';collapse.textContent='收起';collapse.setAttribute('aria-label','收起学习教练');heading.append(title,collapse);
  const loading=document.createElement('p');loading.className='loading';loading.textContent='正在读取本次题目与代码…';panel.append(heading,loading);
  const row=document.createElement('div');row.className='buttons';root.append(style,panel,row);
  let port;
  const controls=new Map(),requests=new Map();let activeMode,assistFrame;
  function show(mode){
    activeMode=mode;title.textContent='C++ 代码提示与交流';panel.hidden=false;
    loading.hidden=Boolean(assistFrame);
    for(const [type,button]of controls)if(type!=='quick_save')button.setAttribute('aria-expanded','true');
  }
  collapse.onclick=()=>{panel.hidden=true;for(const [type,button]of controls)if(type!=='quick_save')button.setAttribute('aria-expanded','false');};
  function connect(){
    if(port)return port;
    port=chrome.runtime.connect({name:'pku-coach-floating'});
    port.onDisconnect.addListener(()=>{port=null;for(const button of controls.values()){button.disabled=false;button.textContent=button.dataset.label;}});
    port.onMessage.addListener(msg=>{
      const button=requests.get(msg.actionId);if(!button)return;
      if(msg.type==='saved'){
        button.disabled=false;button.textContent='已保存';button.title='本次代码已保存到本机，后台分析继续。';
        setTimeout(()=>{if(!button.disabled)button.textContent=button.dataset.label;},1800);requests.delete(msg.actionId);
      }else if(msg.type==='tool_opened'){
        const target=new URL(msg.frameUrl),own=new URL(chrome.runtime.getURL('assist-window.html'));
        if(target.protocol!==own.protocol||target.host!==own.host||target.pathname!==own.pathname)return;
        if(!assistFrame||assistFrame.src!==target.href){
          const next=document.createElement('iframe');next.title='C++ 代码提示与交流';next.referrerPolicy='no-referrer';next.allow='clipboard-write';next.src=target.href;
          assistFrame?.remove();assistFrame=next;panel.append(next);
        }
        if(activeMode===msg.mode)loading.hidden=true;
        button.disabled=false;button.textContent=button.dataset.label;button.title='已打开右侧浮窗。';requests.delete(msg.actionId);
      }else if(msg.type==='error'){
        button.disabled=false;button.textContent='操作未完成';button.classList.add('error');button.title=msg.error||'尚未确认保存';requests.delete(msg.actionId);
        if(button===controls.get('open_'+(activeMode==='hint'?'hint':'discussion'))){loading.textContent=msg.error||'尚未确认本次操作，请重试。';loading.hidden=false;}
      }
    });return port;
  }
  for(const [label,type]of [['快捷保存','quick_save'],['提示','open_hint'],['交流','open_discussion']]){
    const button=document.createElement('button');button.type='button';button.textContent=label;button.dataset.label=label;button.setAttribute('aria-live','polite');controls.set(type,button);row.append(button);
    if(type!=='quick_save')button.setAttribute('aria-expanded','false');
    button.onclick=()=>{
      if(type!=='quick_save')show(type==='open_hint'?'hint':'discussion');
      loading.textContent='正在读取本次题目与代码…';
      const actionId=crypto.randomUUID();requests.set(actionId,button);button.disabled=true;button.classList.remove('error');button.textContent=type==='quick_save'?'保存中…':'打开中…';
      try{connect().postMessage({type,actionId,requestedAt:new Date().toISOString()});}
      catch(error){button.disabled=false;button.textContent='操作未完成';button.classList.add('error');button.title=error.message;requests.delete(actionId);}
    };
  }
  previous?.remove();document.documentElement.append(host);
})();
