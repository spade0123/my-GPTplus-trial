const $=id=>document.getElementById(id);
const chats=new Map(),jobs=new Map(),actions=new Map(),polling=new Set();
let port,currentHint,currentSolution,solutionAction,hintCapture,hintJudgment,activeUrl='',sequence=0,contextSequence=0,historyAction,hintOpened=false,chatWasOpen=false,hintRequestSequence=0,solutionRequestSequence=0;
const solutionQuestion='请先给出本题完整、无注释的 C++ 参考程序，使用 cnt+1 这种符号旁不加多余空格的写法，保留 using namespace std;。结合本次源码、刚读取的运行信息和上次解答修正问题，程序后再给讲解、复杂度与验证，原题和样例放最后。';
function resetSolution(){currentSolution=null;solutionAction=null;$('solutionPanel').hidden=true;$('solutionPanel').open=false;$('solutionAnswer').replaceChildren();$('giveSolution').disabled=false;$('giveSolution').textContent='给出解答';}
// The worker binds this own frame to the exact source tab/window. No page
// capture, website storage or source changes occur merely by showing the frame.
const rendered=new WeakMap();
function render(element,markdown){
  if(rendered.get(element)===markdown&&element.childNodes.length)return;
  globalThis.PkuReportRenderer.render(element,markdown);rendered.set(element,markdown);
}
function status(id,text,error=false){$(id).textContent=text;$(id).classList.toggle('error',error);}
function showCapture(capture,missing=[]){
  if(activeUrl&&activeUrl!==capture.url){resetSolution();currentHint=null;hintCapture=null;$('hintAnswer').replaceChildren();$('hintLocalAnswer').replaceChildren();}
  const runtime=capture.runtime||{},count=['input','output','hints','error','status','text'].reduce((n,key)=>n+String(runtime[key]||'').length,0);activeUrl=capture.url;$('context').textContent=`当前读取：${capture.title} · ${capture.code.length} 字符代码 · 运行区${count?'已读取 '+count+' 字符':'当前为空'}${missing.length?' · 部分题面缺失，建议核对':''}`;
}
function openHistory(mode){
  const hint=mode==='hint';$('hintPanel').hidden=false;
  if(!hint){
    $('chatPanel').open=true;chatWasOpen=true;
    (document.scrollingElement||document.documentElement).scrollTop=Math.max(0,$('chatPanel').offsetTop-12);
    $('question').focus({preventScroll:true});
  }
  status(hint?'hintState':'chatState',hint?'正在读取本题上次保存的提示与解答…':'正在读取本题已保存的交流记录…');
  historyAction={id:crypto.randomUUID(),sequence:++sequence,mode,autoStart:hint&&!hintOpened};
  if(hint)hintOpened=true;
  send({type:'assist_history',actionId:historyAction.id,source:$('source').value.trim()});
}
function connect(){
  if(port)return port;
  port=chrome.runtime.connect({name:'pku-coach-assist'});
  port.onMessage.addListener(receive);
  port.onDisconnect.addListener(()=>{
    const why=chrome.runtime.lastError?.message||'请点击工具栏图标重新打开';port=null;
    for(const item of actions.values())if(!item.saved){item.failed=true;}
    $('quickSave').disabled=false;$('quickSave').textContent='快捷保存';$('hint').disabled=false;$('refreshHint').disabled=false;$('giveSolution').disabled=false;$('send').disabled=false;
    status('saveStatus','连接已断开，未确认的请求不算保存成功：'+why,true);
  });return port;
}
function send(message){try{connect().postMessage(message);}catch(error){receive({type:'error',requestType:message.type,actionId:message.actionId,error:error.message});}}
function start(type,question){
  const actionId=crypto.randomUUID(),item={type,question,saved:false,sequence:++sequence};actions.set(actionId,item);
  if(type==='quick_save'){$('quickSave').disabled=true;$('quickSave').textContent='保存中…';}
  if(type==='hint'){hintOpened=true;hintRequestSequence=solutionRequestSequence=item.sequence;resetSolution();$('hint').disabled=true;$('refreshHint').disabled=true;$('hintPanel').hidden=false;currentHint=null;hintCapture=null;status('hintState','正在读取当前题目和完整代码…');$('hintAnswer').replaceChildren();$('hintLocalAnswer').replaceChildren();$('hintLocal').open=false;}
  if(type==='solution'){solutionRequestSequence=item.sequence;solutionAction=actionId;currentSolution=null;$('giveSolution').disabled=true;$('giveSolution').textContent='生成解答中…';$('solutionPanel').hidden=false;$('solutionPanel').open=true;$('solutionAnswer').replaceChildren();status('solutionState','正在读取并保存本次题目、完整代码与运行信息…');}
  if(type==='discuss'){$('send').disabled=true;status('chatState','正在保存本轮问题与当前代码…');chats.set(actionId,{actionId,question,url:activeUrl,createdAt:Date.now(),status:'正在读取并保存当前代码…'});renderChats();}
  status('saveStatus','正在读取并保存本次代码…');
  send({type:type==='solution'?'discuss':type,question,...(type==='solution'?{purpose:'solution'}:{}),actionId,requestedAt:new Date().toISOString(),source:$('source').value.trim()});
}
function renderChats(){
  $('chatMessages').replaceChildren();
  const time=item=>Date.parse(item.job?.createdAt)||item.createdAt||0;
  for(const item of [...chats.values()].sort((a,b)=>time(a)-time(b))){
    if(item.job&&(item.job.kind!=='discussion'||item.job.purpose==='solution'))continue;
    if(activeUrl&&item.url&&item.url!==activeUrl)continue;
    const card=document.createElement('div');card.className='chat';
    const question=document.createElement('p');question.className='question';question.textContent=item.question;
    const meta=document.createElement('p');meta.className='chatMeta';
    const job=item.job,labels={queued:'问题与代码已保存，等待后台回复',running:job?.partialAnalysis?'回复逐步生成中':'问题与代码已保存，模型处理中',complete:'回复已保存',failed:'问题已保存，回复生成失败',skipped:'当前版本已有 AC 证据'};
    meta.textContent=job?`${labels[job.status]||job.status} · 源码 ${job.codeHash?.slice(0,8)||''}`:item.status;
    const answer=document.createElement('article');answer.className='markdown';
    render(answer,job?.status==='complete'?job.analysis:job?.partialAnalysis||job?.error||'');
    card.append(question,meta,answer);$('chatMessages').append(card);
  }
}
function showHint(job){
  if(job.id!==currentHint?.id)return;
  const label={queued:'当前代码已保存；正在排队推导解题方向',running:job.partialAnalysis?'解题方向正在逐步生成，下方可先阅读':'当前代码已保存；正在推导解题方向',complete:'解题提示已生成并保存',failed:'当前代码已保存；解题提示未完成：'+(job.error||'请重新请求'),skipped:'这份代码已有匹配的 AC 证据，已保存，继续安排学习分析'};
  status('hintState',(job.title?job.title+' · ':'')+(label[job.status]||job.status)+(job.codeHash?' · 对应源码 '+job.codeHash.slice(0,8):''),job.status==='failed');
  const text=job.status==='complete'?job.analysis:job.status==='skipped'?job.message:job.partialAnalysis;
  render($('hintAnswer'),text||(job.status==='failed'?'解题方向未生成成功。点击下方“按当前代码重新提示”重试，本次源码已保留。':'正在根据完整题面和你的代码推导解题方向，生成后会在这里逐步显示。'));
  if(job.instantAnalysis)render($('hintLocalAnswer'),job.instantAnalysis);
  else if(hintCapture)render($('hintLocalAnswer'),globalThis.PkuInstantHints.generate(hintCapture,hintJudgment,job.compiler).markdown);
}
function showSolution(job){
  if(job.id!==currentSolution?.id)return;
  const busy=['queued','running'].includes(job.status),labels={queued:'本次代码已保存，完整参考解答排队中',running:job.partialAnalysis?'完整参考解答正在逐步生成':'正在结合题目与本次代码生成完整参考解答',complete:'完整参考解答已生成并保存；未据此认定平台 AC',failed:'解答未完成：'+(job.error||'可重新请求')};
  $('giveSolution').disabled=busy;$('giveSolution').textContent=busy?'生成解答中…':job.status==='failed'?'重新给出解答':'重新生成解答';
  status('solutionState',`${labels[job.status]||job.status}${job.codeHash?' · 对应源码 '+job.codeHash.slice(0,8):''}`,job.status==='failed');
  render($('solutionAnswer'),job.status==='complete'?job.analysis:job.partialAnalysis||(job.status==='failed'?'已保存本次代码。可点击“重新给出解答”重试。':'正在根据本次代码和运行信息生成完整参考程序，先显示程序，再补充讲解。'));
}
function updateJob(job,actionId){
  const old=jobs.get(job.id);jobs.set(job.id,{...job,actionId:actionId||old?.actionId});
  if(job.purpose==='solution'||actions.get(actionId||old?.actionId)?.type==='solution'){
    if(currentSolution?.id===job.id){currentSolution=job;showSolution(job);}return;
  }
  if(job.kind==='discussion'){
    const key=actionId||old?.actionId||job.eventId||job.id;
    const prior=chats.get(key)||{actionId:key,question:job.question,url:job.sourceUrl};
    chats.set(key,{...prior,job,url:job.sourceUrl||prior.url});renderChats();
  }else if(currentHint?.id===job.id){currentHint=job;showHint(job);}
}
function receive(msg){
  if(msg.type==='restore_ui'){
    if(typeof msg.ui?.question==='string')$('question').value=msg.ui.question.slice(0,2000);
    if(msg.ui?.chatOpen){$('chatPanel').open=true;chatWasOpen=true;}return;
  }
  if(msg.type==='refresh_discussion_context'){$('discussion').click();return;}
  if(msg.type==='resume_context'){
    openHistory(msg.mode);
    return;
  }
  if(msg.type==='action_preview'){
    const item=actions.get(msg.actionId);if(!item||item.failed)return;item.url=msg.capture.url;
    if(item.sequence>=contextSequence){contextSequence=item.sequence;showCapture(msg.capture,msg.missingSections);}
    if(msg.requestType==='hint'){
      hintCapture=msg.capture;hintJudgment=msg.judgment||{};
      const preview=globalThis.PkuInstantHints.generate(msg.capture,msg.judgment||{});
      render($('hintLocalAnswer'),preview.markdown);render($('hintAnswer'),'正在根据完整题面和你的代码推导解题方向，生成后会在这里逐步显示。');status('hintState','正在保存本次代码，并安排解题方向提示');
    }else if(item.type==='solution'){
      if(msg.actionId===solutionAction)status('solutionState',`已读取本次 ${msg.capture.code.length} 字符完整代码，正在保存并生成参考解答…`);
    }else if(msg.requestType==='discuss'){
      const chat=chats.get(msg.actionId);if(chat){chat.url=msg.capture.url;chat.status='已读取本次代码与运行区，正在保存问题';renderChats();}
    }
    return;
  }
  if(msg.type==='saved'){
    const item=actions.get(msg.actionId);if(!item)return;item.saved=true;
    if(item.type==='quick_save'){$('quickSave').disabled=false;$('quickSave').textContent='快捷保存';}
    if(item.type==='hint'){$('hint').disabled=false;$('refreshHint').disabled=false;if(msg.hint){currentHint=msg.hint;updateJob(msg.hint,msg.actionId);}}
    if(item.type==='solution'&&msg.actionId===solutionAction){if(msg.hint){currentSolution=msg.hint;updateJob(msg.hint,msg.actionId);}else{$('giveSolution').disabled=false;status('solutionState','代码已保存，但解答任务尚未确认，请重试。',true);}}
    if(item.type==='discuss'){$('send').disabled=false;if(msg.hint){updateJob(msg.hint,msg.actionId);status('chatState','本轮问题与当时源码已保存，回复状态见下方。');}}
    status('saveStatus',`${msg.title||'本次代码'}已保存到本机${msg.cached?'（复用相同内容）':''}，可继续写代码或保存其他题目。`);
    if(msg.workerError)status('saveStatus','源码已保存，但后台分析启动失败：'+msg.workerError,true);
    if(msg.hintError||msg.hintWorkerError){const text='源码已保存，但问答后台任务未正常启动：'+(msg.hintError||msg.hintWorkerError);status(item.type==='solution'?'solutionState':item.type==='hint'?'hintState':'chatState',text,true);if(item.type==='solution')$('giveSolution').disabled=false;const chat=chats.get(msg.actionId);if(chat&&!msg.hint){chat.status=text;renderChats();}}
    return;
  }
  if(msg.type==='hint_status'){polling.delete(msg.id);updateJob(msg,msg.actionId);return;}
  if(msg.type==='assist_context'){
    if(historyAction?.id===msg.actionId&&historyAction.sequence>=contextSequence){
      contextSequence=historyAction.sequence;showCapture(msg.capture,msg.missingSections);
      hintCapture=msg.capture;
    }return;
  }
  if(msg.type==='assist_history'){
    if(historyAction?.id!==msg.actionId||msg.url!==activeUrl)return;
    const hints=msg.hints||{},discussion=msg.discussion||{};
    const pendingHint=[...actions.values()].some(item=>item.type==='hint'&&!item.saved&&!item.failed);
    const pendingSolution=[...actions.values()].some(item=>item.type==='solution'&&!item.saved&&!item.failed);
    if(historyAction.sequence>=hintRequestSequence&&!pendingHint){
      if(hints.hint?.kind==='hint'&&hints.hint.sourceUrl===activeUrl){currentHint=hints.hint;updateJob(hints.hint,hints.hint.eventId);}
      else if(!currentHint)status('hintState',hints.total&&!hints.solution?'上次记录暂时无法读取，请重新打开重试。':'本题暂无已保存的提示，点击“按当前代码重新提示”生成。',Boolean(hints.total&&!hints.solution));
    }
    if(historyAction.sequence>=solutionRequestSequence&&!pendingHint&&!pendingSolution&&hints.solution?.purpose==='solution'&&hints.solution.sourceUrl===activeUrl){
      currentSolution=hints.solution;$('solutionPanel').hidden=false;updateJob(hints.solution,hints.solution.eventId);
    }
    contextSequence=Math.max(contextSequence,historyAction.sequence);
    for(const job of discussion.entries||[])if(job.kind==='discussion'&&job.purpose!=='solution'&&job.sourceUrl===activeUrl)updateJob(job,job.eventId);
    renderChats();status('chatState',discussion.total?`本题已保存 ${discussion.total} 轮交流`:'本题暂无交流记录。发送时会读取并保存当前代码。');
    if(historyAction.autoStart&&historyAction.sequence===sequence&&!hints.total&&!hints.hint&&!hints.solution&&!currentHint&&!currentSolution)start('hint');
    return;
  }
  if(msg.type==='error'){
    if(msg.requestType==='hint_status'){polling.clear();return;}
    const item=actions.get(msg.actionId);if(item)item.failed=true;
    if(item?.type==='quick_save'){$('quickSave').disabled=false;$('quickSave').textContent='快捷保存';}
    if(item?.type==='hint'){$('hint').disabled=false;$('refreshHint').disabled=false;status('hintState',msg.error,true);}
    if(item?.type==='solution'&&msg.actionId===solutionAction){$('giveSolution').disabled=false;$('giveSolution').textContent='重新给出解答';status('solutionState','尚未确认本次解答请求：'+msg.error,true);}
    if(item?.type==='discuss'){$('send').disabled=false;const chat=chats.get(msg.actionId);if(chat){chat.status='尚未确认保存：'+msg.error;renderChats();}}
    status(msg.requestType==='assist_history'?(historyAction?.mode==='discussion'?'chatState':'hintState'):'saveStatus','尚未确认本次操作：'+msg.error,true);
  }
}
$('quickSave').onclick=()=>start('quick_save');$('hint').onclick=()=>start('hint');
$('refreshHint').onclick=()=>start('hint');
$('giveSolution').onclick=()=>start('solution',solutionQuestion);
$('discussion').onclick=()=>openHistory('discussion');
$('chatPanel').ontoggle=()=>{const open=$('chatPanel').open;if(open===chatWasOpen)return;chatWasOpen=open;if(open)openHistory('discussion');};
$('chatForm').onsubmit=event=>{event.preventDefault();const question=$('question').value.trim();if(!question||$('send').disabled)return;start('discuss',question);$('question').value='';};
setInterval(()=>{
  if(!port)return;
  for(const job of jobs.values())if(['queued','running'].includes(job.status)&&!polling.has(job.id)){
    polling.add(job.id);send({type:'hint_status',id:job.id,actionId:job.actionId});
  }
},500);
// This own extension frame is opened only by an explicit floating-button click.
send({type:'resume'});
