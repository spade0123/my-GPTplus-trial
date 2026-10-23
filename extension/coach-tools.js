(()=>{
  const $=id=>document.getElementById(id),pending=new Map();let snapshot,version,settings,catalog;
  const fmt=t=>t?new Date(t).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):'未记录';
  function request(type,extra={}){const actionId=crypto.randomUUID();pending.set(type,actionId);globalThis.PkuCoachSend({type,actionId,...extra});$('toolsStatus').textContent='正在读取本机记录…';return actionId;}
  function show(mode){$('toolsPanel').hidden=false;$('modelsPanel').hidden=mode!=='models';$('versionsPanel').hidden=mode!=='versions';$('coachMore').open=false;}
  function code(target,value,language='cpp'){// Fence longer than any content fence preserves original code characters.
    const fence='`'.repeat(Math.max(3,...[...String(value).matchAll(/`+/g)].map(m=>m[0].length+1)));
    globalThis.PkuReportRenderer.render($(target),fence+language+'\n'+value+'\n'+fence);
  }
  function meta(job){
    const profile=job.modelConfig?job.modelConfig.model+' / '+job.modelConfig.effort:'历史模型配置未记录';
    const wait=job.startedAt&&job.queuedAt?Math.max(0,Math.round((Date.parse(job.startedAt)-Date.parse(job.queuedAt))/1000))+'秒':job.status==='queued'&&job.queuedAt?Math.max(0,Math.round((Date.now()-Date.parse(job.queuedAt))/1000))+'秒':'未记录';
    return profile+' · 排队 '+wait+' · '+(job.completedAt?'完成 '+fmt(job.completedAt):'请求 '+fmt(job.createdAt));
  }
  function effort(kind,wanted){const model=catalog?.models.find(m=>m.model===$(kind+'Model').value);$(kind+'Effort').replaceChildren();for(const item of model?.efforts||[]){const option=document.createElement('option');option.value=item.effort;option.textContent=item.effort+(item.description?' · '+item.description:'');$(kind+'Effort').append(option);}if(model?.efforts.some(e=>e.effort===wanted))$(kind+'Effort').value=wanted;else if(model?.defaultEffort)$(kind+'Effort').value=model.defaultEffort;}
  function renderSettings(){for(const kind of ['interactive','report']){const select=$(kind+'Model');select.replaceChildren();for(const m of catalog.models){const option=document.createElement('option');option.value=m.model;option.textContent=m.name;select.append(option);}if(catalog.models.some(m=>m.model===settings[kind].model))select.value=settings[kind].model;else{const option=document.createElement('option');option.value=settings[kind].model;option.textContent=settings[kind].model+'（不在本次清单）';option.disabled=true;select.append(option);select.value=option.value;}effort(kind,settings[kind].effort);}}
  function clearVersion(){version=null;$('copyVersion').disabled=$('exportVersion').disabled=true;$('versionCode').replaceChildren();$('versionDiff').replaceChildren();$('versionInfo').textContent='';}
  $('openModels').onclick=()=>{show('models');request('model_settings');};
  $('refreshModels').onclick=()=>request('model_settings',{refresh:true});
  $('saveModels').onclick=()=>{if($('saveModels').disabled)return;$('saveModels').disabled=true;const value={};for(const kind of ['interactive','report'])value[kind]={model:$(kind+'Model').value,effort:$(kind+'Effort').value};request('save_model_settings',{settings:value});};
  for(const kind of ['interactive','report'])$(kind+'Model').onchange=()=>effort(kind);
  $('closeTools').onclick=()=>$('toolsPanel').hidden=true;
  $('openVersions').onclick=()=>{show('versions');clearVersion();if(!snapshot){$('toolsStatus').textContent='请先打开当前题目的提示或交流以读取代码。';return;}request('versions',{url:snapshot.url});};
  $('versions').onchange=()=>{clearVersion();if(snapshot&&$('versions').value)request('version_read',{url:snapshot.url,eventId:$('versions').value});};
  $('openSnapshot').onclick=()=>{$('snapshotPanel').open=true;$('coachMore').open=false;$('snapshotPanel').scrollIntoView({block:'start'});};
  $('copyVersion').onclick=async()=>{if(!version)return;const state=$('toolsStatus');try{await navigator.clipboard.writeText(version.code);if(state?.isConnected)state.textContent='已复制原始代码。';}catch{if(state?.isConnected)state.textContent='复制未完成，请手动选择代码。';}};
  $('exportVersion').onclick=()=>{if(!version)return;const blob=new Blob([version.code],{type:'text/plain;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='pku-version-'+version.number+'-'+version.codeHash.slice(0,12)+'-'+crypto.randomUUID()+'.cpp';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);$('toolsStatus').textContent='已请求另存新的 cpp 文件；未回填编辑器。';};
  globalThis.PkuCoachTools={disconnected(){pending.clear();$('saveModels').disabled=false;$('toolsStatus').textContent='连接已断开，尚未确认的操作请重新打开后重试。';},meta,saved(msg){$('snapshotMeta').textContent=(snapshot?.title||'本次代码')+' · 保存确认 '+fmt(new Date().toISOString())+' · SHA-256 '+(msg.codeHash||'见对应回复');},job(job){$('jobMeta').textContent=meta(job);},capture(value){
    if(snapshot?.url!==value.url){clearVersion();$('versions').replaceChildren();pending.delete('versions');pending.delete('version_read');$('toolsPanel').hidden=true;$('snapshotPanel').open=false;}
    snapshot=value;$('snapshotMeta').textContent=value.title+' · 读取 '+fmt(new Date().toISOString())+' · '+value.code.length+' 字符；保存状态见上方确认';code('snapshotCode',value.code);const r=value.runtime||{};const parts=[];for(const[key,label]of [['input','运行输入'],['output','执行输出'],['hints','页面提示'],['error','错误诊断'],['status','运行状态'],['text','运行区其他文字']])parts.push(label+'：\n'+(r[key]||'（空）'));code('snapshotRuntime',parts.join('\n\n'),'text');
  },receive(message){
    const type=message.requestType||({model_settings:'model_settings',model_settings_saved:'save_model_settings',versions:'versions',version_read:'version_read'}[message.type]);
    if(!['model_settings','save_model_settings','versions','version_read'].includes(type))return false;
    if(pending.get(type)!==message.actionId)return true;pending.delete(type);if(type==='save_model_settings')$('saveModels').disabled=false;
    if(message.type==='error'){$('toolsStatus').textContent=message.error||'操作未完成';return true;}
    if(message.type==='model_settings'){settings=message.settings;catalog=message.catalog;renderSettings();$('toolsStatus').textContent=(catalog.warning||'模型清单已读取')+' · '+fmt(catalog.fetchedAt);}
    if(message.type==='model_settings_saved'){settings=message.settings;$('toolsStatus').textContent='设置已保存；之后的新请求使用所选配置。';}
    if(message.type==='versions'){
      if(message.url!==snapshot?.url)return true;clearVersion();$('versions').replaceChildren();for(const v of message.versions){const option=document.createElement('option');option.value=v.eventId;option.textContent='#'+v.lastNumber+' · '+fmt(v.savedAt)+' · '+v.codeHash.slice(0,8)+' · '+v.occurrenceCount+'次'+(v.verdict?' · '+v.verdict:'');$('versions').append(option);}const empty=document.createElement('option');empty.value='';empty.textContent='选择一个历史版本';$('versions').prepend(empty);$('versions').value='';$('toolsStatus').textContent=message.totalEvents+' 次保存 · '+message.uniqueVersions+' 个独立源码版本'+(message.truncated?'；仅显示最近200组':'');
    }
    if(message.type==='version_read'){version=message;code('versionCode',message.code);code('versionDiff',message.diff,'diff');$('versionInfo').textContent='#'+message.number+' · '+fmt(message.savedAt)+' · SHA-256 '+message.codeHash;$('copyVersion').disabled=$('exportVersion').disabled=false;$('toolsStatus').textContent=message.sameCode?'此版本与本次读取的代码完全相同。':'已比较历史版本与本次读取的当前代码。';}
    return true;
  }};
})();
