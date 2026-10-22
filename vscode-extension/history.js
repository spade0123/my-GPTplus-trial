(() => {
  const api=acquireVsCodeApi(),$=id=>document.getElementById(id),pending=new Map();
  const saved=api.getState()||{},drafts=saved.drafts||{};
  let topics=[],topicKey=saved.topicKey,selectedId=saved.selectedId,detail=null,parentId=null,pollTimer,busy=false,revision=0,loading=false,editorId;
  $('archived').checked=Boolean(saved.includeArchived);
  const remember=()=>api.setState({topicKey,selectedId,includeArchived:$('archived').checked,drafts});
  function request(type,fields={}){return new Promise((resolve,reject)=>{const requestId=crypto.randomUUID(),timer=setTimeout(()=>{pending.delete(requestId);reject(new Error('本机服务未及时回复。若刚发送了追问，请先刷新查看记录，避免重复发送。'));},35000);pending.set(requestId,{resolve,reject,timer});api.postMessage({type,...fields,requestId});});}
  window.addEventListener('message',event=>{const reply=event.data,p= pending.get(reply.requestId);if(!p)return;pending.delete(reply.requestId);clearTimeout(p.timer);reply.error?p.reject(new Error(reply.error)):p.resolve(reply.value);});
  Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{await request('copy_code',{text});}}});
  const node=(tag,text,className)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(className)e.className=className;return e;};
  const button=(text,fn,className)=>{const b=node('button',text,className);b.type='button';b.onclick=()=>run(fn);return b;};
  const time=value=>value?new Date(value).toLocaleString():'';
  const status=value=>({queued:'等待生成',running:'正在回答',complete:'已完成',failed:'生成失败',skipped:'已跳过',empty:'尚无消息'}[value]||value);
  function notice(text=''){$('notice').textContent=text;}
  async function run(fn){try{await fn();}catch(error){notice(error.message);}}
  function saveDraft(){if(editorId)drafts[editorId]=$('question').value;remember();}
  function renderTopics(){
    $('topics').replaceChildren();const query=$('search').value.trim().toLowerCase();
    for(const topic of topics){if(query&&![topic.title,...topic.threads.map(t=>t.title)].join(' ').toLowerCase().includes(query))continue;
      const b=button(topic.title,async()=>{topicKey=topic.key;selectedId=null;renderTopics();renderThreads();await choose(topic.threads[0]?.id);},topic.key===topicKey?'active':'');
      b.append(node('small',topic.threads.length+' 段对话'));b.setAttribute('aria-current',String(topic.key===topicKey));$('topics').append(b);
    }
    if(!$('topics').children.length)$('topics').append(node('p',topics.length?'没有匹配结果':'还没有本机对话记录。先用“网格·交流”提问。','muted'));
  }
  function renderThreads(){
    const list=$('threads');list.replaceChildren();const topic=topics.find(t=>t.key===topicKey);if(!topic)return;
    for(const thread of topic.threads){const b=button((thread.archived?'[归档] ':'')+thread.title+' · '+thread.count,()=>choose(thread.id),'thread'+(thread.id===selectedId?' active':''));b.title=time(thread.updatedAt)+' · '+status(thread.status);list.append(b);}
    list.append(button('+ 新对话',async()=>{if(busy)return;const created=await request('conversation_create',{snapshotId:topic.snapshotId});selectedId=created.id;await refresh(false);await choose(created.id);}));
  }
  async function refresh(select=true){
    const previousId=selectedId;const result=await request('conversation_topics',{includeArchived:$('archived').checked});topics=result.topics;
    if(!topics.some(t=>t.key===topicKey))topicKey=topics[0]?.key;
    const topic=topics.find(t=>t.key===topicKey);if(!topic?.threads.some(t=>t.id===selectedId))selectedId=topic?.threads[0]?.id;
    renderTopics();renderThreads();remember();if(select||previousId!==selectedId)await choose(selectedId);
  }
  function renderDetail(keepScroll=false){
    const view=$('transcript'),nearBottom=view.scrollHeight-view.scrollTop-view.clientHeight<90,oldTop=view.scrollTop;
    view.replaceChildren();$('toolbar').hidden=!detail;$('composer').hidden=!detail;
    if(!detail){view.append(node('p','选择题目和对话，或打开快捷交流创建第一条记录。','empty'));return;}
    if(document.activeElement!==$('title'))$('title').value=detail.title;$('archive').textContent=detail.archived?'恢复对话':'归档';
    $('contextNote').textContent='题目：'+detail.problemTitle+' · 使用'+(parentId?'所选回答':'最近一条消息')+'保存时的代码，当前编辑器的修改不会自动加入。';
    $('reference').hidden=!parentId;
    $('reference').replaceChildren(node('span','正在追问所选消息 '),button('取消指定',()=>{parentId=null;renderDetail(true);}));
    const waiting=detail.turns.some(t=>['queued','running'].includes(t.status));
    $('send').disabled=busy||detail.archived||waiting;$('question').disabled=detail.archived;
    if(detail.earlierBefore)view.append(button('加载更早记录',async()=>{
      const id=selectedId,before=detail.earlierBefore,oldHeight=view.scrollHeight;
      const earlier=await request('conversation_detail',{id,before});if(id!==selectedId)return;
      detail={...detail,earlierBefore:earlier.earlierBefore,turns:[...earlier.turns,...detail.turns]};renderDetail(true);view.scrollTop=view.scrollHeight-oldHeight;
    }));
    if(!detail.turns.length)view.append(node('p','新对话已建立。发送第一个问题开始交流。','empty'));
    for(const turn of detail.turns){
      const article=node('article',undefined,'turn'),meta=node('div',undefined,'meta');meta.append(node('span',time(turn.createdAt)+' · '+status(turn.status)),node('span','代码快照 '+(turn.codeHash||'').slice(0,8)));
      article.append(meta,node('div',turn.question,'question'));
      const answer=node('div',undefined,'answer');PkuReportRenderer.render(answer,turn.answer||'回答尚未生成');article.append(answer);
      if(turn.error)article.append(node('p',turn.error,'muted'));
      article.append(button('查看当时的代码',async()=>{
        const snapshot=await request('conversation_snapshot',{id:detail.id,jobId:turn.id});
        const box=node('details'),label=node('summary','代码快照 · '+(snapshot.standard||'C++')+' · '+time(snapshot.createdAt)),pre=node('pre');pre.append(node('code',snapshot.code));box.open=true;box.append(label,pre);article.append(box);
      }));
      if(turn.parentJobId)article.append(node('small','接续消息 '+turn.parentJobId.slice(0,8)));
      if(turn.status==='complete'&&!detail.archived)article.append(button('追问这条',()=>{parentId=turn.id;renderDetail(true);$('question').focus();}));
      view.append(article);
    }
    if(detail.archived)notice('这段对话已归档。恢复后可以继续追问。');
    if(keepScroll)view.scrollTop=nearBottom?view.scrollHeight:oldTop;else view.scrollTop=view.scrollHeight;
  }
  async function choose(id){
    saveDraft();clearTimeout(pollTimer);const token=++revision;selectedId=id;parentId=null;detail=null;notice();renderThreads();remember();
    editorId=id;$('question').value=drafts[id]||'';renderDetail();if(!id)return;
    const value=await request('conversation_detail',{id});if(token!==revision)return;detail=value;renderDetail();schedule();
  }
  function schedule(){
    clearTimeout(pollTimer);if(!detail?.turns.some(t=>['queued','running'].includes(t.status)))return;
    pollTimer=setTimeout(()=>run(async()=>{
      if(document.hidden){schedule();return;}
      const id=selectedId,token=revision;if(loading)return;loading=true;
      try{const value=await request('conversation_detail',{id});if(token!==revision)return;
        const newIds=new Set(value.turns.map(t=>t.id));detail={...value,turns:[...detail.turns.filter(t=>!newIds.has(t.id)),...value.turns]};renderDetail(true);
      }finally{loading=false;schedule();}
    }),1100);
  }
  $('search').oninput=renderTopics;
  $('question').oninput=saveDraft;
  $('refresh').onclick=()=>run(()=>refresh());
  $('archived').onchange=()=>run(()=>refresh());
  $('quick').onclick=()=>api.postMessage({type:'quick'});
  $('rename').onclick=()=>run(async()=>{if(!selectedId)return;const id=selectedId;await request('conversation_update',{id,title:$('title').value});await refresh(false);if(id===selectedId){detail.title=$('title').value;renderDetail(true);}});
  $('archive').onclick=()=>run(async()=>{if(!detail||busy)return;await request('conversation_update',{id:selectedId,archived:!detail.archived});await refresh();});
  $('export').textContent='导出已加载记录';
  $('export').onclick=()=>{if(!detail)return;const text='# '+detail.problemTitle+' / '+detail.title+'\n\n'+detail.problemUrl+'\n\n'+detail.turns.map(t=>'## '+time(t.createdAt)+'\n\n### 提问\n\n'+t.question+'\n\n### 回答（'+status(t.status)+'）\n\n'+t.answer).join('\n\n---\n\n');api.postMessage({type:'export',text});};
  $('composer').onsubmit=event=>{event.preventDefault();void run(async()=>{
    if(busy||!detail||detail.archived||$('send').disabled)return;
    const question=$('question').value.trim();if(!question)return;
    busy=true;$('send').disabled=true;const id=selectedId,actionId=crypto.randomUUID();notice('已请求生成回答，可以继续查看其他历史。');
    try{const result=await request('conversation_followup',{id,parentJobId:parentId||undefined,question,actionId});drafts[id]='';
      if(selectedId===id){$('question').value='';parentId=null;const value=await request('conversation_detail',{id});if(selectedId===id){detail=value;renderDetail(true);notice(result.workerError?'问题已保存，但后台启动失败：'+result.workerError:'');schedule();}}
      await refresh(false);
    }finally{busy=false;remember();if(detail)renderDetail(true);}
  });};
  $('question').onkeydown=event=>{if((event.ctrlKey||event.metaKey)&&event.key==='Enter'){event.preventDefault();$('composer').requestSubmit();}};
  window.addEventListener('beforeunload',()=>{clearTimeout(pollTimer);saveDraft();});
  void run(()=>refresh());
})();
