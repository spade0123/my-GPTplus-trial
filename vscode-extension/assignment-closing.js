(()=>{
  const element=document.getElementById('assignmentClosing');let closesAt=null,currentUrl='';
  const group=url=>{try{return new URL(url).pathname.match(/\/probset\/([a-f0-9]{32})\//i)?.[1]?.toLowerCase();}catch{return undefined;}};
  function paint(){
    element.classList.remove('soon','closed');
    if(!Number.isFinite(closesAt)){element.textContent='未读到精确截止时间';element.title='网页的整数剩余天数不能推算精确截止时刻；刷新题单可重新读取。';return;}
    element.title='题集关闭时间（北京时间）：'+new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(closesAt)+'。按本机时间计算。';
    const remaining=closesAt-Date.now();
    if(remaining<=0){element.textContent='已到题集关闭时间';element.classList.add('closed');return;}
    element.classList.toggle('soon',remaining<=24*60*60*1000);
    if(remaining<60000){element.textContent='不到 1 分钟后题集关闭';return;}
    const minutes=Math.floor(remaining/60000),days=Math.floor(minutes/1440),hours=Math.floor(minutes/60)%24,rest=minutes%60;
    element.textContent=[days&&days+' 天',hours&&hours+' 小时',rest&&rest+' 分钟'].filter(Boolean).join(' ')+'后题集关闭';
  }
  window.addEventListener('message',event=>{
    const value=event.data;
    if(value?.type==='problem_display'){
      if(group(currentUrl)!==group(value.url))closesAt=null;
      currentUrl=value.url||'';paint();
    }
    if(value?.type==='problem_navigation'&&(!value.problemUrl||group(value.problemUrl)===group(currentUrl))){
      if(Object.hasOwn(value,'closesAt'))closesAt=Number.isFinite(value.closesAt)?value.closesAt:null;
      paint();
    }
  });
  // No network polling: repaint from the one precise timestamp and the local clock.
  setInterval(paint,1000);paint();
  globalThis.gridProblemApi.postMessage({type:'closing_ready'});
})();
