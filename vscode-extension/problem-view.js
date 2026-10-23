(()=>{
  const api=acquireVsCodeApi(),title=document.getElementById('title'),state=document.getElementById('state'),sections=document.getElementById('sections'),open=document.getElementById('openProblem');
  globalThis.gridProblemApi=api;
  const labels={description:'题目描述',input:'关于输入',output:'关于输出',sampleInput:'例子输入',sampleOutput:'例子输出'};
  window.addEventListener('message',event=>{
    const value=event.data;if(value?.type!=='problem_display')return;
    title.textContent=value.page?.title||(['loading','error'].includes(value.status)?'题面读取中':'等待浏览器打开题目');
    open.hidden=!value.url;
    const source=document.getElementById('problemUrl');source.textContent=value.url||'';source.hidden=!value.url;
    state.textContent=value.connected?(value.status==='ready'?'随浏览器题目自动更新':value.error||'正在读取新题目…'):(value.page?'浏览器连接已断开，当前显示上次题面；重新连接后自动更新。':'请在 Chrome 点击 编程网格 连接扩展；打开具体题目后自动显示。');
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
