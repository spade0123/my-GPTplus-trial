import {readOpenJudgePage} from './openjudge-extract.js';
import {inspectSubmitForm,officialJudgeRequest} from './openjudge-submit.js';
import {navigateProblemTab,closeAcceptedSubmitTab} from './openjudge-tabs.js';
const patterns=['http://bailian.openjudge.cn/*','https://bailian.openjudge.cn/*','http://noi.openjudge.cn/*','https://noi.openjudge.cn/*'];
let port,bridgeReady=false,noticeSequence=0,noticeTimer;
const sentSubmissions=new Map();
const latestSubmissionByTab=new Map();
function info(value){try{const u=new URL(value);if(!['http:','https:'].includes(u.protocol)||!['bailian.openjudge.cn','noi.openjudge.cn'].includes(u.hostname)||u.port||u.username||u.password||u.search||u.hash)return null;const m=u.pathname.match(/^\/([\w-]+)\/(\d+\/(?:submit\/)?|solution\/\d+\/|status\/)$/);if(!m)return null;return {url:u.href,host:u.hostname,group:m[1],kind:m[2].startsWith('solution/')?'solution':m[2]==='status/'?'status':m[2].endsWith('submit/')?'submit':'problem',key:u.hostname+u.pathname};}catch{return null;}}
async function read(tab,target,expected){
  const before=await chrome.tabs.get(tab.id);if(before.url!==tab.url)throw new Error('读取时标签页已切换题目，请重试。');
  const [result]=await chrome.scripting.executeScript({target:{tabId:tab.id},world:'ISOLATED',func:readOpenJudgePage,args:[target,expected]});
  const after=await chrome.tabs.get(tab.id);if(after.url!==before.url)throw new Error('读取时标签页发生导航，本次未保存。');
  if(!result?.result?.problemMatches)throw new Error('未取得与本题对应的网页信息。');return result.result;
}
export async function handleBrowserRequest(request){
  const tabs=(await chrome.tabs.query({url:patterns})).filter(t=>info(t.url));
  if(request.action==='tabs')return tabs.map(t=>({id:t.id,windowId:t.windowId,url:t.url,title:t.title,kind:info(t.url).kind,active:t.active}));
  if(request.action==='navigate_problem')return navigateProblemTab(chrome,request.params||{},tabs);
  if(request.action==='close_submission_tab'){
    const params=request.params||{},result=await closeAcceptedSubmitTab(chrome,params,latestSubmissionByTab.get(params.tabId));
    if(result.returnToTabId!==undefined)await publishCurrentProblem(result.returnToTabId);return result;
  }
  if(['prepare_submit','submit','refresh_submission'].includes(request.action)){
    const params=request.params||{},expected=info(params.problemUrl);if(expected?.kind!=='problem')throw new Error('题号无效。');
    let tab=tabs.find(t=>t.url===expected.url+'submit/');
    if(!tab&&request.action==='prepare_submit'){
      tab=await chrome.tabs.create({url:expected.url+'submit/',active:false});
      for(let i=0;i<60;i++){tab=await chrome.tabs.get(tab.id);if(tab.status==='complete')break;await new Promise(r=>setTimeout(r,100));}
    }
    if(request.action==='prepare_submit'){
      if(!tab)throw new Error('请打开本题提交页面。');const [r]=await chrome.scripting.executeScript({target:{tabId:tab.id},world:'ISOLATED',func:inspectSubmitForm,args:[expected.url]});
      if(!r?.result)throw new Error('提交页未返回可核对的信息，请检查登录状态。');return {...r.result,tabId:tab.id};
    }
    if(!tab)tab=tabs.find(t=>info(t.url)?.host===expected.host&&info(t.url)?.group===expected.group);
    if(!tab)throw new Error('请保持当前题集的 Chrome 标签打开。');
    const execute=async()=>{
      const [r]=await chrome.scripting.executeScript({target:{tabId:tab.id},world:'ISOLATED',func:officialJudgeRequest,args:[expected.url,request.action==='submit'?'submit':'refresh',{...params,existingSolutionUrls:tabs.filter(t=>info(t.url)?.kind==='solution').map(t=>t.url)}]});
      const value=r?.result;if(!value)throw new Error('未确认 OJ 返回结果；请先查看提交记录，不会自动重试。');
      if(request.action==='submit')value.receipt={...value.receipt,submissionTabId:tab.id};
      if(value.error)return value;
      let submission=null;
      if(value.receipt?.solutionUrl){try{submission=await read(tab,value.receipt.solutionUrl,expected.url);}catch(e){value.message='已提交，评测详情尚未核对：'+e.message;}}
      if(!submission&&request.action==='refresh_submission'){
        const candidates=[];
        for(const candidate of tabs.filter(t=>info(t.url)?.kind==='solution'&&info(t.url)?.host===expected.host&&info(t.url)?.group===expected.group&&t.active&&!value.receipt?.before?.includes(t.url)))try{const page=await read(candidate,candidate.url,expected.url);if(page.submittedCode?.replace(/\r\n/g,'\n').trim()===params.code?.replace(/\r\n/g,'\n').trim())candidates.push(page);}catch{}
        if(candidates.length===1){submission=candidates[0];value.receipt.solutionUrl=submission.url;}
      }
      return {...value,submission};
    };
    if(request.action==='submit'){
      if(!/^[a-f0-9]{64}$/.test(params.jobId||''))throw new Error('提交事件编号无效。');
      if(!sentSubmissions.has(params.jobId)){latestSubmissionByTab.set(tab.id,params.jobId);sentSubmissions.set(params.jobId,execute());}
      return sentSubmissions.get(params.jobId);
    }
    return execute();
  }
  if(request.action==='inspect_submit'){
    const expected=info(request.params?.problemUrl);if(expected?.kind!=='problem')throw new Error('题号无效。');
    const tab=tabs.find(t=>t.url===expected.url+'submit/');if(!tab)throw new Error('请先在 Chrome 打开本题的提交代码页面。');
    const [result]=await chrome.scripting.executeScript({target:{tabId:tab.id},world:'ISOLATED',func:inspectSubmitForm,args:[expected.url]});return {...result.result,tabId:tab.id};
  }
  if(request.action!=='capture')throw new Error('不支持的读取操作。');
  const p=request.params||{},expected=info(p.problemUrl),tab=tabs.find(t=>t.id===p.tabId),current=info(tab?.url);
  if(!expected||expected.kind!=='problem'||!tab||!current)throw new Error('关联的 OpenJudge 题目标签已关闭，请重新关联。');
  if(current.host!==expected.host||current.group!==expected.group||['problem','submit'].includes(current.kind)&&current.key.replace(/submit\/$/,'')!==expected.key)throw Object.assign(new Error('关联标签已经切换到另一题，请在 VS Code 重新关联，避免混存。'),{code:'PROBLEM_CHANGED'});
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
  port.onDisconnect.addListener(()=>{port=null;bridgeReady=false;chrome.action.setBadgeText({text:'!'}).catch(()=>{});chrome.action.setTitle({title:'连接已断开：点击重新连接 VS Code'}).catch(()=>{});});
  port.onMessage.addListener(async message=>{
    if(message.type==='bridge_ready'){bridgeReady=true;await chrome.action.setBadgeText({text:'ON'});await chrome.action.setTitle({title:'OpenJudge · VS Code 连接已就绪'});await publishCurrentProblem();return;}
    if(message.type==='bridge_error'){await chrome.action.setBadgeText({text:'!'});await chrome.action.setTitle({title:message.error||'连接尚未就绪'});return;}
    if(message.type!=='browser_request')return;
    const reply={type:'browser_reply',id:message.id};
    try{reply.value=await handleBrowserRequest(message);}catch(e){reply.error=e.message;reply.code=e.code;}
    try{port?.postMessage(reply);}catch{}
  });
  port.postMessage({type:'bridge_open'});
}
// Browser navigation events update only our own disk mailbox and VS Code view.
// No page observer, website storage, source capture or model request is added.
async function publishCurrentProblem(tabId){
  if(!port){connect();return;}if(!bridgeReady)return;
  let tab;try{
    tab=Number.isInteger(tabId)?await chrome.tabs.get(tabId):(await chrome.tabs.query({url:patterns})).filter(t=>['problem','submit'].includes(info(t.url)?.kind)).sort((a,b)=>Number(b.active)-Number(a.active)||(b.lastAccessed||0)-(a.lastAccessed||0))[0];
  }catch{return;}
  const selected=info(tab?.url);if(!['problem','submit'].includes(selected?.kind))return;
  const target=tab.url.replace(/submit\/$/,''),sequence=++noticeSequence,base={type:'problem_notice',sequence,tabId:tab.id,url:target};
  if(tab.status==='loading'){port?.postMessage({...base,status:'loading'});return;}
  try{
    const page=await read(tab,target,target);if(sequence!==noticeSequence)return;
    port?.postMessage({...base,status:'ready',page:{problemMatches:page.problemMatches,problemUrl:page.problemUrl,title:page.title,problem:page.problem,missingSections:page.missingSections}});
  }catch(e){if(sequence===noticeSequence)try{port?.postMessage({...base,status:'error',error:String(e.message).slice(0,1000)});}catch{}}
}
async function scheduleProblem(tabId){
  try{const tab=await chrome.tabs.get(tabId);if(!tab.active||!['problem','submit'].includes(info(tab.url)?.kind))return;}catch{return;}
  clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>{void publishCurrentProblem(tabId);},120);
}
chrome.tabs.onUpdated.addListener((tabId,change,tab)=>{if(['problem','submit'].includes(info(tab.url)?.kind)&&(change.status==='complete'||change.status==='loading'||change.url))scheduleProblem(tabId);});
chrome.tabs.onActivated.addListener(({tabId})=>scheduleProblem(tabId));
chrome.action.onClicked.addListener(connect);
chrome.runtime.onStartup.addListener(connect);
chrome.runtime.onInstalled.addListener(connect);
