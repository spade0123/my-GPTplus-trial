import {readOpenJudgePage} from './openjudge-extract.js';
const patterns=['http://bailian.openjudge.cn/*','https://bailian.openjudge.cn/*','http://noi.openjudge.cn/*','https://noi.openjudge.cn/*'];
let port;
function info(value){try{const u=new URL(value);if(!['http:','https:'].includes(u.protocol)||!['bailian.openjudge.cn','noi.openjudge.cn'].includes(u.hostname)||u.port||u.username||u.password||u.search||u.hash)return null;const m=u.pathname.match(/^\/([\w-]+)\/(\d+\/|solution\/\d+\/|status\/)$/);if(!m)return null;return {url:u.href,host:u.hostname,group:m[1],kind:m[2].startsWith('solution/')?'solution':m[2]==='status/'?'status':'problem',key:u.hostname+u.pathname};}catch{return null;}}
async function read(tab,target,expected){
  const before=await chrome.tabs.get(tab.id);if(before.url!==tab.url)throw new Error('读取时标签页已切换题目，请重试。');
  const [result]=await chrome.scripting.executeScript({target:{tabId:tab.id},world:'ISOLATED',func:readOpenJudgePage,args:[target,expected]});
  const after=await chrome.tabs.get(tab.id);if(after.url!==before.url)throw new Error('读取时标签页发生导航，本次未保存。');
  if(!result?.result?.problemMatches)throw new Error('未取得与本题对应的网页信息。');return result.result;
}
export async function handleBrowserRequest(request){
  const tabs=(await chrome.tabs.query({url:patterns})).filter(t=>info(t.url));
  if(request.action==='tabs')return tabs.map(t=>({id:t.id,windowId:t.windowId,url:t.url,title:t.title,kind:info(t.url).kind,active:t.active}));
  if(request.action!=='capture')throw new Error('不支持的读取操作。');
  const p=request.params||{},expected=info(p.problemUrl),tab=tabs.find(t=>t.id===p.tabId),current=info(tab?.url);
  if(!expected||expected.kind!=='problem'||!tab||!current)throw new Error('关联的 OpenJudge 题目标签已关闭，请重新关联。');
  if(current.host!==expected.host||current.group!==expected.group||current.kind==='problem'&&current.key!==expected.key)throw Object.assign(new Error('关联标签已经切换到另一题，请在 VS Code 重新关联，避免混存。'),{code:'PROBLEM_CHANGED'});
  let submission=null;
  if(current.kind==='solution')submission=await read(tab,tab.url,p.problemUrl);
  const problem=await read(tab,p.problemUrl,p.problemUrl);
  const explicit=tabs.find(t=>t.id===p.submissionTabId),candidate=explicit||tabs.find(t=>t.active&&info(t.url)?.kind==='solution'&&info(t.url).host===expected.host&&info(t.url).group===expected.group);
  if(candidate&&candidate.id!==tab.id){
    try{submission=await read(candidate,candidate.url,p.problemUrl);}catch(e){if(explicit)throw e;}
  }
  return {problem,submission};
}
function connect(){
  if(port)return;
  port=chrome.runtime.connectNative('edu.openjudge.cpp_coach');
  port.onDisconnect.addListener(()=>{port=null;chrome.action.setBadgeText({text:'!'}).catch(()=>{});chrome.action.setTitle({title:'连接已断开：点击重新连接 VS Code'}).catch(()=>{});});
  port.onMessage.addListener(async message=>{
    if(message.type==='bridge_ready'){await chrome.action.setBadgeText({text:'ON'});await chrome.action.setTitle({title:'OpenJudge · VS Code 连接已就绪'});return;}
    if(message.type==='bridge_error'){await chrome.action.setBadgeText({text:'!'});await chrome.action.setTitle({title:message.error||'连接尚未就绪'});return;}
    if(message.type!=='browser_request')return;
    const reply={type:'browser_reply',id:message.id};
    try{reply.value=await handleBrowserRequest(message);}catch(e){reply.error=e.message;reply.code=e.code;}
    try{port?.postMessage(reply);}catch{}
  });
  port.postMessage({type:'bridge_open'});
}
chrome.action.onClicked.addListener(connect);
chrome.runtime.onStartup.addListener(connect);
chrome.runtime.onInstalled.addListener(connect);
