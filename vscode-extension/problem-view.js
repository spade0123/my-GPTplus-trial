(()=>{
  const api=acquireVsCodeApi(),title=document.getElementById('title'),state=document.getElementById('state'),sections=document.getElementById('sections'),open=document.getElementById('openProblem');
  const labels={description:'题目描述',input:'关于输入',output:'关于输出',sampleInput:'例子输入',sampleOutput:'例子输出'};
  const $=id=>document.getElementById(id);let library=[],filtered=[],currentUrl='',pendingKey='';
  const identity=url=>{try{const u=new URL(url);return u.host+u.pathname;}catch{return '';}};
  function position(){
    const current=filtered.findIndex(p=>identity(p.url)===identity(currentUrl));
    $('libraryPosition').textContent=current>=0?(current+1)+' / '+filtered.length:filtered.length+' 题';
    $('previousProblem').disabled=Boolean(pendingKey)||current<1;
    $('nextProblem').disabled=Boolean(pendingKey)||!filtered.length||current===filtered.length-1;
    $('libraryProblem').disabled=Boolean(pendingKey)||!filtered.length;
    $('libraryProblem').value=current>=0?filtered[current].key:'';
  }
  function filterLibrary(){
    const term=$('librarySearch').value.trim().toLowerCase(),platform=$('libraryPlatform').value,level=$('libraryLevel').value;
    filtered=library.filter(p=>(!platform||p.platform===platform)&&(!level||String(p.level)===level)&&(!term||[p.id,p.title,p.topic,p.knowledge].join(' ').toLowerCase().includes(term)));
    $('libraryProblem').replaceChildren();const placeholder=document.createElement('option');placeholder.value='';placeholder.textContent='选择题目（'+filtered.length+' 题）';$('libraryProblem').append(placeholder);
    for(const p of filtered){const option=document.createElement('option');option.value=p.key;option.textContent=p.platform+' '+p.id+' · '+p.title+(p.priority?' ★':'');$('libraryProblem').append(option);}position();
  }
  function navigate(key){if(!key||pendingKey)return;pendingKey=key;position();$('libraryState').classList.remove('error');$('libraryState').textContent='正在打开原题…';api.postMessage({type:'library_open',key});}
  if($('library')){
    for(const id of ['librarySearch','libraryPlatform','libraryLevel'])$(id).addEventListener('input',filterLibrary);
    $('libraryProblem').onchange=()=>navigate($('libraryProblem').value);
    $('previousProblem').onclick=()=>{const i=filtered.findIndex(p=>identity(p.url)===identity(currentUrl));if(i>0)navigate(filtered[i-1].key);};
    $('nextProblem').onclick=()=>{const i=filtered.findIndex(p=>identity(p.url)===identity(currentUrl));if(i<filtered.length-1)navigate(filtered[i+1].key);};
  }
  window.addEventListener('message',event=>{
    const value=event.data;
    if(value?.type==='problem_library'&&$('library')){library=value.items||[];filterLibrary();return;}
    if(value?.type==='library_focus'&&$('library')){$('library').open=true;$('librarySearch').focus();return;}
    if(['library_opened','library_error'].includes(value?.type)&&$('library')){
      if(value.requestKey!==pendingKey)return;pendingKey='';
      if(value.type==='library_opened'){currentUrl=value.url;$('libraryState').textContent='已切换题目；源码保持原样，保存按题号独立。';}
      else{$('libraryState').textContent=value.error;$('libraryState').classList.add('error');}position();return;
    }
    if(value?.type!=='problem_display')return;
    currentUrl=value.url||'';if($('library'))position();
    title.textContent=value.page?.title||(['loading','error'].includes(value.status)?'题面读取中':'等待浏览器打开题目');
    open.hidden=!value.url;
    state.textContent=value.connected?(value.status==='ready'?'随浏览器题目自动更新 · '+value.url:value.error||'正在读取新题目…'):(value.page?'浏览器连接已断开，当前显示上次题面；重新连接后自动更新。':'请在 Chrome 点击 OpenJudge 连接扩展；打开具体题目后自动显示。');
    state.classList.toggle('error',value.status==='error');sections.replaceChildren();
    if(!value.page||value.status!=='ready')return;
    for(const [key,label]of Object.entries(labels)){
      const section=document.createElement('section'),heading=document.createElement('h2');heading.textContent=label;section.append(heading);
      const text=value.page.problem?.[key]||'';
      if(key.startsWith('sample')){
        if(text){const copy=document.createElement('button');copy.className='copy';copy.textContent='复制';copy.onclick=()=>api.postMessage({type:'copy_sample',text});heading.append(copy);}
        const pre=document.createElement('pre'),code=document.createElement('code');code.textContent=text||'题面未提供此项';pre.append(code);section.append(pre);
      }else{const article=document.createElement('article');article.className='markdown';globalThis.PkuReportRenderer.render(article,text||'题面未提供此项');section.append(article);}
      sections.append(section);
    }
  });
  open.onclick=()=>api.postMessage({type:'open_problem'});api.postMessage({type:'ready'});
})();
