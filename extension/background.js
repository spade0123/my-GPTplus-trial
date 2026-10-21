import {extractPage} from './extract.js';
import {installSubmissionObserver} from './submission-observer.js';
import {installIdeProtection,readEditableDraft,restoreEditorDraft} from './ide-protection.js';
import {storeDraft,readDrafts} from './draft-store.js';
import {selectActionCapture,readCurrentJudgment} from './capture-actions.js';
import {inspectSiteStorage,readSiteCache,clearSiteCache,backupAndClearSiteCache} from './site-cache.js';
import {createCacheBackupStore} from './cache-backup-store.js';
import {createCacheMaintenance} from './cache-maintenance.js';
const validUrl=s=>{try{const u=new URL(s);return u.origin==='https://programming.pku.edu.cn'&&/^\/probset\/[a-f0-9]{32}\/[a-f0-9]{32}\/ide\.do$/.test(u.pathname);}catch{return false;}};
let native=null;
const requests=new Map();
const submissions=new Map();
const preparing=new Map();
const send=(port,message)=>{try{port.postMessage(message);}catch{}};
let cacheBackups,cacheMaintenance;
const backupStorage=()=>cacheBackups||=(createCacheBackupStore());
async function performCacheCleanup(tabId){
  const tab=await chrome.tabs.get(tabId);if(!validUrl(tab.url))throw new Error('请回到北大题目 IDE 页面。');
  const [{result:snapshot}]=await chrome.scripting.executeScript({target:{tabId},world:'MAIN',func:readSiteCache});
  if(!snapshot)throw new Error('未能读取题面缓存，尚未清理任何内容。');
  snapshot.entries.sort((a,b)=>a.key.localeCompare(b.key));
  // Identical cache snapshots share one backup, independently of the draft quota.
  const bytes=new TextEncoder().encode(JSON.stringify({url:snapshot.url,entries:snapshot.entries}));
  const hash=await crypto.subtle.digest('SHA-256',bytes);
  const id=[...new Uint8Array(hash)].map(n=>n.toString(16).padStart(2,'0')).join('');
  return backupAndClearSiteCache({storage:backupStorage(),snapshot,id,clear:async confirmed=>{
    const [{result}]=await chrome.scripting.executeScript({target:{tabId},world:'MAIN',func:clearSiteCache,args:[confirmed]});
    if(!result)throw new Error('未能确认清理结果。');return result;
  }});
}
function maintainCache(tabId,options){
  cacheMaintenance||=createCacheMaintenance({inspect:async id=>{
    const [{result}]=await chrome.scripting.executeScript({target:{tabId:id},world:'MAIN',func:inspectSiteStorage});
    if(!result)throw new Error('未能检查网站缓存。');return result;
  },clean:performCacheCleanup});
  return cacheMaintenance.check(tabId,options);
}
async function exportCacheBackup(requestedKey){
  let key=requestedKey,backup;
  try{
    const storage=backupStorage();
    key||=(await storage.get('pku-site-cache-last-backup'))['pku-site-cache-last-backup'];
    if(key&&/^pku-site-cache-backup-(?:[-a-f0-9]{36}|[a-f0-9]{64})$/i.test(key))backup=(await storage.get(key))[key];
  }catch{ /* Legacy backups remain downloadable even if IndexedDB is unavailable. */ }
  if(!backup){
    key=requestedKey||(await chrome.storage.local.get('pku-site-cache-last-backup'))['pku-site-cache-last-backup'];
    if(!/^pku-site-cache-backup-(?:[-a-f0-9]{36}|[a-f0-9]{64})$/i.test(key||''))throw new Error('还没有已保存的清理备份。');
    backup=(await chrome.storage.local.get(key))[key];
  }
  if(!backup)throw new Error('缓存备份不存在。');
  return JSON.stringify(backup,null,2);
}
function nativeRequest(port,message) {
  if(new Blob([JSON.stringify(message)]).size>299000)throw new Error('本次内容超过本机连接大小限制，请在核对详情中精简题面或运行文本。');
  if(!native) {
    native=chrome.runtime.connectNative('edu.pku.cpp_coach');
    native.onMessage.addListener(reply=>{
      const target=requests.get(reply.requestId);
      if(target){send(target.port,reply);target.resolve(reply);requests.delete(reply.requestId);}
    });
    native.onDisconnect.addListener(()=>{
      const error=chrome.runtime.lastError?.message;native=null;
      for(const [requestId,target] of requests){const reply={type:'error',requestId,requestType:target.type,actionId:target.actionId,error:`本机连接中断：${error||'请刷新页面重试'}。已保存的后台报告仍会继续处理。`};send(target.port,reply);target.resolve(reply);}
      requests.clear();
    });
  }
  const requestId=crypto.randomUUID();
  return new Promise(resolve=>{requests.set(requestId,{port,type:message.type,actionId:message.actionId,resolve});native.postMessage({...message,requestId});});
}
chrome.runtime.onConnect.addListener(port=>{
  if(port.name!=='pku-coach'||!port.sender?.tab?.id||!validUrl(port.sender.url)) {port.disconnect();return;}
  const tabId=port.sender.tab.id;
  if(chrome.scripting?.executeScript)Promise.resolve(chrome.storage?.local?.get(['preferredSource'])||{}).then(settings=>chrome.scripting.executeScript({target:{tabId},world:'MAIN',func:installSubmissionObserver,args:[settings.preferredSource||'']})).catch(()=>{});
  if(chrome.scripting?.executeScript)chrome.scripting.executeScript({target:{tabId},world:'MAIN',func:installIdeProtection}).catch(()=>{});
  port.onDisconnect.addListener(()=>{for(const [id,target] of requests)if(target.port===port){target.resolve({type:'error',error:'页面已断开连接'});requests.delete(id);}});
  port.onMessage.addListener(async message=>{
    try {
      const tab=await chrome.tabs.get(tabId);if(!validUrl(tab.url))throw new Error('请回到北大题目 IDE 页面。');
      if(message.type==='auto_site_cache'){
        const result=await maintainCache(tabId,{force:message.reason==='pressure'});
        send(port,{type:'auto_site_cache_status',...result});return;
      }
      if(message.type==='clear_site_cache'){
        const result=await performCacheCleanup(tabId);
        send(port,{type:'site_cache_cleared',...result});return;
      }
      if(message.type==='export_site_cache'){
        send(port,{type:'site_cache_export',text:await exportCacheBackup(message.backupKey)});return;
      }
      if(['quick_save','hint','discuss'].includes(message.type)){
        if(message.type==='discuss'&&(typeof message.question!=='string'||!message.question.trim()||message.question.length>2000))throw new Error('请输入 1—2000 字的问题。');
        const settings=await chrome.storage.local.get(['preferredSource','standard']);
        const extracted=await chrome.scripting.executeScript({target:{tabId},world:'MAIN',func:extractPage});
        const selected=selectActionCapture(extracted[0]?.result,tab.url,settings);
        if(JSON.stringify(selected.capture).length>250000)throw new Error('题面和代码过长，请使用核对详情精简后保存。');
        let judgeEvidence;
        if(message.type==='hint'){
          const read=await chrome.scripting.executeScript({target:{tabId},world:'MAIN',func:readCurrentJudgment,args:[selected.capture.code]});
          const bytes=new TextEncoder().encode(selected.capture.code.replace(/\r\n/g,'\n').trim());
          const hash=await crypto.subtle.digest('SHA-256',bytes);
          judgeEvidence={...read[0]?.result,codeHash:[...new Uint8Array(hash)].map(n=>n.toString(16).padStart(2,'0')).join('')};
        }
        const current=await chrome.tabs.get(tabId);
        if(new URL(current.url).origin+new URL(current.url).pathname!==selected.capture.url)throw new Error('读取时已切换题目，请重新点击。');
        if(message.type==='hint')send(port,{type:'hint_preview',actionId:message.actionId,capture:selected.capture,judgment:judgeEvidence});
        if(message.type==='discuss')send(port,{type:'discussion_preview',actionId:message.actionId,capture:selected.capture,question:message.question,selectedCode:extracted[0]?.result?.selectedCode||''});
        await chrome.scripting.executeScript({target:{tabId},world:'MAIN',func:installSubmissionObserver,args:[selected.source]});
        await nativeRequest(port,{type:message.type,capture:selected.capture,judgeEvidence,eventId:message.actionId||crypto.randomUUID(),actionId:message.actionId,question:message.question,selectedCode:extracted[0]?.result?.selectedCode||'',requestedAt:message.requestedAt});return;
      }
      if(message.type==='draft_save'){
        const saved=await storeDraft(chrome.storage.local,message.draft,tab.url);
        send(port,{type:'draft_saved',requestId:message.requestId,updatedAt:saved.updatedAt});return;
      }
      if(message.type==='draft_list'){
        const record=await readDrafts(chrome.storage.local,tab.url,message.account);
        send(port,{type:'draft_list',record});return;
      }
      if(message.type==='draft_restore'){
        const record=await readDrafts(chrome.storage.local,tab.url,message.account),version=record.versions.find(v=>v.id===message.versionId);
        if(!version)throw new Error('没有找到这个草稿版本。');
        const [{result:current}]=await chrome.scripting.executeScript({target:{tabId},world:'MAIN',func:readEditableDraft});
        if(!current||current.account!==record.account||current.url!==record.url)throw new Error('请先在本题点击平台“编辑修改”，再恢复草稿。');
        // Preserve what is on screen before applying the explicitly chosen copy.
        await storeDraft(chrome.storage.local,current,tab.url);
        const [{result}]=await chrome.scripting.executeScript({target:{tabId},world:'MAIN',func:restoreEditorDraft,args:[{...current,code:version.code},current.code]});
        if(!result?.ok)throw new Error(result?.error||'未能恢复草稿。');
        send(port,{type:'draft_restored'});return;
      }
      if(message.type==='extract') {
        const result=await chrome.scripting.executeScript({target:{tabId},world:'MAIN',func:extractPage});
        send(port,{type:'capture',capture:result[0]?.result});return;
      }
      if(['save','analyze'].includes(message.type)) {
        if(!message.capture||!validUrl(message.capture.url)||new URL(message.capture.url).pathname!==new URL(tab.url).pathname)throw new Error('题目页面已改变，请重新提取。');
        if(JSON.stringify(message.capture).length>250000)throw new Error('题面和代码过长。');
        await nativeRequest(port,{type:'save',capture:message.capture,note:message.note||'',eventId:message.eventId||crypto.randomUUID()});
      }else if(message.type==='submission') {
        const receipt=message.receipt;
        if(!receipt||receipt.url!==new URL(tab.url).origin+new URL(tab.url).pathname||!/^[-a-f0-9]{36}$/i.test(receipt.id)||typeof receipt.code!=='string'||receipt.code.length>100000)throw new Error('提交快照无效。');
        const work=(async()=>{
          const extracted=await chrome.scripting.executeScript({target:{tabId},world:'MAIN',func:extractPage});
          const p=extracted[0]?.result;if(!p)throw new Error('提交时未能读取题面。');
          const capture={url:receipt.url,title:p.title,problem:p.problem,runtime:p.runtime,code:receipt.code,standard:message.standard||'c++17'};
          const entry={capture,note:message.note||'',receipt,finalEventId:crypto.randomUUID()};submissions.set(receipt.id,entry);
          await chrome.storage.session.set({[`pku-submission-${receipt.id}`]:entry});
          entry.ready=nativeRequest(port,{type:'submission',capture,note:entry.note,eventId:receipt.id,submissionId:receipt.id});
          const saved=await entry.ready;if(saved.type!=='saved')throw new Error(saved.error||'提交快照未保存');
        })();
        preparing.set(receipt.id,work);try{await work;}finally{preparing.delete(receipt.id);}
      }else if(['accepted','judged'].includes(message.type)) {
        const id=message.accepted?.submissionId;
        if(!/^[-a-f0-9]{36}$/i.test(id||''))throw new Error('评测关联无效。');
        if(preparing.has(id))await preparing.get(id);
        let entry=submissions.get(id);
        if(!entry)entry=(await chrome.storage.session.get(`pku-submission-${id}`))[`pku-submission-${id}`];
        if(!entry||entry.capture.url!==new URL(tab.url).origin+new URL(tab.url).pathname||entry.capture.code!==message.accepted.code)throw new Error('AC 与提交代码未能对应，过程保存不受影响。');
        if(entry.ready){const saved=await entry.ready;if(saved.type!=='saved')throw new Error('提交快照尚未保存，暂不归档。');}
        else {const saved=await nativeRequest(port,{type:'submission',capture:entry.capture,note:entry.note,eventId:id,submissionId:id});if(saved.type!=='saved')throw new Error('提交快照未保存。');}
        const extracted=await chrome.scripting.executeScript({target:{tabId},world:'MAIN',func:extractPage});
        const runtime=extracted[0]?.result?.runtime||{};
        const result=message.accepted.verdict?.status==='AC'?
          await nativeRequest(port,{type:'finish',capture:entry.capture,note:entry.note,eventId:entry.finalEventId,submissionId:id,verdict:message.accepted.verdict,runtime}):
          await nativeRequest(port,{type:'verdict',url:entry.capture.url,submissionId:id,verdict:message.accepted.verdict,runtime});
        if(result.type!=='error'){submissions.delete(id);await chrome.storage.session.remove(`pku-submission-${id}`);}
      }else if(message.type==='observe') {
        await chrome.scripting.executeScript({target:{tabId},world:'MAIN',func:installSubmissionObserver,args:[String(message.source||'')]});
      }else if(['recent','problem','discussion_history'].includes(message.type))await nativeRequest(port,{type:message.type,url:new URL(tab.url).origin+new URL(tab.url).pathname});
      else if(message.type==='retry_archive'&&/^[-a-f0-9]{36}$/i.test(message.archiveId||''))await nativeRequest(port,{type:'retry_archive',url:new URL(tab.url).origin+new URL(tab.url).pathname,archiveId:message.archiveId});
      else if(['review','retry','hint_status','hint_retry'].includes(message.type)&&/^[a-f0-9]{64}$/.test(message.id))await nativeRequest(port,{type:message.type,id:message.id,actionId:message.actionId});
    }catch(e){send(port,{type:'error',requestType:message.type,requestId:message.requestId,actionId:message.actionId,error:e.message});}
  });
});
