const $=id=>document.getElementById(id);
const chats=new Map(),jobs=new Map(),actions=new Map(),polling=new Set();
let port,currentHint,activeUrl='',sequence=0,contextSequence=0,historyAction,windowId;
// Window metadata only. No page capture or native connection on panel startup.
chrome.windows?.getCurrent().then(window=>{windowId=window.id;}).catch(()=>{});
const render=(element,markdown)=>globalThis.PkuReportRenderer.render(element,markdown);
function status(id,text,error=false){$(id).textContent=text;$(id).classList.toggle('error',error);}
function connect(){
  if(port)return port;
  port=chrome.runtime.connect({name:'pku-coach-sidepanel'});
  port.onMessage.addListener(receive);
  port.onDisconnect.addListener(()=>{
    const why=chrome.runtime.lastError?.message||'请点击工具栏图标重新打开';port=null;
    for(const item of actions.values())if(!item.saved){item.failed=true;}
    $('quickSave').disabled=false;$('quickSave').textContent='快捷保存';$('hint').disabled=false;$('send').disabled=false;
    status('saveStatus','连接已断开，未确认的请求不算保存成功：'+why,true);
  });return port;
}
function send(message){try{connect().postMessage({...message,windowId});}catch(error){receive({type:'error',requestType:message.type,actionId:message.actionId,error:error.message});}}
function start(type,question){
  const actionId=crypto.randomUUID(),item={type,question,saved:false,sequence:++sequence};actions.set(actionId,item);
  if(type==='quick_save'){$('quickSave').disabled=true;$('quickSave').textContent='保存中…';}
  if(type==='hint'){$('hint').disabled=true;$('hintPanel').hidden=false;$('chatPanel').hidden=true;currentHint=null;status('hintState','正在读取当前题目和完整代码…');$('hintAnswer').replaceChildren();}
  if(type==='discuss'){$('send').disabled=true;status('chatState','正在保存本轮问题与当前代码…');chats.set(actionId,{actionId,question,url:activeUrl,status:'正在读取并保存当前代码…'});renderChats();}
  status('saveStatus','正在读取并保存本次代码…');
  send({type,question,actionId,requestedAt:new Date().toISOString(),source:$('source').value.trim()});
}
function renderChats(){
  $('chatMessages').replaceChildren();
  for(const item of chats.values()){
    if(activeUrl&&item.url&&item.url!==activeUrl)continue;
    const card=document.createElement('div');card.className='chat';
    const question=document.createElement('p');question.className='question';question.textContent=item.question;
    const meta=document.createElement('p');meta.className='chatMeta';
    const job=item.job,labels={queued:'问题与代码已保存，等待后台回复',running:job?.partialAnalysis?'回复逐步生成中':'问题与代码已保存，模型处理中',complete:'回复已保存',failed:'问题已保存，回复生成失败',skipped:'当前版本已有 AC 证据'};
    meta.textContent=job?`${labels[job.status]||job.status} · 源码 ${job.codeHash?.slice(0,8)||''}`:item.status;
    const answer=document.createElement('article');answer.className='markdown';
    render(answer,job?.status==='complete'?job.analysis:job?.partialAnalysis||item.preview||job?.instantAnalysis||job?.error||'');
    card.append(question,meta,answer);$('chatMessages').append(card);
  }
}
function showHint(job){
  if(job.id!==currentHint?.id)return;
  const label={queued:'当前代码已保存；即时检查如下，深入提示在后台生成',running:'当前代码已保存；模型正在结合题意分析',complete:'提示已生成并保存',failed:'当前代码已保存；深入提示失败',skipped:'这份代码已有匹配的 AC 证据，已保存，继续安排学习分析'};
  status('hintState',(job.title?job.title+' · ':'')+(label[job.status]||job.status),job.status==='failed');
  render($('hintAnswer'),job.analysis||job.partialAnalysis||job.instantAnalysis||job.message||job.error||'');
}
function updateJob(job,actionId){
  const old=jobs.get(job.id);jobs.set(job.id,{...job,actionId:actionId||old?.actionId});
  if(job.kind==='discussion'){
    const key=actionId||old?.actionId||job.eventId||job.id;
    const prior=chats.get(key)||{actionId:key,question:job.question,url:job.sourceUrl};
    chats.set(key,{...prior,job,url:job.sourceUrl||prior.url});renderChats();
  }else if(currentHint?.id===job.id){currentHint=job;showHint(job);}
}
function receive(msg){
  if(msg.type==='action_preview'){
    const item=actions.get(msg.actionId);if(!item||item.failed)return;item.url=msg.capture.url;
    if(item.sequence>=contextSequence){contextSequence=item.sequence;activeUrl=msg.capture.url;$('context').textContent=`当前读取：${msg.capture.title} · ${msg.capture.code.length} 字符${msg.missingSections.length?' · 部分题面缺失，建议核对':''}`;}
    if(msg.requestType==='hint'){
      const preview=globalThis.PkuInstantHints.generate(msg.capture,msg.judgment||{});
      render($('hintAnswer'),preview.markdown);status('hintState','本地即时检查；正在把本次代码保存到本机并安排模型提示');
    }else if(msg.requestType==='discuss'){
      const chat=chats.get(msg.actionId);if(chat){chat.url=msg.capture.url;chat.preview=globalThis.PkuInstantHints.discuss(msg.capture,item.question,msg.selectedCode).markdown;chat.status='本地即时检查；问题与本次代码正在保存';renderChats();}
    }
    return;
  }
  if(msg.type==='saved'){
    const item=actions.get(msg.actionId);if(!item)return;item.saved=true;
    if(item.type==='quick_save'){$('quickSave').disabled=false;$('quickSave').textContent='快捷保存';}
    if(item.type==='hint'){$('hint').disabled=false;if(msg.hint){currentHint=msg.hint;updateJob(msg.hint,msg.actionId);}}
    if(item.type==='discuss'){$('send').disabled=false;if(msg.hint){updateJob(msg.hint,msg.actionId);status('chatState','本轮问题与当时源码已保存，回复状态见下方。');}}
    status('saveStatus',`${msg.title||'本次代码'}已保存到本机${msg.cached?'（复用相同内容）':''}，可继续写代码或保存其他题目。`);
    if(msg.workerError)status('saveStatus','源码已保存，但后台分析启动失败：'+msg.workerError,true);
    if(msg.hintError||msg.hintWorkerError){const text='源码已保存，但问题/提示后台任务未正常启动：'+(msg.hintError||msg.hintWorkerError);status(item.type==='hint'?'hintState':'chatState',text,true);const chat=chats.get(msg.actionId);if(chat&&!msg.hint){chat.status=text;renderChats();}}
    return;
  }
  if(msg.type==='hint_status'){polling.delete(msg.id);updateJob(msg,msg.actionId);return;}
  if(msg.type==='discussion_history'){
    if(historyAction?.id!==msg.actionId||historyAction.sequence!==sequence)return;
    activeUrl=msg.url;contextSequence=historyAction.sequence;
    for(const job of msg.entries||[])updateJob(job,job.eventId);
    renderChats();status('chatState',msg.total?`本题已保存 ${msg.total} 轮交流`:'本题暂无交流记录。发送时会读取并保存当前代码。');return;
  }
  if(msg.type==='error'){
    if(msg.requestType==='hint_status'){polling.clear();return;}
    const item=actions.get(msg.actionId);if(item)item.failed=true;
    if(item?.type==='quick_save'){$('quickSave').disabled=false;$('quickSave').textContent='快捷保存';}
    if(item?.type==='hint'){$('hint').disabled=false;status('hintState',msg.error,true);}
    if(item?.type==='discuss'){$('send').disabled=false;const chat=chats.get(msg.actionId);if(chat){chat.status='尚未确认保存：'+msg.error;renderChats();}}
    status(msg.requestType==='discussion_history'?'chatState':'saveStatus','尚未确认本次操作：'+msg.error,true);
  }
}
$('quickSave').onclick=()=>start('quick_save');$('hint').onclick=()=>start('hint');
$('discussion').onclick=()=>{$('chatPanel').hidden=false;$('hintPanel').hidden=true;status('chatState','正在读取本题已保存的交流记录…');historyAction={id:crypto.randomUUID(),sequence:++sequence};send({type:'discussion_history',actionId:historyAction.id});};
$('chatForm').onsubmit=event=>{event.preventDefault();const question=$('question').value.trim();if(!question||$('send').disabled)return;start('discuss',question);$('question').value='';};
setInterval(()=>{
  if(!port)return;
  for(const job of jobs.values())if(['queued','running'].includes(job.status)&&!polling.has(job.id)){
    polling.add(job.id);send({type:'hint_status',id:job.id,actionId:job.actionId});
  }
},500);
// Opening the sidebar alone neither reads the site nor starts the native host.
