// Injected in MAIN. Keep helpers inside this function: executeScript serializes it.
export function installIdeProtection() {
  if(window.__pkuCoachIdeProtection)return;
  const state={editor:null,timer:null,pending:new Map(),saved:null,backupError:null};
  window.__pkuCoachIdeProtection=state;
  const emit=(type,detail)=>document.dispatchEvent(new CustomEvent(type,{detail}));
  function capture() {
    const editor=document.querySelector('#editor.ace_editor')?.env?.editor;
    if(!editor||editor.getReadOnly?.()||window.ide_mode||!/^\d{1,30}$/.test(String(window.userid))||!window.sourceCodeVersion)return null;
    const code=editor.getValue();
    if(typeof code!=='string')return null;
    return {url:location.origin+location.pathname,account:String(window.userid),code,title:document.title.slice(0,200)};
  }
  const same=(a,b)=>Boolean(a&&b&&a.url===b.url&&a.account===b.account&&a.code===b.code);
  const quota=error=>error?.name==='QuotaExceededError';
  const notice=(kind,message)=>emit('pku-coach-draft-notice',{kind,message});
  const cacheNotice=()=>{
    if(window.__pkuCoachCacheGuard?.skippedCacheWrites)notice('cache','网站缓存空间已满，本次题面缓存未写入；页面继续加载。现有草稿未删除，这不代表当前代码已保存，请使用快捷保存。');
  };
  document.addEventListener('pku-coach-cache-notice',cacheNotice);
  cacheNotice();
  function persist(draft) {
    if(!draft)return Promise.reject(new Error('请先在自己的题目中点击“编辑修改”，再使用草稿保护。'));
    if(draft.code.length>100000)return Promise.reject(new Error('代码超过 100000 字符，请先复制到本地文件。'));
    if(same(state.saved,draft))return Promise.resolve();
    for(const request of state.pending.values())if(same(request.draft,draft))return request.promise;
    const requestId=crypto.randomUUID();
    let resolve,reject;
    const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});
    const timeout=setTimeout(()=>{
      state.pending.delete(requestId);reject(new Error('独立草稿备份未获确认，请先复制代码到本地文件，再重试测试。'));
    },8000);
    state.pending.set(requestId,{draft,promise,resolve,reject,timeout});
    emit('pku-coach-draft-save',{requestId,draft});
    return promise;
  }
  document.addEventListener('pku-coach-draft-reply',event=>{
    const reply=event.detail,request=state.pending.get(reply?.requestId);
    if(!request)return;
    clearTimeout(request.timeout);state.pending.delete(reply.requestId);
    if(reply.ok){state.saved=request.draft;request.resolve();}
    else request.reject(new Error(reply.error||'独立草稿备份失败，请先复制代码到本地文件。'));
  });
  function flush() {const draft=capture();if(draft)persist(draft).catch(error=>notice('error',error.message));}
  function schedule() {clearTimeout(state.timer);state.timer=setTimeout(flush,600);}
  function hook() {
    const editor=document.querySelector('#editor.ace_editor')?.env?.editor;
    if(editor&&editor!==state.editor){
      state.editor=editor;
      editor.on?.('change',schedule);
    }
    const draft=capture();
    if(draft&&state.scope!==draft.account+draft.url){
      state.scope=draft.account+draft.url;
      emit('pku-coach-draft-ready',{account:draft.account});
    }
    if(typeof window.backupSourceCodeForRecovery==='function'&&window.backupSourceCodeForRecovery!==state.backupWrapper){
      const original=window.backupSourceCodeForRecovery;
      state.backupWrapper=function(...args){
        const draft=capture();
        try{return original.apply(this,args);}
        catch(error){
          // Only this known failure in the site's backup step is eligible.
          // Authentication, compile errors, and other exceptions stay untouched.
          if(!quota(error)||!draft)throw error;
          state.backupError={error,draft};
          // The site's serializer deletes sourceCode before a second write. Put
          // it back in memory if that write failed; no stored data is removed.
          if(window.backup?.id===window.problemId)window.backup.sourceCode=draft.code;
          notice('quota','网站的草稿存储空间已满，正在使用扩展的独立草稿备份。请勿清除网站数据。');
          if(same(state.saved,draft))return;
          persist(draft).catch(error=>notice('error',error.message));
          throw error;
        }
      };
      window.backupSourceCodeForRecovery=state.backupWrapper;
    }
    if(typeof window.runCode==='function'&&window.runCode!==state.runWrapper){
      const original=window.runCode;
      state.runWrapper=function(...args){
        // A repeated click while the same request is awaiting a durable backup
        // must not submit/run the program twice.
        if(state.resuming)return state.resuming;
        state.backupError=null;
        try{return original.apply(this,args);}
        catch(error){
          const failure=state.backupError;
          if(!failure||failure.error!==error||!same(capture(),failure.draft))throw error;
          const receiver=this;
          const resume=(async()=>{
            try{
              await persist(failure.draft);
              if(!same(capture(),failure.draft)){
                notice('changed','等待备份期间代码又有修改，请重新点击测试。新代码不会被旧版本覆盖。');
                return;
              }
              // The first call stopped inside backup, before disableRun/AJAX.
              // Now the exact buffer is durably saved, retry the original flow.
              return original.apply(receiver,args);
            }catch(savedError){notice('error',savedError.message);}
            finally{state.resuming=null;}
          })();
          state.resuming=resume;
          return resume;
        }
      };
      window.runCode=state.runWrapper;
    }
  }
  state.capture=capture;
  state.restore=(draft,expectedCode)=>{
    const current=capture();
    if(!current||!same({...current,code:draft.code},draft))return {ok:false,error:'请回到同一账号的本题，先点平台“编辑修改”，再恢复草稿。'};
    if(current.code!==expectedCode)return {ok:false,error:'恢复前代码又发生了修改，已停止覆盖。请重新查看草稿后再试。'};
    state.editor.setValue(draft.code,-1);
    state.editor.focus?.();
    schedule();
    return {ok:true};
  };
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')flush();});
  window.addEventListener('pagehide',flush);
  hook();setInterval(hook,1000);
}

export function readEditableDraft() {
  return window.__pkuCoachIdeProtection?.capture()||null;
}

export function restoreEditorDraft(draft,expectedCode) {
  return window.__pkuCoachIdeProtection?.restore(draft,expectedCode)||{ok:false,error:'草稿保护尚未就绪，请先点击“编辑修改”。'};
}
