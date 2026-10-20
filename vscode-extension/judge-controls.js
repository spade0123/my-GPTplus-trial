(()=>{
  const $=id=>document.getElementById(id),port=chrome.runtime.connect(),sampleLabels={passed:'样例输出一致',whitespace:'仅空白不同，请核对格式',wrong_answer:'与样例输出不同',compile_error:'编译失败',runtime_error:'运行错误',timeout:'超过时间限制',output_limit:'输出超过限制'};
  let prepared=false,jobId,timer,refreshes=0,busy=false;
  const send=(type,extra={})=>port.postMessage({type,...extra,actionId:crypto.randomUUID(),requestedAt:new Date().toISOString()});
  function block(parent,label,text){const box=document.createElement('div');box.className='execution-block';const h=document.createElement('h4'),pre=document.createElement('pre'),code=document.createElement('code');h.textContent=label;code.textContent=String(text||'（空）');pre.append(code);box.append(h,pre);parent.append(box);}
  function sample(value){
    if(!value?.result)return;const r=value.result;$('samplePanel').hidden=false;$('sampleState').textContent=(sampleLabels[r.status]||r.status)+' · '+r.durationMs+' ms · 源码 '+(value.codeHash||r.codeHash||'').slice(0,8)+'；样例一致不代表网站 AC。';
    $('sampleState').className=r.status==='passed'?'execution-pass':'execution-fail';$('sampleResults').replaceChildren();
    block($('sampleResults'),'例子输入',r.input);const grid=document.createElement('div');grid.className='execution-grid';$('sampleResults').append(grid);block(grid,'预期输出',r.expected);block(grid,'实际输出',r.actual);
    if(r.compiler||r.stderr){const details=document.createElement('details'),summary=document.createElement('summary');summary.textContent='编译与运行信息';details.append(summary);block(details,'诊断',[r.compiler,r.stderr].filter(Boolean).join('\n'));$('sampleResults').append(details);}
  }
  $('runSample').onclick=()=>{$('runSample').disabled=true;$('samplePanel').hidden=false;$('sampleState').textContent='正在保存本次代码并编译，随后运行题目样例…';send('run_sample');};
  $('submitOJ').onclick=()=>{
    if(busy)return;busy=true;$('submitOJ').disabled=true;$('ojPanel').hidden=false;
    if(!prepared){$('ojState').textContent='正在读取本题提交入口与 C++ 编译器选项…';send('oj_prepare');}
    else{$('ojState').textContent='正在保存本次完整代码并提交；此操作只发送一次…';refreshes=0;clearTimeout(timer);send('oj_submit',{language:$('ojLanguage').value});}
  };
  const refresh=()=>{if(!jobId)return;$('refreshOJ').disabled=true;send('oj_refresh',{id:jobId});};$('refreshOJ').onclick=refresh;
  port.onMessage.addListener(value=>{
    if(value.type==='sample_result'){sample(value);$('runSample').disabled=false;return;}
    if(value.type==='oj_prepared'){
      $('ojLanguage').replaceChildren();for(const item of value.languages.filter(o=>/c\+\+|g\+\+/i.test(o.label))){const option=document.createElement('option');option.value=item.value;option.textContent=item.label;option.selected=item.selected;$('ojLanguage').append(option);}
      prepared=true;busy=false;$('submitOJ').disabled=false;$('ojLanguageRow').hidden=false;$('ojState').textContent='已核对 IDE 提交入口。选择编译器，再点“提交到编程网格”发送当前代码。';return;
    }
    if(value.type==='oj_result'){
      busy=false;jobId=value.id;$('submitOJ').disabled=false;$('refreshOJ').disabled=false;$('ojPanel').hidden=false;const s=value.submission;
      $('ojState').textContent=value.error|| (s?'提交 '+s.submissionId+'：'+s.verdict.text+' · 源码 '+(value.codeHash||'').slice(0,8):value.message||'已提交，正在读取评测。');
      $('ojResults').replaceChildren();if(s?.runtime?.error)block($('ojResults'),'网站编译信息',s.runtime.error);
      if(value.receipt?.solutionUrl){const a=document.createElement('a');a.href=value.receipt.solutionUrl;a.textContent='查看这次提交详情';$('ojResults').append(a);}
      clearTimeout(timer);if(!value.error&&s&&['pending','unknown'].includes(s.verdict.status)&&++refreshes<30)timer=setTimeout(refresh,2000);
      else if(!value.error&&!s&&value.receipt?.solutionUrl&&++refreshes<30)timer=setTimeout(refresh,2000);
      return;
    }
    if(value.type==='error'&&['run_sample','sample_history','oj_prepare','oj_submit','oj_refresh'].includes(value.requestType)){
      busy=false;$('submitOJ').disabled=false;$('runSample').disabled=false;$('refreshOJ').disabled=!jobId;
      $(value.requestType.startsWith('oj_')?'ojState':'sampleState').textContent=value.error;
    }
  });
  send('sample_history');
})();
