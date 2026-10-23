(()=>{
  const $=id=>document.getElementById(id),port=chrome.runtime.connect(),sampleLabels={executed:'已运行，未提供预期输出',passed:'样例输出一致',whitespace:'仅空白不同，请核对格式',wrong_answer:'WA · 答案错误',compile_error:'CE · 编译错误',runtime_error:'RE · 运行错误',timeout:'TLE · 超过本机时间限制',memory_limit:'MLE · 达到本机内存限制',output_limit:'OLE · 输出超限',compile_timeout:'编译超时，程序未运行',compile_output_limit:'编译输出超限，程序未运行',runner_error:'测试环境错误，程序未运行'};
  let prepared=false,jobId,timer,refreshes=0,busy=false,submitAction,refreshAction;
  const send=(type,extra={})=>{const actionId=crypto.randomUUID();port.postMessage({type,...extra,actionId,requestedAt:new Date().toISOString()});return actionId;};
  const chat=$('chatPanel');if(chat&&$('hintPanel'))$('hintPanel').prepend(chat);
  function pinStatus(){const panel=$('ojPanel');document.querySelector('header')?.after(panel);panel.hidden=false;panel.scrollIntoView?.({block:'start',behavior:'auto'});}
  function block(parent,label,text){const box=document.createElement('div');box.className='execution-block';const h=document.createElement('h4'),pre=document.createElement('pre'),code=document.createElement('code');h.textContent=label;code.textContent=String(text||'（空）');pre.append(code);box.append(h,pre);parent.append(box);}
  function submissionDetails(submission){
    if(!submission)return;
    const details=submission.details||{},list=document.createElement('dl');list.className='oj-details';list.setAttribute('aria-label','本次 OJ 提交基本信息');
    for(const [label,value]of [['提交编号',submission.submissionId],['题号',details.problemId],['提交人',details.submitter],['内存',details.memory],['耗时',details.time],['编译语言',details.language],['提交时间',details.submittedAt]]){
      const term=document.createElement('dt'),description=document.createElement('dd');term.textContent=label;description.textContent=value||'未提供';list.append(term,description);
    }
    const container=document.createElement('details'),heading=document.createElement('summary');container.className='result-submission-details';container.open=true;heading.textContent='本次提交 · 基本信息';container.append(heading,list);$('ojResults').append(container);
  }
  function verdict(submission){
    if(!submission?.verdict)return;
    if(globalThis.OpenJudgeExecutionView?.renderOfficial)return globalThis.OpenJudgeExecutionView.renderOfficial($('ojResults'),submission);
    const v=submission.verdict,labels={AC:['答案正确','pass'],WA:['答案错误','fail'],CE:['编译错误','warn'],TLE:['时间超限','fail'],MLE:['内存超限','fail'],RE:['运行错误','fail'],OLE:['输出超限','fail'],PE:['格式错误','warn'],pending:['正在评测','warn'],unknown:['状态未确认','warn']};
    const [label,tone]=labels[v.status]||[v.text||'其他状态','warn'],box=document.createElement('div'),badge=document.createElement('strong'),text=document.createElement('div'),heading=document.createElement('b'),description=document.createElement('p');
    box.className='oj-verdict '+tone;box.setAttribute('role','status');badge.className='oj-verdict-code';badge.textContent=labels[v.status]?v.status==='pending'?'评测中':v.status==='unknown'?'待确认':({"AC":"Accepted","WA":"Wrong Answer","CE":"Compile Error","TLE":"Time Out","MLE":"Memory Limit Exceeded","RE":"Runtime Error","OLE":"Output Limit Exceeded","PE":"Presentation Error"})[v.status]:'其他';heading.textContent=label;description.textContent=v.text||'';text.append(heading,description);box.append(badge,text);$('ojResults').append(box);
  }
  function sample(value){
    if(!value?.result)return;const r=value.result,hash=value.codeHash||r.codeHash;$('samplePanel').hidden=false;$('sampleState').textContent=(r.testKind==='custom'&&r.status==='passed'?'自定义测试输出一致':sampleLabels[r.status]||r.status)+(hash?' · 源码 '+hash.slice(0,8):'')+' · '+(r.testKind==='custom'?'自定义测试':'题目样例')+'；本机通过不代表网站 AC。';
    $('sampleState').className=r.status==='passed'?'execution-pass':['whitespace','executed'].includes(r.status)?'execution-warn':'execution-fail';$('sampleResults').classList.remove('result-phase-busy');$('sampleResults').setAttribute('aria-busy','false');$('sampleResults').replaceChildren();
    globalThis.OpenJudgeExecutionView.render($('sampleResults'),r);
  }
  if($('runSample'))$('runSample').onclick=()=>{$('runSample').disabled=true;$('samplePanel').hidden=false;$('sampleState').textContent='正在保存本次代码并编译，随后运行题目样例…';$('sampleResults').classList.add('result-phase-busy');$('sampleResults').setAttribute('aria-busy','true');send('run_sample');};
  $('submitOJ').onclick=()=>{
    if(busy)return;busy=true;$('submitOJ').disabled=true;pinStatus();
    if(!prepared){$('ojState').textContent='正在读取本题官方提交表单与 C++ 编译器选项…';globalThis.OpenJudgeExecutionView?.renderPhase?.($('ojResults'),'prepare');send('oj_prepare');}
    else{$('ojState').textContent='正在保存本次完整代码并提交；此操作只发送一次…';globalThis.OpenJudgeExecutionView?.renderPhase?.($('ojResults'),'sending');refreshes=0;clearTimeout(timer);jobId=null;refreshAction=null;$('refreshOJ').disabled=true;submitAction=send('oj_submit',{language:$('ojLanguage').value});}
  };
  const refresh=()=>{if(!jobId)return;$('refreshOJ').disabled=true;$('ojResults').classList.add('result-refreshing');$('ojResults').setAttribute('aria-busy','true');refreshAction=send('oj_refresh',{id:jobId});};$('refreshOJ').onclick=refresh;
  port.onMessage.addListener(value=>{
    if(value.type==='sample_result'){sample(value);if($('runSample'))$('runSample').disabled=false;return;}
    if(value.type==='oj_prepared'){
      $('ojLanguage').replaceChildren();for(const item of value.languages.filter(o=>/c\+\+|g\+\+/i.test(o.label))){const option=document.createElement('option');option.value=item.value;option.textContent=item.label;option.selected=item.selected;$('ojLanguage').append(option);}
      prepared=true;busy=false;$('submitOJ').disabled=false;$('submitOJ').textContent='确认提交到 OJ';$('ojLanguageRow').hidden=false;$('ojState').textContent='提交表单已就绪，代码尚未发送。请选择编译器，再点“确认提交到 OJ”。';globalThis.OpenJudgeExecutionView?.renderPhase?.($('ojResults'),'ready');return;
    }
    if(value.type==='oj_result'){
      if(value.requestType==='oj_submit'&&value.actionId!==submitAction||value.requestType==='oj_refresh'&&value.id!==jobId)return;
      busy=false;jobId=value.id;$('submitOJ').disabled=false;$('refreshOJ').disabled=false;$('ojPanel').hidden=false;const s=value.submission;
      $('ojState').textContent=value.error|| (s?'提交 '+s.submissionId+'：'+s.verdict.status+' · '+s.verdict.text+(value.codeHash?' · 源码 '+value.codeHash.slice(0,8):''):value.message||'已提交，正在读取评测。');
      $('ojResults').classList.remove('result-refreshing');$('ojResults').setAttribute('aria-busy','false');$('ojResults').replaceChildren();if(s)verdict(s);else globalThis.OpenJudgeExecutionView?.renderPhase?.($('ojResults'),value.error?'uncertain':'pending');
      if(s?.runtime?.error){if(globalThis.OpenJudgeExecutionView?.diagnostic)globalThis.OpenJudgeExecutionView.diagnostic($('ojResults'),'网站编译信息',s.runtime.error,true);else block($('ojResults'),'网站编译信息',s.runtime.error);}
      submissionDetails(s);
      if(value.submitPageClosed){const note=document.createElement('p');note.className='result-note';note.textContent='已确认本次 AC，对应提交页面已关闭。';$('ojResults').append(note);}
      else if(value.closeReason==='source_changed'||value.closeReason==='newer_submission'){const note=document.createElement('p');note.className='result-note warn';note.textContent='提交页已有新的代码或提交，已保留该页。';$('ojResults').append(note);}
      if(value.receipt?.solutionUrl){try{const url=new URL(value.receipt.solutionUrl);if(['http:','https:'].includes(url.protocol)&&['bailian.openjudge.cn','noi.openjudge.cn'].includes(url.hostname)){const a=document.createElement('a');a.href=url.href;a.className='result-detail-link';a.textContent='查看这次提交详情 ↗';$('ojResults').append(a);}}catch{}}
      clearTimeout(timer);if(!value.autoRefreshManaged){if(!value.error&&s&&['pending','unknown'].includes(s.verdict.status)&&++refreshes<30)timer=setTimeout(refresh,2000);
      else if(!value.error&&!s&&value.receipt?.solutionUrl&&++refreshes<30)timer=setTimeout(refresh,2000);}
      return;
    }
    if(value.type==='error'&&['run_sample','sample_history','oj_prepare','oj_submit','oj_refresh'].includes(value.requestType)){
      if(value.requestType==='oj_refresh'&&value.actionId!==refreshAction||value.requestType==='oj_submit'&&value.actionId!==submitAction)return;
      busy=false;$('submitOJ').disabled=false;if($('runSample'))$('runSample').disabled=false;$('refreshOJ').disabled=!jobId;
      $('ojResults').classList.remove('result-refreshing');$('ojResults').setAttribute('aria-busy','false');if($('sampleResults')){$('sampleResults').classList.remove('result-phase-busy');$('sampleResults').setAttribute('aria-busy','false');}
      if(['oj_prepare','oj_submit'].includes(value.requestType))globalThis.OpenJudgeExecutionView?.renderPhase?.($('ojResults'),'uncertain');
      $(value.requestType.startsWith('oj_')?'ojState':'sampleState').textContent=value.error;
    }
  });
  if($('runSample')&&!document.body.hasAttribute('data-session'))send('sample_history');
})();
