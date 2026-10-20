(()=>{
  const $=id=>document.getElementById(id),port=chrome.runtime.connect();
  let prepared=false,submitJobId,submitTimer,submitRefreshes=0,submitBusy=false;
  let testJobId,testTimer,testRefreshes=0,testBusy=false,inputInitialized=false;
  const send=(type,extra={})=>port.postMessage({type,...extra,actionId:crypto.randomUUID(),requestedAt:new Date().toISOString()});
  function block(parent,label,text){
    const box=document.createElement('div'),h=document.createElement('h4'),pre=document.createElement('pre'),code=document.createElement('code');
    box.className='execution-block';h.textContent=label;code.textContent=String(text||'（空）');pre.append(code);box.append(h,pre);parent.append(box);
  }
  $('webTestInput').addEventListener('input',()=>{inputInitialized=true;});
  $('gridTest').onclick=()=>{
    if(testBusy)return;
    testBusy=true;$('gridTest').disabled=true;$('webTestPanel').hidden=false;$('refreshGridTest').disabled=true;
    $('webTestState').textContent='正在保存当前 VS Code 代码并请求编程网格网站测试执行…';
    $('webTestResults').replaceChildren();testJobId=null;testRefreshes=0;clearTimeout(testTimer);
    send('grid_test',{input:$('webTestInput').value});
  };
  const refreshTest=()=>{if(!testJobId)return;$('refreshGridTest').disabled=true;send('grid_test_refresh',{id:testJobId});};
  $('refreshGridTest').onclick=refreshTest;
  const sendSubmission=()=>{$('ojState').textContent='正在保存本次完整代码并正式提交；此操作只发送一次…';submitRefreshes=0;clearTimeout(submitTimer);send('oj_submit',{language:$('ojLanguage').value});};
  $('submitOJ').onclick=()=>{
    if(submitBusy)return;submitBusy=true;$('submitOJ').disabled=true;$('ojPanel').hidden=false;
    if(!prepared){$('ojState').textContent='正在读取本题提交入口与 C++ 编译器选项…';send('oj_prepare');}
    else sendSubmission();
  };
  const refreshSubmit=()=>{if(!submitJobId)return;$('refreshOJ').disabled=true;send('oj_refresh',{id:submitJobId});};
  $('refreshOJ').onclick=refreshSubmit;
  port.onMessage.addListener(value=>{
    if((value.type==='assist_context'||value.type==='action_preview')&&!inputInitialized){
      const sample=value.capture?.problem?.sampleInput;
      if(typeof sample==='string'){$('webTestInput').value=sample.slice(0,20000);inputInitialized=true;}
      return;
    }
    if(value.type==='grid_test_result'){
      testJobId=value.id;const s=value.submission,pending=value.status==='pending';
      testBusy=Boolean(pending);$('gridTest').disabled=testBusy;$('webTestPanel').hidden=false;$('refreshGridTest').disabled=!testJobId||!value.receipt?.solutionId;
      $('webTestState').textContent=value.message&&value.status==='uncertain'?value.message:s?`网站测试 ${s.submissionId}：${s.platformResult||s.verdict?.status||'处理中'} · 源码 ${(value.codeHash||'').slice(0,8)}；这不是正式提交。`:value.error||value.message||'网站测试请求已送出，等待返回。';
      $('webTestResults').replaceChildren();
      if(value.input!==undefined)block($('webTestResults'),'本次测试输入',value.input);
      if(s?.runtime?.text)block($('webTestResults'),'编程网格输出与提示（完整原文）',s.runtime.text);
      if(s?.runtime?.error&&s.runtime.error!==s.runtime.text)block($('webTestResults'),'网站编译信息',s.runtime.error);
      const testReply=s?.websiteReplyRaw||value.websiteReplyRaw;
      if(testReply)block($('webTestResults'),'编程网格接口完整回复（原始 JSON）',testReply);
      else if(s&&!s.runtime?.text)block($('webTestResults'),'网站返回状态',s.platformResult||s.verdict?.status);
      if(value.workerError)block($('webTestResults'),'本机保存提示',value.workerError);
      if(value.receipt?.solutionUrl){const a=document.createElement('a');a.href=value.receipt.solutionUrl;a.textContent='查看网站这次测试记录';$('webTestResults').append(a);}
      clearTimeout(testTimer);
      if(pending&&testJobId){
        if(++testRefreshes<30)testTimer=setTimeout(refreshTest,2000);
        else{testBusy=false;$('gridTest').disabled=false;$('webTestState').textContent+=' 自动查询已暂停；仍可点“刷新这次测试结果”。';}
      }
      return;
    }
    if(value.type==='oj_prepared'){
      $('ojLanguage').replaceChildren();for(const item of value.languages.filter(o=>/c\+\+|g\+\+/i.test(o.label))){const option=document.createElement('option');option.value=item.value;option.textContent=item.label;option.selected=item.selected;$('ojLanguage').append(option);}
      if(!$('ojLanguage').value){submitBusy=false;$('submitOJ').disabled=false;$('ojState').textContent='网站没有可用的 C++ 编译器，本次未提交。';return;}
      prepared=true;$('ojLanguageRow').hidden=false;sendSubmission();return;
    }
    if(value.type==='oj_result'){
      submitBusy=false;submitJobId=value.id;$('submitOJ').disabled=false;$('refreshOJ').disabled=!submitJobId||!value.receipt?.solutionId;$('ojPanel').hidden=false;const s=value.submission;
      $('ojState').textContent=value.error|| (s?'正式提交 '+s.submissionId+'：'+(s.platformResult||s.verdict.text)+' · 源码 '+(value.codeHash||'').slice(0,8):value.message||'已提交，正在读取评测。');
      $('ojResults').replaceChildren();if(s?.runtime?.text)block($('ojResults'),'编程网格提交反馈（完整原文）',s.runtime.text);
      if(s?.runtime?.error&&s.runtime.error!==s.runtime.text)block($('ojResults'),'网站编译信息',s.runtime.error);
      const submitReply=s?.websiteReplyRaw||value.websiteReplyRaw;
      if(submitReply)block($('ojResults'),'编程网格接口完整回复（原始 JSON）',submitReply);
      else if(s&&!s.runtime?.text)block($('ojResults'),'网站返回状态',s.platformResult||s.verdict?.status);
      if(value.receipt?.solutionUrl){const a=document.createElement('a');a.href=value.receipt.solutionUrl;a.textContent='查看这次提交详情';$('ojResults').append(a);}
      clearTimeout(submitTimer);if(!value.error&&s&&['pending','unknown'].includes(s.verdict.status)&&++submitRefreshes<30)submitTimer=setTimeout(refreshSubmit,2000);
      else if(!value.error&&!s&&value.receipt?.solutionUrl&&++submitRefreshes<30)submitTimer=setTimeout(refreshSubmit,2000);
      return;
    }
    if(value.type==='error'&&['grid_test','grid_test_refresh','oj_prepare','oj_submit','oj_refresh'].includes(value.requestType)){
      if(value.requestType.startsWith('grid_test')){testBusy=false;$('gridTest').disabled=false;$('refreshGridTest').disabled=!testJobId;$('webTestState').textContent=value.error;}
      else{submitBusy=false;$('submitOJ').disabled=false;$('refreshOJ').disabled=!submitJobId;$('ojState').textContent=value.error;}
    }
  });
})();
