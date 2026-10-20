function problemAddress(value){
  const u=new URL(value);if(!['http:','https:'].includes(u.protocol)||!['bailian.openjudge.cn','noi.openjudge.cn'].includes(u.hostname)||u.port||u.username||u.password||u.search||u.hash||!/^\/[\w-]+\/\d+\/$/.test(u.pathname))throw new Error('题目地址无效。');return u;
}
export async function navigateProblemTab(api,params,tabs){
  const target=problemAddress(params.problemUrl);let tab=tabs.find(t=>t.id===params.tabId);
  if(tab)try{tab=await api.tabs.get(tab.id);problemAddress(tab.url);}catch{tab=null;}
  // Only an existing statement tab can be reused. Submission forms stay open.
  if(!tab){const candidate=tabs.find(t=>{try{problemAddress(t.url);return t.active;}catch{return false;}});if(candidate)try{tab=await api.tabs.get(candidate.id);problemAddress(tab.url);}catch{tab=null;}}
  const result=tab?await api.tabs.update(tab.id,{url:target.href,active:true}):await api.tabs.create({url:target.href,active:true});
  return {tabId:result.id,url:target.href};
}
export function matchesSubmittedSource(submitUrl,code){
  if(location.href!==submitUrl)return false;const sources=[...document.querySelectorAll('textarea[name="source"]')];
  return sources.length===1&&sources[0].value.replace(/\r\n/g,'\n')===code.replace(/\r\n/g,'\n');
}
export async function closeAcceptedSubmitTab(api,params,latestJobId){
  const target=problemAddress(params.problemUrl),submitUrl=target.href+'submit/';
  if(!Number.isInteger(params.tabId)||!/^[a-f0-9]{64}$/.test(params.jobId||'')||params.verdict!=='AC'||typeof params.code!=='string'||params.code.length<5||params.code.length>100000)throw new Error('关闭提交页的证据无效。');
  if(latestJobId&&latestJobId!==params.jobId)return {closed:false,reason:'newer_submission'};
  let tab;try{tab=await api.tabs.get(params.tabId);}catch{return {closed:true,alreadyClosed:true};}
  if(tab.url!==submitUrl)return {closed:false,reason:'tab_changed'};
  const [match]=await api.scripting.executeScript({target:{tabId:tab.id},world:'ISOLATED',func:matchesSubmittedSource,args:[submitUrl,params.code]});
  if(match?.result!==true)return {closed:false,reason:'source_changed'};
  tab=await api.tabs.get(tab.id);if(tab.url!==submitUrl)return {closed:false,reason:'tab_changed'};
  let returnToTabId;
  if(tab.active){
    const tabs=await api.tabs.query({url:target.origin+'/*'});let parent=tabs.find(t=>t.id!==tab.id&&t.url===target.href);
    if(!parent)parent=await api.tabs.create({url:target.href,active:false});
    await api.tabs.update(parent.id,{active:true});returnToTabId=parent.id;
  }
  await api.tabs.remove(tab.id);return {closed:true,...(returnToTabId===undefined?{}:{returnToTabId})};
}
