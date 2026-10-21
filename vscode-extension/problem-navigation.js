(()=>{
  const api=globalThis.gridProblemApi,$=id=>document.getElementById(id);
  let currentUrl='',problems=[],busy=false,ready=false;
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
      button.textContent=`${item.number}. ${item.title}${selected?' · 当前':''}`;button.title=item.title;button.disabled=busy||!ready;button.setAttribute('aria-current',selected?'page':'false');
      button.onclick=()=>switchTo(item.url);li.append(button);$('problemList').append(li);
    }
    if(query&&!$('problemList').children.length){const li=document.createElement('li');li.textContent='没有匹配的题目';$('problemList').append(li);}
  }
  function switchTo(targetUrl){
    if(busy||!ready||!currentUrl)return;busy=true;$('navigationStatus').textContent='正在打开目标题目与对应源码…';render();api.postMessage({type:'switch_problem',problemUrl:currentUrl,targetUrl});
  }
  window.addEventListener('message',event=>{
    const value=event.data;
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
  api.postMessage({type:'navigation_ready'});
})();
