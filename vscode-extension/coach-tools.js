(()=>{
  const api=acquireVsCodeApi(),$=id=>document.getElementById(id),mode=document.body.dataset.mode,copies=new Map();let catalog,settings,currentCode='',selection=0;
  const send=(type,extra={})=>api.postMessage({type,...extra});
  const status=(text,error=false)=>{$('toolsStatus').textContent=text;$('toolsStatus').classList.toggle('error',error);};
  $('closeTools').onclick=()=>send('tools_close');
  function copy(text){return new Promise((resolve,reject)=>{const id=crypto.randomUUID(),timer=setTimeout(()=>{copies.delete(id);reject(new Error('复制未确认，请重试。'));},5000);copies.set(id,{resolve,reject,timer});send('copy_code',{id,text});});}
  Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:copy}});
  function efforts(kind,preserve){
    const model=catalog.models.find(m=>m.model===$(kind+'Model').value),select=$(kind+'Effort');select.replaceChildren();
    for(const item of model?.efforts||[]){const option=document.createElement('option');option.value=item.effort;option.textContent=item.effort;option.title=item.description;select.append(option);}
    const wanted=preserve&&model?.efforts.some(x=>x.effort===preserve)?preserve:model?.defaultEffort;
    if(wanted)select.value=wanted;$(kind+'Description').textContent=model?.description||'';
  }
  function fillModels(value){
    settings=value.settings;catalog=value.catalog;
    if(!catalog?.models?.length){status(value.error||'未取得模型清单，请点击刷新。',true);return;}
    for(const kind of ['interactive','report']){
      const select=$(kind+'Model');select.replaceChildren();
      for(const model of catalog.models){const option=document.createElement('option');option.value=model.model;option.textContent=model.name===model.model?model.model:model.name+' · '+model.model;select.append(option);}
      const profile=settings[kind],listed=catalog.models.some(m=>m.model===profile.model);
      if(listed)select.value=profile.model;else select.selectedIndex=-1;
      efforts(kind,profile.effort);select.onchange=()=>efforts(kind,$(kind+'Effort').value);
    }
    $('saveModels').disabled=false;
    status((catalog.warning?catalog.warning+'；':'')+'清单读取时间：'+new Date(catalog.fetchedAt).toLocaleString('zh-CN')+'。请选择后保存。',Boolean(catalog.warning));
  }
  if(mode==='models'){
    $('refreshModels').onclick=()=>{status('正在读取本机 Codex 模型清单…');send('model_settings_get',{refresh:true});};
    $('modelsForm').onsubmit=event=>{event.preventDefault();$('saveModels').disabled=true;status('正在核对并保存设置…');const result={};for(const kind of ['interactive','report'])result[kind]={model:$(kind+'Model').value,effort:$(kind+'Effort').value};send('model_settings_save',{settings:result});};
    send('model_settings_get');
  }else{
    const choose=()=>{currentCode='';$('copyVersion').disabled=true;$('exportVersion').disabled=true;status('正在校验并读取所选版本…');send('version_read',{eventId:$('versions').value,selection:++selection});};
    $('versions').onchange=choose;$('copyVersion').onclick=()=>void copy(currentCode).catch(error=>status(error.message,true));$('exportVersion').onclick=()=>send('export_version',{eventId:$('versions').value});send('versions_list');
    window.coachChooseVersion=choose;
  }
  window.addEventListener('message',event=>{
    const m=event.data;
    if(m.type==='model_settings')fillModels(m);
    if(m.type==='model_settings_saved'){$('saveModels').disabled=false;settings=m.settings;status('设置已保存。交互：'+settings.interactive.model+' / '+settings.interactive.effort+'；后台分析：'+settings.report.model+' / '+settings.report.effort+'。下一次新请求生效。');}
    if(m.type==='versions_list'){
      $('versionCount').textContent=m.title+' · '+m.totalEvents+' 次保存 · '+m.uniqueVersions+' 份独立源码';$('versions').replaceChildren();
      for(const version of m.versions){const option=document.createElement('option');option.value=version.eventId;option.textContent='#'+version.firstNumber+(version.firstNumber===version.lastNumber?'':'—'+version.lastNumber)+' · '+new Date(version.savedAt).toLocaleString('zh-CN')+' · '+version.codeHash.slice(0,8)+(version.verdict?' · '+version.verdict:'')+' · '+version.occurrenceCount+' 次';$('versions').append(option);}
      if(m.versions.length)window.coachChooseVersion();else status('本题还没有保存的版本。');
    }
    if(m.type==='version_read'){
      if(m.selection!==selection)return;currentCode=m.code;$('versionMeta').textContent=m.title+' · 保存时间 '+new Date(m.savedAt).toLocaleString('zh-CN')+' · 源码 '+m.codeHash.slice(0,12);
      const fence='`'.repeat(Math.max(3,...(m.code.match(/`+/g)||[]).map(x=>x.length+1)));
      globalThis.PkuReportRenderer.render($('versionCode'),fence+'cpp\n'+m.code+'\n'+fence);$('versionDiff').textContent=m.sameCode?'与打开历史时的当前代码相同。':m.diff;$('copyVersion').disabled=false;$('exportVersion').disabled=false;status('历史快照已校验，可复制或导出为新文件。');
    }
    if(m.type==='version_exported')status(m.cancelled?'已取消导出。':'已导出新文件：'+m.path);
    if(m.type==='copy_reply'){const pending=copies.get(m.id);if(pending){clearTimeout(pending.timer);copies.delete(m.id);m.error?pending.reject(new Error(m.error)):pending.resolve();}status(m.error||'已复制。',Boolean(m.error));}
    if(m.type==='error'){status(m.error,true);if($('saveModels'))$('saveModels').disabled=false;}
  });
})();
