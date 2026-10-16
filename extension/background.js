import {extractPage} from './extract.js';
import {installSubmissionObserver} from './submission-observer.js';
const validUrl=s=>{try{const u=new URL(s);return u.origin==='https://programming.pku.edu.cn'&&/^\/probset\/[a-f0-9]{32}\/[a-f0-9]{32}\/ide\.do$/.test(u.pathname);}catch{return false;}};
let native=null;
const requests=new Map();
const submissions=new Map();
const preparing=new Map();
const send=(port,message)=>{try{port.postMessage(message);}catch{}};
function nativeRequest(port,message) {
  if(!native) {
    native=chrome.runtime.connectNative('edu.pku.cpp_coach');
    native.onMessage.addListener(reply=>{
      const target=requests.get(reply.requestId);
      if(target){send(target.port,reply);target.resolve(reply);requests.delete(reply.requestId);}
    });
    native.onDisconnect.addListener(()=>{
      const error=chrome.runtime.lastError?.message;native=null;
      for(const [requestId,target] of requests){const reply={type:'error',requestId,requestType:target.type,error:`本机连接中断：${error||'请刷新页面重试'}。已保存的后台报告仍会继续处理。`};send(target.port,reply);target.resolve(reply);}
      requests.clear();
    });
  }
  const requestId=crypto.randomUUID();
  return new Promise(resolve=>{requests.set(requestId,{port,type:message.type,resolve});native.postMessage({...message,requestId});});
}
chrome.runtime.onConnect.addListener(port=>{
  if(port.name!=='pku-coach'||!port.sender?.tab?.id||!validUrl(port.sender.url)) {port.disconnect();return;}
  const tabId=port.sender.tab.id;
  if(chrome.scripting?.executeScript)Promise.resolve(chrome.storage?.local?.get(['preferredSource'])||{}).then(settings=>chrome.scripting.executeScript({target:{tabId},world:'MAIN',func:installSubmissionObserver,args:[settings.preferredSource||'']})).catch(()=>{});
  port.onDisconnect.addListener(()=>{for(const [id,target] of requests)if(target.port===port){target.resolve({type:'error',error:'页面已断开连接'});requests.delete(id);}});
  port.onMessage.addListener(async message=>{
    try {
      const tab=await chrome.tabs.get(tabId);if(!validUrl(tab.url))throw new Error('请回到北大题目 IDE 页面。');
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
      }else if(['recent','problem'].includes(message.type))await nativeRequest(port,{type:message.type,url:new URL(tab.url).origin+new URL(tab.url).pathname});
      else if(message.type==='retry_archive'&&/^[-a-f0-9]{36}$/i.test(message.archiveId||''))await nativeRequest(port,{type:'retry_archive',url:new URL(tab.url).origin+new URL(tab.url).pathname,archiveId:message.archiveId});
      else if(['review','retry'].includes(message.type)&&/^[a-f0-9]{64}$/.test(message.id))await nativeRequest(port,{type:message.type,id:message.id});
    }catch(e){send(port,{type:'error',requestType:message.type,error:e.message});}
  });
});
