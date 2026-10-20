import {extractPage} from './extract.js';
import {readCurrentJudgment} from './capture-actions.js';
import {gridJudgeRequest} from './grid-submit.js';

const patterns=['https://programming.pku.edu.cn/*'];
let port,ready=false,sequence=0,timer;
const sent=new Map();
function info(value){
  try{const u=new URL(value),m=u.pathname.match(/^\/(?:course\/)?probset\/([a-f0-9]{32})\/([a-f0-9]{32})\/ide\.do$/i);
    return u.origin==='https://programming.pku.edu.cn'&&!u.search&&!u.hash&&m?{url:u.href,key:`${m[1].toLowerCase()}/${m[2].toLowerCase()}`} :null;
  }catch{return null;}
}
async function page(tab,code){
  const before=await chrome.tabs.get(tab.id),expected=info(before.url);
  if(!expected)throw new Error('请打开编程网格具体题目的 IDE 页面。');
  const [r]=await chrome.scripting.executeScript({target:{tabId:tab.id},world:'MAIN',func:extractPage});
  const after=await chrome.tabs.get(tab.id);
  if(!info(after.url)||info(after.url).key!==expected.key)throw Object.assign(new Error('读取期间切换了题目。'),{code:'PROBLEM_CHANGED'});
  const value=r?.result;if(!value?.problem||!Object.values(value.problem).some(Boolean))throw new Error('没有读到题面，请确认已经登录并打开 IDE。');
  let submission=null;
  if(typeof code==='string'){
    const [j]=await chrome.scripting.executeScript({target:{tabId:tab.id},world:'MAIN',func:readCurrentJudgment,args:[code]});
    if(j?.result?.status&&j.result.status!=='unknown')submission={problemMatches:true,problemUrl:expected.url,submittedCode:code,sourceTruncated:false,submissionId:null,verdict:{status:j.result.status,text:'网页当前可见评测与源码相符'},runtime:{error:''}};
  }
  return {problem:{problemMatches:true,problemUrl:expected.url,title:value.title,problem:value.problem,missingSections:value.missingSections},submission};
}
async function handle(request){
  const tabs=(await chrome.tabs.query({url:patterns})).filter(t=>info(t.url));
  if(request.action==='tabs')return tabs.map(t=>({id:t.id,url:t.url,title:t.title,kind:'problem',active:t.active}));
  const p=request.params||{},expected=info(p.problemUrl),tab=tabs.find(t=>t.id===(p.tabId||p.receipt?.tabId))||tabs.find(t=>info(t.url)?.key===expected?.key);
  if(!expected||!tab||info(tab.url)?.key!==expected.key)throw Object.assign(new Error('题目 IDE 标签已关闭或切换，请重新关联。'),{code:'PROBLEM_CHANGED'});
  if(request.action==='capture')return page(tab,p.code);
  if(request.action==='prepare_submit'){
    await page(tab);
    const [r]=await chrome.scripting.executeScript({target:{tabId:tab.id},world:'ISOLATED',func:()=>{const button=document.querySelector('#btnSubmit');return Boolean(button&&!button.disabled&&button.getClientRects().length);}});
    if(!r?.result)throw new Error('本题 IDE 的提交按钮不可用；请在浏览器确认登录及题目开放状态。');
    return {languages:[{label:'C++',value:'C++',selected:true}],tabId:tab.id};
  }
  if(['submit','refresh_submission'].includes(request.action)){
    const invoke=async()=>{
      const before=await chrome.tabs.get(tab.id);
      const [result]=await chrome.scripting.executeScript({target:{tabId:tab.id},world:'ISOLATED',func:gridJudgeRequest,args:[expected.url,request.action==='submit'?'submit':'refresh',p]});
      const after=await chrome.tabs.get(tab.id);
      if(info(after.url)?.key!==info(before.url)?.key)throw new Error('提交期间浏览器切换了题目，请检查网站提交记录。');
      if(!result?.result)throw new Error('未确认网站返回，请检查提交记录，不会自动重试。');
      result.result.receipt.tabId=tab.id;
      return result.result;
    };
    if(request.action==='submit'){
      if(!/^[a-f0-9]{64}$/.test(p.jobId||''))throw new Error('提交事件编号无效。');
      if(!sent.has(p.jobId))sent.set(p.jobId,invoke());
      return sent.get(p.jobId);
    }
    return invoke();
  }
  throw new Error('不支持的浏览器操作。');
}
function connect(){
  if(port)return;
  port=chrome.runtime.connectNative('edu.pku.grid_vscode_coach');
  port.onDisconnect.addListener(()=>{port=null;ready=false;chrome.action.setBadgeText({text:'!'}).catch(()=>{});});
  port.onMessage.addListener(async message=>{
    if(message.type==='bridge_ready'){ready=true;await chrome.action.setBadgeText({text:'ON'});await publish();return;}
    if(message.type==='bridge_error'){await chrome.action.setBadgeText({text:'!'});return;}
    if(message.type!=='browser_request')return;
    const reply={type:'browser_reply',id:message.id};try{reply.value=await handle(message);}catch(e){reply.error=e.message;reply.code=e.code;}
    try{port?.postMessage(reply);}catch{}
  });
  port.postMessage({type:'bridge_open'});
}
async function publish(tabId){
  if(!port){connect();return;}if(!ready)return;
  const tabs=(await chrome.tabs.query({url:patterns})).filter(t=>info(t.url));
  const tab=Number.isInteger(tabId)?tabs.find(t=>t.id===tabId):tabs.sort((a,b)=>Number(b.active)-Number(a.active)||(b.lastAccessed||0)-(a.lastAccessed||0))[0];
  if(!tab)return;
  const current=info(tab.url),n=++sequence,base={type:'problem_notice',sequence:n,tabId:tab.id,url:current.url};
  if(tab.status==='loading'){port.postMessage({...base,status:'loading'});return;}
  let error;
  for(let attempt=0;attempt<8&&n===sequence;attempt++){
    try{const result=await page(tab);if(n===sequence)port?.postMessage({...base,status:'ready',page:result.problem});return;}
    catch(e){error=e;await new Promise(resolve=>setTimeout(resolve,500));}
  }
  if(n===sequence)port?.postMessage({...base,status:'error',error:String(error?.message||'题面读取失败').slice(0,1000)});
}
chrome.tabs.onUpdated.addListener((id,change,tab)=>{if(info(tab.url)&&(change.status||change.url)){clearTimeout(timer);timer=setTimeout(()=>void publish(id),120);}});
chrome.tabs.onActivated.addListener(({tabId})=>void publish(tabId));
chrome.action.onClicked.addListener(connect);
chrome.runtime.onStartup.addListener(connect);
chrome.runtime.onInstalled.addListener(connect);
