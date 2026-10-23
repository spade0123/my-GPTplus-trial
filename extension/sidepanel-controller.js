import {extractPage} from './extract.js';
import {selectActionCapture,readCurrentJudgment} from './capture-actions.js';

export const validIdeUrl=value=>{
  try{const u=new URL(value);return u.origin==='https://programming.pku.edu.cn'&&!u.username&&!u.password&&/^\/probset\/[a-f0-9]{32}\/[a-f0-9]{32}\/ide\.do$/.test(u.pathname);}catch{return false;}
};

// This is the complete page-access boundary. Only these two fixed, read-only
// functions can run; no caller-provided scripts, page messages, or automatic reads.
export function createSidepanelController(api,{connectNative=()=>api.runtime.connectNative('edu.pku.cpp_coach')}={}){
  let native;
  const pending=new Map(),bindings=new Map();
  function bindTab(tab){
    if(Number.isInteger(tab?.id)&&Number.isInteger(tab?.windowId))bindings.set(tab.windowId,{tabId:tab.id,windowId:tab.windowId});
  }
  const send=(port,msg)=>{try{port.postMessage(msg);}catch{}};
  function nativeRequest(port,msg){
    if(new TextEncoder().encode(JSON.stringify(msg)).length>290000)throw new Error('本次题面与代码过长，未发送；请使用 Codex 的本机文件分析。');
    if(!native){
      native=connectNative();
      native.onMessage.addListener(reply=>{
        const item=pending.get(reply.requestId);if(!item)return;
        clearTimeout(item.timer);pending.delete(reply.requestId);send(item.port,reply);
      });
      native.onDisconnect.addListener(()=>{
        const error=api.runtime.lastError?.message||'请重新打开侧栏后重试';native=null;
        for(const [requestId,item]of pending){clearTimeout(item.timer);send(item.port,{type:'error',requestId,requestType:item.type,actionId:item.actionId,error:'本机连接中断，尚未确认本次操作：'+error});}
        pending.clear();
      });
    }
    const requestId=crypto.randomUUID();
    const timer=setTimeout(()=>{
      const item=pending.get(requestId);if(!item)return;pending.delete(requestId);
      send(port,{type:'error',requestType:msg.type,actionId:msg.actionId,error:'本机程序未及时确认；这不代表保存成功，请保留当前代码。'});
    },['model_settings','save_model_settings'].includes(msg.type)?60000:20000);
    pending.set(requestId,{port,type:msg.type,actionId:msg.actionId,timer});
    try{native.postMessage({...msg,requestId});}
    catch(error){clearTimeout(timer);pending.delete(requestId);throw error;}
  }
  async function currentTab(message){
    // A sidebar is not a popup: auto-opening it does not grant activeTab.
    // Use only the tab explicitly bound by the real toolbar action, in its own
    // window. Never guess from the browser's last-focused window.
    const binding=Number.isInteger(message.windowId)?bindings.get(message.windowId):bindings.size===1?[...bindings.values()][0]:null;
    if(!binding)throw new Error('请在题目页点击浏览器工具栏或拼图菜单中的“北大 C++ 学习教练”，完成本页授权。');
    let tab;
    try{tab=await api.tabs.get(binding.tabId);}catch{throw new Error('关联的题目标签已关闭，请在新题目页重新点击教练图标。');}
    const [active]=await api.tabs.query({active:true,windowId:binding.windowId});
    if(active?.id!==binding.tabId||!tab?.active)throw new Error('已切换题目标签。请在目标题目页再点击一次工具栏的教练图标。');
    if(!validIdeUrl(tab.url))throw new Error('当前授权标签不是可读取的编程网格 IDE，请在题目页点击教练图标。');
    return tab;
  }
  async function capture(tab,source){
    let result;
    try{[result]=await api.scripting.executeScript({target:{tabId:tab.id},world:'MAIN',func:extractPage});}
    catch{throw new Error('未取得当前页读取权限。请在题目页点击浏览器工具栏的学习教练图标，再使用按钮。');}
    const page=result?.result;
    const selected=selectActionCapture(page,tab.url,{preferredSource:source});
    const now=await api.tabs.get(tab.id);
    if(!now?.active||!validIdeUrl(now.url)||new URL(now.url).origin+new URL(now.url).pathname!==selected.capture.url)throw new Error('读取时已经切换题目，请回到目标题目重新点击。');
    return {...selected,page};
  }
  async function handle(port,msg){
    try{
      if(!['quick_save','hint','discuss','discussion_history','hint_history','assist_history','hint_status','model_settings','save_model_settings','versions','version_read'].includes(msg?.type))throw new Error('不支持的侧栏操作。');
      if(['model_settings','save_model_settings','versions','version_read'].includes(msg.type)){
        const tab=await currentTab(msg);
        if(['versions','version_read'].includes(msg.type)){
          const selected=await capture(tab,msg.source);
          if(msg.url!==selected.capture.url)throw new Error('题目已切换，请从当前题目的按钮重新打开。');
          if(msg.type==='version_read'&&(typeof msg.eventId!=='string'||msg.eventId.length>100))throw new Error('历史版本编号无效。');
          nativeRequest(port,{type:msg.type,url:selected.capture.url,eventId:msg.eventId,currentCode:selected.capture.code,actionId:msg.actionId});
        }else nativeRequest(port,{type:msg.type,settings:msg.settings,refresh:msg.refresh===true,actionId:msg.actionId});
        return;
      }
      if(msg.type==='hint_status'){
        if(!/^[a-f0-9]{64}$/.test(msg.id||''))throw new Error('无效的任务编号。');
        nativeRequest(port,{type:'hint_status',id:msg.id,actionId:msg.actionId});return;
      }
      if(msg.force!==undefined&&(msg.type!=='hint'||typeof msg.force!=='boolean'))throw new Error('无效的重新生成选项。');
      if(msg.type==='discuss'&&(typeof msg.question!=='string'||!msg.question.trim()||msg.question.length>2000))throw new Error('请输入 1—2000 字的问题。');
      if(msg.purpose!==undefined&&(msg.type!=='discuss'||!['discussion','solution'].includes(msg.purpose)))throw new Error('无效的问答用途。');
      const tab=await currentTab(msg);
      if(['discussion_history','hint_history','assist_history'].includes(msg.type)){
        const selected=await capture(tab,msg.source);
        send(port,{type:msg.type==='assist_history'?'assist_context':msg.type==='hint_history'?'hint_context':'discussion_context',actionId:msg.actionId,capture:selected.capture,missingSections:selected.page.missingSections||[]});
        nativeRequest(port,{type:msg.type,url:selected.capture.url,actionId:msg.actionId});return;
      }
      const selected=await capture(tab,msg.source);
      let judgeEvidence;
      if(msg.type==='hint'){
        const [judgment]=await api.scripting.executeScript({target:{tabId:tab.id},world:'MAIN',func:readCurrentJudgment,args:[selected.capture.code]});
        const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(selected.capture.code.replace(/\r\n/g,'\n').trim()));
        judgeEvidence={...judgment?.result,codeHash:[...new Uint8Array(hash)].map(n=>n.toString(16).padStart(2,'0')).join('')};
        const now=await api.tabs.get(tab.id);
        if(!now?.active||!validIdeUrl(now.url)||new URL(now.url).origin+new URL(now.url).pathname!==selected.capture.url)throw new Error('读取时已切换题目，请重新点击。');
      }
      send(port,{type:'action_preview',requestType:msg.type,actionId:msg.actionId,capture:selected.capture,selectedCode:selected.page.selectedCode||'',judgment:judgeEvidence,missingSections:selected.page.missingSections||[]});
      nativeRequest(port,{type:msg.type,capture:selected.capture,judgeEvidence,eventId:msg.actionId||crypto.randomUUID(),actionId:msg.actionId,question:msg.question?.trim(),purpose:msg.purpose,selectedCode:selected.page.selectedCode||'',requestedAt:msg.requestedAt,force:msg.force===true});
    }catch(error){send(port,{type:'error',requestType:msg?.type,actionId:msg?.actionId,error:error.message});}
  }
  function connect(port){
    if(port.name!=='pku-coach-sidepanel'||port.sender?.url!==api.runtime.getURL('sidepanel.html')){port.disconnect();return;}
    port.onMessage.addListener(msg=>{void handle(port,msg);});
    port.onDisconnect.addListener(()=>{
      // Disk work is independent of the sidebar lifetime; retain native requests
      // until their reply/timeout so closing a sidebar never cancels a save.
    });
  }
  return {connect,handle,bindTab};
}
