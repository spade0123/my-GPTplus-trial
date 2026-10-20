import {createSidepanelController,validIdeUrl} from './sidepanel-controller.js';
const controller=createSidepanelController(chrome),sessions=new Map();
// Reset the legacy 1.7.0 toolbar behavior in Chrome's own extension settings.
// There is no side_panel page registered and this module never opens one.
chrome.sidePanel.setPanelBehavior({openPanelOnActionClick:false}).catch(()=>{});
const send=(port,msg)=>{try{port.postMessage(msg);}catch{}};
function dispatch(session,message){
  controller.bindTab(session.source);
  const proxy={postMessage:reply=>{
    if(session.ui)send(session.ui,reply);
    else{session.pending.push(reply);if(session.pending.length>8)session.pending.shift();}
  }};
  return controller.handle(proxy,{...message,windowId:session.source.windowId});
}
chrome.runtime.onConnect.addListener(port=>{
  if(port.name==='pku-coach-floating'&&port.sender?.frameId===0&&Number.isInteger(port.sender.tab?.id)&&validIdeUrl(port.sender.url)){
    const source={id:port.sender.tab.id,windowId:port.sender.tab.windowId};
    let ownedSession;
    port.onMessage.addListener(async msg=>{
      try{
        if(msg.type==='quick_save'){
          controller.bindTab(source);await controller.handle(port,{type:'quick_save',actionId:msg.actionId,requestedAt:msg.requestedAt,windowId:source.windowId});return;
        }
        if(!['open_hint','open_discussion'].includes(msg.type))throw new Error('不支持的按钮操作。');
        const mode=msg.type==='open_hint'?'hint':'discussion';
        let session=ownedSession;
        if(!session){
          const token=crypto.randomUUID();session={token,mode,source,pending:[]};sessions.set(token,session);ownedSession=session;
        }
        session.mode=mode;
        // Reopen the existing conversation, then refresh read-only context and
        // disk history in its own frame. Opening never queues a replacement.
        if(session.ui)send(session.ui,{type:'resume_context',mode});
        send(port,{type:'tool_opened',actionId:msg.actionId,mode,frameUrl:chrome.runtime.getURL('assist-window.html')+'?session='+encodeURIComponent(session.token)});
      }catch(error){send(port,{type:'error',actionId:msg.actionId,error:error.message});}
    });
    port.onDisconnect.addListener(()=>{if(ownedSession){sessions.delete(ownedSession.token);ownedSession.connection?.disconnect();}});return;
  }
  let url;try{url=new URL(port.sender?.url);}catch{}
  const own=new URL(chrome.runtime.getURL('assist-window.html'));
  const session=url?.protocol===own.protocol&&url.host===own.host&&url.pathname===own.pathname?sessions.get(url.searchParams.get('session')):null;
  if(port.name!=='pku-coach-assist'||!session||port.sender.tab?.id!==session.source.id||port.sender.tab?.windowId!==session.source.windowId||!Number.isInteger(port.sender.frameId)||port.sender.frameId<=0||session.connection){port.disconnect();return;}
  session.connection=port;
  let ready=false;
  port.onMessage.addListener(msg=>{
    if(msg.type==='resume'){
      if(ready)return;ready=true;session.ui=port;send(port,{type:'resume_context',mode:session.mode});
      for(const reply of session.pending)send(port,reply);session.pending=[];return;
    }
    if(ready)dispatch(session,msg);
  });
  port.onDisconnect.addListener(()=>{if(session.ui===port)session.ui=null;if(session.connection===port)session.connection=null;});
});
// Reinsert only our three controls if this tab was already open during upgrade.
chrome.action.onClicked.addListener(tab=>{
  if(validIdeUrl(tab.url))chrome.scripting.executeScript({target:{tabId:tab.id},world:'ISOLATED',files:['floating-buttons.js']}).catch(()=>{});
});
