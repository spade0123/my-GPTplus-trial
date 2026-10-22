(()=>{
  const api=globalThis.gridProblemApi,$=id=>document.getElementById(id);
  let currentUrl='',problems=[],busy=false,ready=false;const progress=new Map(),times=new Map();
  const names={AC:'Accepted',WA:'Wrong Answer',CE:'Compile Error',TLE:'Time Limit Exceeded',RE:'Runtime Error',MLE:'Memory Limit Exceeded',PE:'Presentation Error',OLE:'Output Limit Exceeded',PENDING:'等待网站回复',UNKNOWN:'结果未确认',MANUAL:'手工测试完成，需自行核对'};
  const duration=value=>{const seconds=Math.max(0,Math.floor(value/1000)),hours=Math.floor(seconds/3600),minutes=Math.floor(seconds/60)%60;return (hours?hours+':':'')+String(minutes).padStart(2,'0')+':'+String(seconds%60).padStart(2,'0');};
  function paintTimes(){for(const node of $('problemList').querySelectorAll('[data-time]')){const time=times.get(node.dataset.time);node.textContent=time?duration(time.elapsed+(time.startedAt===null?0:Math.max(0,Date.now()-time.startedAt))):'00:00';node.title='本题累计计时（切题时暂停）';}}
  const key=value=>{try{return new URL(value).pathname.replace(/^\/course\//,'/');}catch{return '';}};
  function render(){
    const query=$('problemSearch').value.trim().toLocaleLowerCase();
    $('problemList').replaceChildren();
    const current=problems.findIndex(item=>key(item.url)===key(currentUrl));
    $('problemPrevious').disabled=busy||!ready||current<=0;$('problemNext').disabled=busy||!ready||current<0||current>=problems.length-1;
    $('problemRefresh').disabled=busy||!ready||!currentUrl;$('problemSearch').disabled=busy;
    $('problemCount').textContent=problems.length?`${problems.length} 题`:'';
    for(const item of problems){
      if(query&&!`${item.number} ${item.title}`.toLocaleLowerCase().includes(query))continue;
      const li=document.createElement('li'),button=document.createElement('button'),selected=key(item.url)===key(currentUrl);
      const result=progress.get(key(item.url)),status=result?.status||'NONE',detail=result?`${result.source==='submit'?'正式提交':result.manual?'手工测试':'网站测试'} · ${names[status]||status} · ${Number.isFinite(Date.parse(result.createdAt))?new Date(result.createdAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'}):''}`:'本机暂无评测记录；未同步网站历史';
      const dot=document.createElement('span');dot.className='progress-dot status-'+status.toLowerCase();dot.title=detail;dot.setAttribute('role','img');dot.setAttribute('aria-label',detail);
      const label=document.createElement('span');label.className='problem-label';label.textContent=`${item.number}. ${item.title}${selected?' · 当前':''}`;
      const time=document.createElement('span');time.className='problem-time';time.dataset.time=key(item.url);
      button.append(dot,label,time);button.title=item.title+'\n'+detail;button.disabled=busy||!ready;button.setAttribute('aria-current',selected?'page':'false');
      button.onclick=()=>switchTo(item.url);li.append(button);$('problemList').append(li);
    }
    paintTimes();
    if(query&&!$('problemList').children.length){const li=document.createElement('li');li.textContent='没有匹配的题目';$('problemList').append(li);}
  }
  function switchTo(targetUrl){
    if(busy||!ready||!currentUrl)return;busy=true;$('navigationStatus').textContent='正在打开目标题目与对应源码…';render();api.postMessage({type:'switch_problem',problemUrl:currentUrl,targetUrl});
  }
  window.addEventListener('message',event=>{
    const value=event.data;
    if(value?.type==='problem_progress'){if(value.group){for(const id of progress.keys())if(id.startsWith('/probset/'+value.group+'/'))progress.delete(id);}else progress.clear();for(const item of value.items||[])progress.set(key(item.url),item);render();}
    if(value?.type==='problem_timing'){for(const item of value.items||[])times.set(key(item.url),item);paintTimes();}
    if(value?.type==='problem_display'){
      ready=Boolean(value.connected&&value.status==='ready');
      const changed=key(currentUrl)!==key(value.url);currentUrl=value.url||'';
      if(changed&&problems.length&&!problems.some(item=>key(item.url)===key(currentUrl))){problems=[];}
      render();
    }
    if(value?.type==='problem_navigation'){
      // Late replies for a former problem must not replace the visible list.
      if(value.problemUrl&&key(value.problemUrl)!==key(currentUrl))return;
      if(value.problems){problems=value.problems;}
      busy=Boolean(value.busy);$('navigationStatus').textContent=value.message||'';render();
    }
  });
  $('problemRefresh').onclick=()=>{if(busy)return;busy=true;render();api.postMessage({type:'refresh_problems',problemUrl:currentUrl});};
  $('problemSearch').oninput=render;
  $('problemPrevious').onclick=()=>{const index=problems.findIndex(item=>key(item.url)===key(currentUrl));if(index>0)switchTo(problems[index-1].url);};
  $('problemNext').onclick=()=>{const index=problems.findIndex(item=>key(item.url)===key(currentUrl));if(index>=0&&index<problems.length-1)switchTo(problems[index+1].url);};
  setInterval(paintTimes,1000);
  api.postMessage({type:'progress_ready'});
  api.postMessage({type:'navigation_ready'});
})();
