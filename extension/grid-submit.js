// Runs in Chrome's isolated world. The logged-in browser sends its own session cookie.
export async function gridJudgeRequest(problemUrl,mode,params={}){
  let phase='核对题目地址',requestStarted=false,receivedRaw='';
  try{
  const origin='https://programming.pku.edu.cn';
  const current=new URL(location.href),problem=new URL(problemUrl);
  const match=path=>path.match(/^\/(?:course\/)?probset\/([a-f0-9]{32})\/([a-f0-9]{32})\/ide\.do$/i);
  const a=match(current.pathname),b=match(problem.pathname);
  if(current.origin!==origin||problem.origin!==origin||!a||!b||a[1]!==b[1]||a[2]!==b[2]||problem.search||problem.hash)throw new Error('浏览器已切换题目，停止提交。');
  const endpoint=new URL('submit.do',problem);
  const read=async(url,options={})=>{
    let response;
    try{response=await fetch(url,{credentials:'same-origin',redirect:'follow',signal:AbortSignal.timeout(12000),...options});}
    catch(error){if(error.name==='TimeoutError')throw new Error('编程网格接口 12 秒未回应；本次是否执行尚未确认，请先核对网站记录。');throw error;}
    const raw=await response.text();
    receivedRaw=raw;
    if(new URL(response.url).origin!==origin||response.url.includes('/login')||!response.ok)return {error:'编程网格未返回已登录的评测接口（HTTP '+response.status+'）；请检查登录状态。',raw};
    const value=(()=>{try{return JSON.parse(raw);}catch{return null;}})();
    if(!value||typeof value!=='object')return {error:'编程网格返回了非 JSON 内容，原文已保留。',raw};
    if(value.status!=='OK'||value.type!=='solution'||!value.solution||value.solution.id==null)return {error:String(value.text||'编程网格未确认执行。'),raw};
    return {solution:value.solution,raw};
  };
  const statusMap={Passed:'AC',Accepted:'AC',WrongAnswer:'WA','Wrong Answer':'WA',CompileError:'CE','Compile Error':'CE',RuntimeError:'RE','Runtime Error':'RE',TimeOut:'TLE','Time Limit Exceeded':'TLE',OutOfMemory:'MLE','Memory Limit Exceeded':'MLE',OutputExceeded:'OLE','Output Limit Exceeded':'OLE',EmptyOutput:'WA',Processing:'pending',Testing:'tested',Pending:'pending',WaitTimeOut:'system_error',SystemError:'system_error',NoProblem:'system_error',NoTestData:'system_error'};
  const validId=value=>/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value);
  const readDetail=async id=>{
    const url=`${origin}/solution/${id}/`;
    const response=await fetch(url,{method:'GET',credentials:'same-origin',redirect:'error',signal:AbortSignal.timeout(3500)});
    if(!response.ok||response.url!==url||!response.headers.get('content-type')?.includes('text/html'))throw new Error('提交详情页尚未准备好。');
    const html=await response.text();if(html.length>1000000)throw new Error('提交详情页过大。');
    const doc=new DOMParser().parseFromString(html,'text/html');
    if(doc.querySelector('input[type="password"]')||/登录|login/i.test(doc.title||'')&&!doc.querySelector('pre'))throw new Error('提交详情页要求登录。');
    const candidates=[...doc.querySelectorAll('h1,h2,h3,h4,strong,b,span,div')].map(el=>el.textContent.trim()).filter(text=>text.length<40&&statusMap[text]);
    const result=candidates.find(text=>!['pending','unknown'].includes(statusMap[text]))||candidates[0]||'';
    const marker=[...doc.querySelectorAll('h1,h2,h3,h4,h5,dt,strong,b,span,div')].find(el=>el.textContent.trim()==='提示信息'&&(!el.children.length||el.children.length===1));
    const pre=marker?[...doc.querySelectorAll('pre')].find(el=>Boolean(marker.compareDocumentPosition(el)&4)):null;
    const hint=pre?.textContent.replace(/\r\n|\r/g,'\n').slice(0,20000)||'';
    if(!result&&!hint)throw new Error('提交详情页尚未显示可识别的评测。');
    return {result,hint};
  };
  let solution,id,websiteReplyRaw,detail,detailChecked=false,detailError='';
  if(mode==='submit'||mode==='test'){
    if(params.requestExpiresAt&&params.requestExpiresAt<=Date.now())throw new Error('请求已超时，本次没有发送到网站。');
    if(typeof params.code!=='string'||params.code.length<5||params.code.length>100000)throw new Error('当前代码长度无效。');
    if(params.language!=='C++')throw new Error('目前只支持编程网格的 C++ 编译器。');
    const form=new URLSearchParams({programLanguage:params.language,sourceCode:params.code,type:'json'});
    // The site's own testCode() posts the same form with stdin present; submitCode() omits it.
    if(mode==='test'){
      if(typeof params.input!=='string'||params.input.length>20000)throw new Error('网站测试输入无效或超过 20000 字。');
      form.set('stdin',params.input);
    }
    phase='调用编程网格执行接口';requestStarted=true;
    const reply=await read(endpoint.href,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded; charset=UTF-8','Accept':'application/json','X-Requested-With':'XMLHttpRequest'},body:form});
    if(reply.error)return {error:reply.error,websiteReplyRaw:reply.raw};
    solution=reply.solution;websiteReplyRaw=reply.raw;
    phase='读取网站返回的执行编号';
    id=String(solution.id);
    if(!validId(id))throw new Error('编程网格返回的测试或提交编号格式无法识别，网站原文已保留。');
  }else if(mode==='refresh'){
    phase='查询本次网站评测';
    id=String(params.receipt?.solutionId||'');
    if(!validId(id))throw new Error('缺少有效的本次提交编号，不能猜测评测结果。');
    let statusResult;
    const statusTask=read(`${origin}/solution/${id}/status.do`,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded; charset=UTF-8','Accept':'application/json','X-Requested-With':'XMLHttpRequest'},body:new URLSearchParams()})
      .then(value=>(statusResult={status:'fulfilled',value}),reason=>(statusResult={status:'rejected',reason}));
    const detailResult=await readDetail(id).then(value=>({status:'fulfilled',value}),reason=>({status:'rejected',reason}));
    detailChecked=true;
    if(detailResult.status==='fulfilled')detail=detailResult.value;else detailError=String(detailResult.reason?.message||'提交详情暂不可读');
    // A finished detail page must not wait for a slower status endpoint.
    if(!detail)statusResult=await statusTask;
    if(statusResult?.status==='fulfilled'&&!statusResult.value.error){solution=statusResult.value.solution;websiteReplyRaw=statusResult.value.raw;if(String(solution.id)!==id)throw new Error('评测编号与本次提交不一致。');}
    else if(detail){solution={id,result:detail.result,hint:detail.hint};websiteReplyRaw=statusResult?.status==='fulfilled'?statusResult.value.raw:'';}
    else throw statusResult.status==='rejected'?statusResult.reason:new Error(statusResult.value.error);
  }else throw new Error('不支持的网站执行方式。');
  const hint=(typeof solution.hint==='string'?solution.hint:'')||detail?.hint||'';
  const result=detail?.result&&statusMap[detail.result]&&!['pending','unknown'].includes(statusMap[detail.result])?detail.result:solution.result;
  const testResult=result==='Testing'?hint.match(/^Result:\s*([^\r\n]+)/m)?.[1]?.trim():null;
  const verdict={status:statusMap[testResult]||statusMap[result]||'unknown',text:[result,hint.slice(0,1500)].filter(Boolean).join(' · ').slice(0,2000)};
  const receipt={solutionId:id,solutionUrl:`${origin}/solution/${id}/`};
  return {receipt,submission:{problemMatches:true,problemUrl:problem.href,submissionId:id,url:receipt.solutionUrl,submittedCode:params.code,sourceTruncated:false,verdict,platformResult:String(result||'unknown'),websiteReplyRaw,detailLoaded:Boolean(detail),detailChecked,detailError,runtime:{text:hint,error:verdict.status==='CE'?hint:''},observedAt:new Date().toISOString()},message:verdict.text};
  }catch(error){
    // Chrome may omit InjectionResult.result for a rejected injected Promise.
    // Return a serializable value so the original failure reaches VS Code.
    return {error:phase+'：'+String(error?.message||error),uncertain:requestStarted,websiteReplyRaw:receivedRaw,failure:{phase,name:String(error?.name||'Error')}};
  }
}
