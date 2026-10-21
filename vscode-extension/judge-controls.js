(()=>{
  const $=id=>document.getElementById(id),port=chrome.runtime.connect();
  let submitJobId,submitTimer,submitRefreshes=0,submitBusy=false;
  let testJobId,testTimer,testRefreshes=0,testBusy=false,inputInitialized=false,activeKind='',lastTest,lastSubmission;
  const send=(type,extra={})=>port.postMessage({type,...extra,actionId:crypto.randomUUID(),requestedAt:new Date().toISOString()});
  const verdictName={AC:'AC',WA:'WA',CE:'CE',TLE:'TLE',RE:'RE',MLE:'MLE',PE:'PE',OLE:'OLE'};
  function block(parent,label,text){
    const box=document.createElement('div'),h=document.createElement('h4'),pre=document.createElement('pre'),code=document.createElement('code');
    box.className='execution-block';h.textContent=label;code.textContent=String(text||'（空）');pre.append(code);box.append(h,pre);parent.append(box);
  }
  function priority(kind,value){
    if(activeKind!==kind)return;
    const submission=value.submission,reply=submission?.websiteReplyRaw||value.websiteReplyRaw;
    const raw=submission?.runtime?.text||reply||value.error||value.message||(value.browserStage?value.browserStage+'，等待编程网格返回原文…':'请求已发出，等待编程网格返回原文…');
    const verdict=verdictName[submission?.verdict?.status]||'';
    $('priorityPanel').hidden=false;$('priorityVerdict').hidden=!verdict;$('priorityVerdict').textContent=verdict;
    $('priorityVerdict').className='priority-verdict'+(verdict?' verdict-'+verdict.toLowerCase():'');
    const label=(kind==='test'?'网站测试 · ':'正式提交 · ')+(submission?.runtime?.text?'输出与提示原文':reply?'接口原文':value.error||value.status==='uncertain'?'连接未确认':value.message&&value.status==='rejected'?'网站未接受请求':'等待网站回复');
    $('priorityLabel').textContent=label+(Number.isFinite(value.responseMs)?` · 首次回复 ${value.responseMs} ms`:'');
    $('priorityRaw').textContent=raw;
  }
  $('webTestInput').addEventListener('input',()=>{inputInitialized=true;});
  $('gridTest').onclick=()=>{
    if(testBusy)return;
    activeKind='test';
    testBusy=true;$('gridTest').disabled=true;$('webTestPanel').hidden=false;$('refreshGridTest').disabled=true;
    $('webTestState').textContent='正在保存当前 VS Code 代码并请求编程网格网站测试执行…';
    $('webTestResults').replaceChildren();testJobId=null;testRefreshes=0;clearTimeout(testTimer);
    priority('test',{message:'请求已发出，等待编程网格返回原文…'});
    send('grid_test',{input:$('webTestInput').value});
  };
  const refreshTest=()=>{if(!testJobId)return;$('refreshGridTest').disabled=true;send('grid_test_refresh',{id:testJobId});};
  $('refreshGridTest').onclick=refreshTest;
  $('submitOJ').onclick=()=>{
    if(submitBusy)return;activeKind='submit';submitBusy=true;submitJobId=null;submitRefreshes=0;clearTimeout(submitTimer);
    $('submitOJ').disabled=true;$('ojPanel').hidden=false;$('refreshOJ').disabled=true;
    $('ojState').textContent='正在发送正式提交…';$('ojResults').replaceChildren();
    priority('submit',{message:'请求已发出，等待编程网格返回原文…'});
    send('oj_submit',{language:'C++'});
  };
  const refreshSubmit=()=>{if(!submitJobId)return;$('refreshOJ').disabled=true;send('oj_refresh',{id:submitJobId});};
  $('refreshOJ').onclick=refreshSubmit;
  function handleMessage(value){
    if(value.type==='judge_history'){
      if(activeKind)return;
      const latest=value.test&&value.submission?String(value.test.createdAt)>String(value.submission.createdAt)?'test':'submit':value.test?'test':value.submission?'submit':'';
      activeKind=latest;
      if(value.test)handleMessage({type:'grid_test_result',...value.test});
      if(value.submission)handleMessage({type:'oj_result',...value.submission});
      return;
    }
    if((value.type==='assist_context'||value.type==='action_preview')&&!inputInitialized){
      const sample=value.capture?.problem?.sampleInput;
      if(typeof sample==='string'){$('webTestInput').value=sample.slice(0,20000);inputInitialized=true;}
      return;
    }
    if(value.type==='grid_test_result'){
      if(testJobId&&value.id!==testJobId)return;
      lastTest=value;
      testJobId=value.id;const s=value.submission,sending=['prepared','sending'].includes(value.status),pending=sending||value.status==='pending';
      testBusy=pending;$('gridTest').disabled=testBusy;$('webTestPanel').hidden=false;$('refreshGridTest').disabled=!value.receipt?.solutionId;
      $('webTestState').textContent=value.status==='uncertain'?value.message:s?`网站测试 ${s.submissionId}：${s.platformResult||s.verdict?.status||'处理中'} · 源码 ${(value.codeHash||'').slice(0,8)}；非正式提交。`:value.error||value.message||'网站测试已发出，等待首次回复。';
      priority('test',value);
      $('webTestResults').replaceChildren();
      if(s?.runtime?.text)block($('webTestResults'),'编程网格输出与提示（完整原文）',s.runtime.text);
      if(s?.runtime?.error&&s.runtime.error!==s.runtime.text)block($('webTestResults'),'网站编译信息',s.runtime.error);
      const testReply=s?.websiteReplyRaw||value.websiteReplyRaw;
      if(testReply)block($('webTestResults'),'编程网格接口完整回复（原始 JSON）',testReply);
      else if(s&&!s.runtime?.text)block($('webTestResults'),'网站返回状态',s.platformResult||s.verdict?.status);
      if(value.input!==undefined)block($('webTestResults'),'本次测试输入',value.input);
      if(value.workerError)block($('webTestResults'),'本机保存提示',value.workerError);
      if(value.receipt?.solutionUrl){const a=document.createElement('a');a.href=value.receipt.solutionUrl;a.textContent='查看网站这次测试记录';$('webTestResults').append(a);}
      clearTimeout(testTimer);
      if(sending)testTimer=setTimeout(()=>send('grid_test_status',{id:testJobId}),180);
      else if(value.receipt?.solutionId&&(s?.verdict?.status==='pending'||!s?.detailLoaded)&&++testRefreshes<30)testTimer=setTimeout(refreshTest,s?.verdict?.status==='pending'?700:350);
      else if(value.receipt?.solutionId&&!s?.detailLoaded&&testRefreshes>=30)$('webTestState').textContent+=' 详情页暂未读到，可手动刷新。';
      return;
    }
    if(value.type==='oj_result'){
      if(submitJobId&&value.id!==submitJobId)return;
      lastSubmission=value;
      submitJobId=value.id;const s=value.submission,sending=['prepared','sending'].includes(value.status);
      submitBusy=sending;$('submitOJ').disabled=sending;$('refreshOJ').disabled=!value.receipt?.solutionId;$('ojPanel').hidden=false;
      $('ojState').textContent=value.status==='uncertain'?value.message:value.error|| (s?'正式提交 '+s.submissionId+'：'+(s.platformResult||s.verdict.text)+' · 源码 '+(value.codeHash||'').slice(0,8):value.message||'已发送，等待网站回复。');
      priority('submit',value);
      $('ojResults').replaceChildren();if(s?.runtime?.text)block($('ojResults'),'编程网格提交反馈（完整原文）',s.runtime.text);
      if(s?.runtime?.error&&s.runtime.error!==s.runtime.text)block($('ojResults'),'网站编译信息',s.runtime.error);
      const submitReply=s?.websiteReplyRaw||value.websiteReplyRaw;
      if(submitReply)block($('ojResults'),'编程网格接口完整回复（原始 JSON）',submitReply);
      else if(s&&!s.runtime?.text)block($('ojResults'),'网站返回状态',s.platformResult||s.verdict?.status);
      if(value.receipt?.solutionUrl){const a=document.createElement('a');a.href=value.receipt.solutionUrl;a.textContent='查看这次提交详情';$('ojResults').append(a);}
      clearTimeout(submitTimer);
      if(sending)submitTimer=setTimeout(()=>send('oj_status',{id:submitJobId}),180);
      else if(value.receipt?.solutionId&&(s?.verdict?.status==='pending'||!s?.detailLoaded)&&++submitRefreshes<30)submitTimer=setTimeout(refreshSubmit,s?.verdict?.status==='pending'?700:350);
      else if(value.receipt?.solutionId&&!s?.detailLoaded&&submitRefreshes>=30)$('ojState').textContent+=' 详情页暂未读到，可手动刷新。';
      return;
    }
    if(value.type==='error'&&['grid_test','grid_test_status','grid_test_refresh','oj_submit','oj_status','oj_refresh'].includes(value.requestType)){
      if(value.requestType.startsWith('grid_test')){testBusy=false;$('gridTest').disabled=false;$('refreshGridTest').disabled=!testJobId;$('webTestState').textContent=value.error;if(activeKind==='test'&&!(value.requestType==='grid_test_refresh'&&lastTest?.submission))priority('test',{error:value.error});}
      else{submitBusy=false;$('submitOJ').disabled=false;$('refreshOJ').disabled=!submitJobId;$('ojState').textContent=value.error;if(activeKind==='submit'&&!(value.requestType==='oj_refresh'&&lastSubmission?.submission))priority('submit',{error:value.error});}
    }
  }
  port.onMessage.addListener(handleMessage);
  send('judge_ready');
})();
