(()=>{
  const api=acquireVsCodeApi(),title=document.getElementById('title'),state=document.getElementById('state'),sections=document.getElementById('sections'),open=document.getElementById('openProblem');
  globalThis.gridProblemApi=api;
  const labels={description:'题目描述',input:'关于输入',output:'关于输出',sampleInput:'例子输入',sampleOutput:'例子输出'};
  let generation=0,revision,queue=[],pending=null;
  const cache=new Map();
  function applyImage(target,value){
    if(typeof value.dataUrl!=='string'||!/^data:image\/(?:png|webp);base64,[A-Za-z0-9+/]+=*$/.test(value.dataUrl)||value.dataUrl.length>170000){target.note.textContent=value.error||'参考图读取失败，请在页面底部打开原题查看。';target.note.classList.add('error');return;}
    const img=document.createElement('img');img.alt=target.alt;img.src=value.dataUrl;
    if(Number.isInteger(value.width)&&value.width>0&&value.width<=1600)img.width=value.width;
    img.onerror=()=>{target.note.hidden=false;target.note.textContent='图片无法显示，请在原题查看。';};
    target.figure.prepend(img);target.note.hidden=true;
  }
  function nextImage(){
    if(pending||!queue.length)return;
    pending=queue.shift();
    api.postMessage({type:'problem_image',requestId:pending.requestId,revision,problemUrl:pending.url,imageId:pending.id});
    pending.timeout=setTimeout(()=>{
      if(!pending)return;pending.note.textContent='参考图读取超时，请刷新题面或在原题查看。';pending=null;nextImage();
    },12000);
  }
  function figureFor(image,value){
    const figure=document.createElement('figure'),note=document.createElement('figcaption');figure.className='problem-figure';note.textContent='正在读取参考图…';figure.append(note);
    const target={figure,note,alt:image.alt||'题目参考图',id:image.id,url:value.url,requestId:`${generation}:${queue.length}:${image.id}`,cacheKey:`${value.url}|${value.revision}|${image.id}`};
    if(cache.has(target.cacheKey))applyImage(target,cache.get(target.cacheKey));else queue.push(target);
    return figure;
  }
  function appendText(section,text){
    if(!text.trim())return;
    const article=document.createElement('article');article.className='markdown';globalThis.PkuReportRenderer.render(article,text);section.append(article);
  }
  window.addEventListener('message',event=>{
    const value=event.data;
    if(value?.type==='problem_image'){
      if(!pending||value.revision!==revision||value.requestId!==pending.requestId)return;
      clearTimeout(pending.timeout);applyImage(pending,value);
      if(value.dataUrl){cache.set(pending.cacheKey,{dataUrl:value.dataUrl,width:value.width,height:value.height});while(cache.size>24)cache.delete(cache.keys().next().value);}
      pending=null;nextImage();return;
    }
    if(value?.type!=='problem_display')return;
    ++generation;revision=value.revision;queue=[];if(pending)clearTimeout(pending.timeout);pending=null;
    title.textContent=value.page?.title||(['loading','error'].includes(value.status)?'题面读取中':'等待浏览器打开题目');
    open.hidden=!value.url;
    const source=document.getElementById('problemUrl');source.textContent=value.url||'';source.hidden=!value.url;
    state.textContent=value.connected?(value.status==='ready'?'随浏览器题目自动更新':value.error||'正在读取新题目…'):(value.page?'浏览器连接已断开，当前显示上次题面；重新连接后自动更新。':'请在 Chrome 点击 编程网格 连接扩展；打开具体题目后自动显示。');
    state.classList.toggle('error',value.status==='error');sections.replaceChildren();
    if(!value.page||value.status!=='ready')return;
    for(const [key,label]of Object.entries(labels)){
      const section=document.createElement('section'),heading=document.createElement('h2');heading.textContent=label;section.append(heading);
      const text=value.page.problem?.[key]||'';
      const images=(value.page.images||[]).filter(image=>image.section===key&&Number.isInteger(image.offset)&&image.offset>=0&&image.offset<=text.length).sort((a,b)=>a.offset-b.offset);
      if(key.startsWith('sample')){
        if(text){const copy=document.createElement('button');copy.className='copy';copy.textContent='复制';copy.onclick=()=>api.postMessage({type:'copy_sample',text});heading.append(copy);}
        const pre=document.createElement('pre'),code=document.createElement('code');code.textContent=text||'题面未提供此项';pre.append(code);section.append(pre);
        for(const image of images)section.append(figureFor(image,value));
      }else{
        let start=0;
        for(const image of images){appendText(section,text.slice(start,image.offset));section.append(figureFor(image,value));start=image.offset;}
        appendText(section,text.slice(start)||(!images.length?'题面未提供此项':''));
      }
      sections.append(section);
    }
    nextImage();
  });
  open.onclick=()=>api.postMessage({type:'open_problem'});api.postMessage({type:'ready'});
})();
