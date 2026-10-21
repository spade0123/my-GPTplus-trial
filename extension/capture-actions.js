// Build a frozen click-time capture. Never silently guess among editor buffers.
export function selectActionCapture(page,url,settings={}){
  if(!page||page.url!==new URL(url).origin+new URL(url).pathname)throw new Error('题目页面已改变，请重新点击。');
  const candidates=page.candidates||[];
  const chosen=candidates.find(c=>c.source===page.primarySource)||candidates.find(c=>c.source===settings.preferredSource)||(candidates.length===1?candidates[0]:null);
  if(!chosen)throw new Error(candidates.length?'发现多个编辑器，尚未确认代码来源。请在侧栏“使用范围”中填写自己的代码来源后重试。':'未能读取当前代码，请确认代码已经写入平台编辑器。');
  if(page.statementTruncated)throw new Error('题面读取被截断，请在 Codex 中提供完整题面和本机源码文件。');
  return {capture:{url:page.url,title:page.title,problem:page.problem,runtime:page.runtime,code:chosen.value,standard:['c++11','c++14','c++17','c++20'].includes(settings.standard)?settings.standard:'c++17'},source:chosen.source};
}

// Runs in MAIN. AC must be associated with the exact code, never just page text.
export function readCurrentJudgment(code){
  const normalize=s=>typeof s==='string'?s.replace(/\r\n/g,'\n').trim():null;
  const expected=normalize(code),url=location.origin+location.pathname;
  const saved=window.__pkuCoachSubmissionObserver?.lastJudgment;
  if(saved?.url===url&&normalize(saved.code)===expected&&saved.verdict?.status)return {status:saved.verdict.status,source:'matching-submission',runtimeAssociation:'uncertain'};
  const solution=window.solution;
  const problemId=location.pathname.match(/^\/(?:course\/)?probset\/[a-f0-9]{32}\/([a-f0-9]{32})\/ide\.do$/i)?.[1];
  if(solution&&String(solution.problemId)===problemId&&normalize(solution.sourceCode)===expected){
    const statuses={Passed:'AC',WrongAnswer:'WA',CompileError:'CE',RuntimeError:'RE',TimeOut:'TLE',OutOfMemory:'MLE',OutputExceeded:'OLE',EmptyOutput:'WA'};
    if(statuses[solution.result])return {status:statuses[solution.result],source:'site-solution',runtimeAssociation:'uncertain'};
  }
  return {status:'unknown',source:'none',runtimeAssociation:'uncertain'};
}
