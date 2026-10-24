(()=>{
  const $=id=>document.getElementById(id),port=chrome.runtime.connect();
  let submitJobId,submitTimer,submitRefreshes=0,submitBusy=false;
  let testJobId,testTimer,testRefreshes=0,testBusy=false,inputInitialized=false,activeKind='',lastTest,lastSubmission,testInputMode='platform';
  const send=(type,extra={})=>port.postMessage({type,...extra,actionId:crypto.randomUUID(),requestedAt:new Date().toISOString()});
  const verdictName={AC:'Accepted',WA:'Wrong Answer',CE:'Compile Error',TLE:'Time Limit Exceeded',RE:'Runtime Error',MLE:'Memory Limit Exceeded',PE:'Presentation Error',OLE:'Output Limit Exceeded'};
  const platformName={Passed:'Accepted',Accepted:'Accepted',WrongAnswer:'Wrong Answer',CompileError:'Compile Error',RuntimeError:'Runtime Error',TimeOut:'Time Out',OutOfMemory:'Out Of Memory',OutputExceeded:'Output Limit Exceeded',EmptyOutput:'Empty Output'};
  function block(parent,label,text){
    const box=document.createElement('div'),h=document.createElement('h4'),pre=document.createElement('pre'),code=document.createElement('code');
    box.className='execution-block';h.textContent=label;GridOutputFeedback.renderOriginal(code,String(text||'（空）'));pre.append(code);box.append(h,pre);parent.append(box);
  }
  let appearance={},lastPriority,feedbackPreferences={visibleWhitespace:true,showComparison:true};
  function feedback(raw){GridOutputFeedback.render($('priorityFeedback'),raw,feedbackPreferences);}
  $('feedbackShowComparison').onchange=()=>{feedbackPreferences.showComparison=$('feedbackShowComparison').checked;if(lastPriority)feedback(lastPriority.value.submission?.runtime?.text||'');};
  $('feedbackWhitespace').onchange=()=>{feedbackPreferences.visibleWhitespace=$('feedbackWhitespace').checked;if(lastPriority)feedback(lastPriority.value.submission?.runtime?.text||'');};
  $('copyGridRaw').onclick=async()=>{try{await navigator.clipboard.writeText(GridOutputFeedback.plainText(lastPriority?.value.submission?.runtime?.text||''));$('copyRawState').textContent='已复制原文';}catch{$('copyRawState').textContent='复制失败，请选择原文复制';}};
  function priority(kind,value){
    if(activeKind!==kind)return;
    lastPriority={kind,value};
    const submission=value.submission;
    const raw=submission?.runtime?.text||value.error||value.message||(value.browserStage?value.browserStage+'，等待编程网格返回原文…':'等待编程网格返回判题原文…');
    const verdictCode=submission?.verdict?.status,original=platformName[submission?.platformResult]||verdictName[verdictCode]||'',custom=appearance[verdictCode]||{},verdict=original&&(typeof custom.text==='string'&&custom.text.trim()?custom.text.slice(0,120):original);
    $('priorityPanel').hidden=false;$('priorityVerdict').hidden=!verdict;$('priorityVerdict').textContent=verdict;
    $('priorityVerdict').className='priority-verdict'+(verdictName[verdictCode]?' verdict-'+verdictCode.toLowerCase():'');
    const badge=$('priorityVerdict');
    badge.style.fontSize=Number.isFinite(custom.fontSize)&&custom.fontSize>0&&custom.fontSize<=200?custom.fontSize+'px':'';
    badge.style.color=typeof custom.color==='string'&&/^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(custom.color)?custom.color:'';
    const label=(value.restored?'上次记录 · ':'')+(kind==='test'?(testInputMode==='manual'?'手工输入测试 · ':'测试代码 · '):'正式提交 · ')+(submission?.runtime?.text?'输出与提示原文':value.error||value.status==='uncertain'?'连接提示':value.message&&value.status==='rejected'?'网站未接受请求':'等待网站原文');
    $('priorityLabel').textContent=label+(Number.isFinite(value.responseMs)?` · 首次回复 ${value.responseMs} ms`:'');
    const changed=$('priorityRaw').textContent!==GridOutputFeedback.plainText(raw);GridOutputFeedback.renderOriginal($('priorityRaw'),raw);
    $('copyGridRaw').disabled=!submission?.runtime?.text;if(changed)$('copyRawState').textContent='';
    feedback(submission?.runtime?.text||'');
  }
  $('webTestInput').addEventListener('input',()=>{inputInitialized=true;});
  $('useManualInput').onchange=()=>{
    $('webTestInput').disabled=!$('useManualInput').checked;
    $('gridTest').textContent=$('useManualInput').checked?'手工输入测试':'测试代码 · 网格判题';
    $('testModeSummary').textContent=$('useManualInput').checked?'测试方式：手工输入（自行核对输出）':'测试方式：网格判题（默认）｜手工输入';
  };
  $('gridTest').onclick=()=>{
    if(testBusy)return;
    activeKind='test';
    const input=$('useManualInput').checked?$('webTestInput').value:'';
    testInputMode=input.length?'manual':'platform';
    testBusy=true;$('gridTest').disabled=true;$('webTestPanel').hidden=false;$('refreshGridTest').disabled=true;
    $('webTestState').textContent='正在保存当前 VS Code 代码并请求编程网格网站测试执行…';
    $('webTestResults').replaceChildren();testJobId=null;testRefreshes=0;clearTimeout(testTimer);
    priority('test',{message:'请求已发出，等待编程网格返回原文…'});
    send('grid_test',{input});
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
    if(value.type==='judge_action'){if(value.action==='test'){if(testBusy)return;$('useManualInput').checked=false;$('useManualInput').onchange();$('gridTest').click();}else if(value.action==='submit')$('submitOJ').click();return;}
    if(value.type==='judge_settings'){appearance=value.settings||{};if(value.feedback){feedbackPreferences={...feedbackPreferences,...value.feedback};$('feedbackShowComparison').checked=feedbackPreferences.showComparison;$('feedbackWhitespace').checked=feedbackPreferences.visibleWhitespace;}if(lastPriority)priority(lastPriority.kind,lastPriority.value);return;}
    if(value.type==='judge_history'){
      if(activeKind)return;
      const latest=value.test&&value.submission?String(value.test.createdAt)>String(value.submission.createdAt)?'test':'submit':value.test?'test':value.submission?'submit':'';
      activeKind=latest;
      if(value.test)handleMessage({type:'grid_test_result',...value.test,restored:true});
      if(value.submission)handleMessage({type:'oj_result',...value.submission,restored:true});
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
      if(typeof value.input==='string')testInputMode=value.input.length?'manual':'platform';
      $('testPanelTitle').textContent=testInputMode==='manual'?'手工输入测试':'测试代码 · 网格判题';
      testJobId=value.id;const s=value.submission,sending=['prepared','sending'].includes(value.status),terminal=s&&(!['pending','unknown'].includes(s.verdict?.status||'unknown')||s.platformResult==='Testing'&&s.runtime?.text),pending=sending||value.status==='pending'&&!terminal;
      testBusy=pending;$('gridTest').disabled=testBusy;$('webTestPanel').hidden=false;$('refreshGridTest').disabled=!value.receipt?.solutionId;
      $('webTestState').textContent=value.status==='uncertain'?value.message:s?`网站测试 ${s.submissionId}：${s.platformResult||s.verdict?.status||'处理中'} · 源码 ${(value.codeHash||'').slice(0,8)}；非正式提交。`:value.error||value.message||'网站测试已发出，等待首次回复。';
      priority('test',value);
      $('webTestResults').replaceChildren();
      if(s?.runtime?.text)block($('webTestResults'),'编程网格输出与提示（完整原文）',s.runtime.text);
      if(s?.runtime?.error&&s.runtime.error!==s.runtime.text)block($('webTestResults'),'网站编译信息',s.runtime.error);
      if(s&&!s.runtime?.text)block($('webTestResults'),'网站判定',platformName[s.platformResult]||verdictName[s.verdict?.status]||'等待判题原文');
      if(value.input)block($('webTestResults'),'本次手工输入',value.input);
      if(value.workerError)block($('webTestResults'),'本机保存提示',value.workerError);
      if(value.receipt?.solutionUrl){const a=document.createElement('a');a.href=value.receipt.solutionUrl;a.textContent='查看网站这次测试记录';$('webTestResults').append(a);}
      clearTimeout(testTimer);
      if(value.restored){testBusy=false;$('gridTest').disabled=false;$('webTestState').textContent+=' 上次记录；未自动查询。';}
      else if(sending)testTimer=setTimeout(()=>send('grid_test_status',{id:testJobId}),180);
      else if(value.receipt?.solutionId&&(!terminal||!s?.runtime?.text&&!s?.detailLoaded)&&++testRefreshes<30)testTimer=setTimeout(refreshTest,terminal?350:700);
      else if(value.receipt?.solutionId&&testRefreshes>=30){testBusy=false;$('gridTest').disabled=false;$('webTestState').textContent+=' 自动查询已暂停，可手动刷新。';}
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
      if(s&&!s.runtime?.text)block($('ojResults'),'网站判定',platformName[s.platformResult]||verdictName[s.verdict?.status]||'等待判题原文');
      if(value.receipt?.solutionUrl){const a=document.createElement('a');a.href=value.receipt.solutionUrl;a.textContent='查看这次提交详情';$('ojResults').append(a);}
      clearTimeout(submitTimer);
      if(value.restored){submitBusy=false;$('submitOJ').disabled=false;$('ojState').textContent+=' 上次记录；未自动查询。';}
      else if(sending)submitTimer=setTimeout(()=>send('oj_status',{id:submitJobId}),180);
      else if(value.receipt?.solutionId&&(s?.verdict?.status==='pending'||!s?.runtime?.text&&!s?.detailLoaded)&&++submitRefreshes<30)submitTimer=setTimeout(refreshSubmit,s?.verdict?.status==='pending'?700:350);
      else if(value.receipt?.solutionId&&submitRefreshes>=30)$('ojState').textContent+=' 自动查询已暂停，可手动刷新。';
      return;
    }
    if(value.type==='error'&&['grid_test','grid_test_status','grid_test_refresh','oj_submit','oj_status','oj_refresh'].includes(value.requestType)){
      if(value.requestType.startsWith('grid_test')){testBusy=false;$('gridTest').disabled=false;$('refreshGridTest').disabled=!testJobId;$('webTestState').textContent=value.error;if(activeKind==='test'&&!(value.requestType==='grid_test_refresh'&&lastTest?.submission))priority('test',{error:value.error});}
      else{submitBusy=false;$('submitOJ').disabled=false;$('refreshOJ').disabled=!submitJobId;$('ojState').textContent=value.error;if(activeKind==='submit'&&!(value.requestType==='oj_refresh'&&lastSubmission?.submission))priority('submit',{error:value.error});}
    }
  }
  $('judgeKeybindings').onclick=()=>send('open_keybindings');
  $('judgeTemplate').onclick=()=>send('edit_source_template');
  $('judgeSettings').onclick=()=>send('open_settings');
  port.onMessage.addListener(handleMessage);
  send('judge_ready');
})();
