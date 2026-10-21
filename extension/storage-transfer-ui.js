import {transferRecords} from './transfer-records.js';
import {chromeDataArea,legacyCacheArea} from './legacy-data-areas.js';
const button=document.getElementById('transfer'),status=document.getElementById('status');
function nativeClient(){
  const port=chrome.runtime.connectNative('edu.pku.cpp_coach'),pending=new Map();let disconnected;
  port.onMessage.addListener(reply=>{const target=pending.get(reply.requestId);if(!target)return;pending.delete(reply.requestId);clearTimeout(target.timer);reply.type==='error'?target.reject(new Error(reply.error)):target.resolve(reply);});
  port.onDisconnect.addListener(()=>{disconnected=chrome.runtime.lastError?.message||'本机连接已断开；尚未核对的旧记录保留。';for(const target of pending.values()){clearTimeout(target.timer);target.reject(new Error(disconnected));}pending.clear();});
  return {close:()=>port.disconnect(),call:message=>new Promise((resolve,reject)=>{
    if(disconnected){reject(new Error(disconnected));return;}
    const requestId=crypto.randomUUID(),timer=setTimeout(()=>{pending.delete(requestId);reject(new Error('本机保存尚未确认，旧记录保留。'));},15000);
    pending.set(requestId,{resolve,reject,timer});try{port.postMessage({...message,requestId});}catch(error){pending.delete(requestId);clearTimeout(timer);reject(error);}
  })};
}
button.onclick=async()=>{
  button.disabled=true;let native,legacy;
  try{
    native=nativeClient();let legacyError;
    try{legacy=await legacyCacheArea();}catch(error){legacyError=error;}
    const areas=[chromeDataArea('local',chrome.storage.local),chromeDataArea('session',chrome.storage.session),...(legacy?[legacy]:legacyError?[{name:'indexeddb',keys:async()=>{throw legacyError;}}]:[])];
    const result=await transferRecords({areas,call:native.call,onProgress:progress=>status.textContent=`正在迁出：${progress.key}\n${progress.stage==='moved'?'本机副本已核对，Chrome 旧记录已移除。':'保存并核对中，请保持窗口打开。'}`});
    status.textContent=`已迁出并移除 ${result.moved} 条旧记录。${result.changed?` ${result.changed} 条在迁移时变化，保留 Chrome 原记录。`:''}\n${result.directory?'本机目录：'+result.directory:'没有可迁出的旧记录。'}${result.failed.length?'\n以下记录保留在 Chrome，尚未迁完：\n'+result.failed.map(x=>(x.key||x.area)+'：'+x.error).join('\n'):''}`;
  }catch(error){status.textContent='尚未完成迁出：'+error.message+'\n未获本机核对确认的 Chrome 旧记录保留。';}
  finally{button.disabled=false;try{legacy?.close();}catch{}try{native?.close();}catch{}}
};
