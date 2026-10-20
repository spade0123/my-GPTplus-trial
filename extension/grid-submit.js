// Runs in Chrome's isolated world. The logged-in browser sends its own session cookie.
export async function gridJudgeRequest(problemUrl,mode,params={}){
  const origin='https://programming.pku.edu.cn';
  const current=new URL(location.href),problem=new URL(problemUrl);
  const match=path=>path.match(/^\/(?:course\/)?probset\/([a-f0-9]{32})\/([a-f0-9]{32})\/ide\.do$/i);
  const a=match(current.pathname),b=match(problem.pathname);
  if(current.origin!==origin||problem.origin!==origin||!a||!b||a[1]!==b[1]||a[2]!==b[2]||problem.search||problem.hash)throw new Error('浏览器已切换题目，停止提交。');
  const endpoint=new URL('submit.do',problem);
  const read=async(url,options={})=>{
    const response=await fetch(url,{credentials:'same-origin',redirect:'follow',...options});
    if(new URL(response.url).origin!==origin||response.url.includes('/login')||!response.ok)throw new Error('编程网格未返回已登录的评测接口；请检查登录状态。');
    const value=await response.json().catch(()=>null);
    if(!value||typeof value!=='object')throw new Error('编程网格返回格式无法识别，可能需要重新登录。');
    if(value.status!=='OK'||value.type!=='solution'||!value.solution||value.solution.id==null)throw new Error(String(value.text||'编程网格未确认提交。').slice(0,500));
    return value.solution;
  };
  const statusMap={Passed:'AC',WrongAnswer:'WA',CompileError:'CE',RuntimeError:'RE',TimeOut:'TLE',OutOfMemory:'MLE',OutputExceeded:'OLE',EmptyOutput:'WA',Processing:'pending',Testing:'pending',WaitTimeOut:'system_error',SystemError:'system_error',NoProblem:'system_error',NoTestData:'system_error'};
  let solution,id;
  if(mode==='submit'){
    if(typeof params.code!=='string'||params.code.length<5||params.code.length>100000)throw new Error('当前代码长度无效。');
    if(params.language!=='C++')throw new Error('目前只支持编程网格的 C++ 编译器。');
    const form=new URLSearchParams({programLanguage:params.language,sourceCode:params.code,type:'json'});
    solution=await read(endpoint.href,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded; charset=UTF-8','Accept':'application/json','X-Requested-With':'XMLHttpRequest'},body:form});
    id=String(solution.id);
  }else{
    id=String(params.receipt?.solutionId||'');
    if(!/^\d+$/.test(id))throw new Error('缺少本次提交编号，不能猜测评测结果。');
    solution=await read(`${origin}/solution/${id}/status.do`,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded; charset=UTF-8','Accept':'application/json','X-Requested-With':'XMLHttpRequest'},body:new URLSearchParams()});
    if(String(solution.id)!==id)throw new Error('评测编号与本次提交不一致。');
  }
  const verdict={status:statusMap[solution.result]||'unknown',text:[solution.result,solution.hint].filter(Boolean).join(' · ').slice(0,2000)};
  const receipt={solutionId:id,solutionUrl:`${origin}/solution/${id}/`};
  return {receipt,submission:{problemMatches:true,problemUrl:problem.href,submissionId:id,url:receipt.solutionUrl,submittedCode:params.code,sourceTruncated:false,verdict,runtime:{error:''},observedAt:new Date().toISOString()},message:verdict.text};
}
