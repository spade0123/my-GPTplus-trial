// Reads official form metadata only. It never reads passwords or login cookies.
export function inspectSubmitForm(problemUrl){
  try{
  const expected=new URL(problemUrl),current=new URL(location.href);
  if(!['http:','https:'].includes(expected.protocol)||!['bailian.openjudge.cn','noi.openjudge.cn'].includes(expected.hostname)||expected.origin!==current.origin||current.pathname!==expected.pathname+'submit/')throw new Error('请在 Chrome 打开当前题目的官方提交代码页面。');
  if(document.querySelector('input[type="password"]'))throw new Error('提交页面尚未登录，请先在 Chrome 自行登录。');
  const label=e=>{const named=[...(e.labels||[])].map(l=>l.textContent.trim()).join(' ');if(named)return named;let text='';for(let n=e.nextSibling;n&&!(n.nodeType===1&&n.matches('input,select,textarea'));n=n.nextSibling){if(n.nodeType===1&&n.tagName==='BR')break;text+=n.textContent||'';}return text.trim();};
  const choices=form=>[...[...form.querySelectorAll('select[name]')].map(e=>({name:e.name,kind:'select',element:e,options:[...e.options].map(o=>({value:o.value,label:o.textContent.trim(),selected:o.selected}))})),...[...new Set([...form.querySelectorAll('input[type="radio"][name]')].map(e=>e.name))].map(name=>({name,kind:'radio',options:[...form.querySelectorAll('input[type="radio"][name]')].filter(e=>e.name===name).map(e=>({value:e.value,label:label(e),selected:e.checked}))}))].filter(g=>g.options.some(o=>/c\+\+|g\+\+/i.test(o.label)));
  const forms=[...document.forms].filter(form=>form.querySelector('textarea[name]')&&choices(form).length);
  if(forms.length!==1)throw new Error('未能唯一识别官方的代码提交表单，本次没有提交。');
  const form=forms[0],sources=[...form.querySelectorAll('textarea[name]')],languages=choices(form);
  if(sources.length!==1||languages.length!==1)throw new Error('代码框或语言选择存在歧义，本次没有提交。');
  const action=new URL(form.action,current);
  if(action.origin!==expected.origin||form.method.toLowerCase()!=='post')throw new Error('提交表单的地址或方法无法核对。');
  const encode=[...form.elements].find(e=>e.name==='sourceEncode');
  return {url:current.href,problemUrl:expected.href,action:action.href,method:'POST',sourceName:sources[0].name,languageName:languages[0].name,languageControl:languages[0].kind,languages:languages[0].options,sourceEncoding:encode?.value??null,fieldNames:[...form.elements].map(e=>e.name).filter(Boolean),submitHandler:form.getAttribute('onsubmit')||'',usesAjax:/ajaxSubmit/.test(form.getAttribute('onsubmit')||''),scripts:[...document.scripts].map(s=>s.src?{src:s.src}:/sourceEncode|submitv2/.test(s.textContent)?{transport:s.textContent.slice(0,20000)}:null).filter(Boolean)};
  }catch(error){return {error:error.message,title:document.title,forms:[...document.forms].map(f=>({method:f.method,action:f.getAttribute('action'),fields:[...f.elements].map(e=>({tag:e.tagName,type:e.type,name:e.name,options:e.tagName==='SELECT'?[...e.options].map(o=>({value:o.value,label:o.textContent.trim()})):undefined}))}))};}
}

// Only operation=submit can POST, and only to this problem's official form.
// Refresh uses GET; no storage, page handlers or global website functions run.
export async function officialJudgeRequest(problemUrl,operation,parameters={}){
  let receipt=parameters.receipt||{},sent=false;
  try{
    const problem=new URL(problemUrl),current=new URL(location.href),group=problem.pathname.split('/')[1],solutionPath=new RegExp('^/'+group+'/solution/\\d+/$');
    if(!['http:','https:'].includes(problem.protocol)||!['bailian.openjudge.cn','noi.openjudge.cn'].includes(problem.hostname)||problem.origin!==current.origin||!/^\/[\w-]+\/\d+\/$/.test(problem.pathname)||problem.search||problem.hash)throw new Error('提交目标不在允许的 OpenJudge 题目范围内。');
    const statusUrl=new URL('/'+group+'/status/',problem).href;
    const fetchDoc=async url=>{
      const u=new URL(url,problem);if(u.origin!==problem.origin||!(u.href===statusUrl||solutionPath.test(u.pathname)))throw new Error('评测跳转地址不属于本题集。');
      const response=await fetch(u.href,{credentials:'same-origin',redirect:'error',signal:AbortSignal.timeout(6000)});if(!response.ok)throw new Error('评测读取失败：HTTP '+response.status);
      const text=await response.text();if(text.length>1000000)throw new Error('评测页面过大。');return new DOMParser().parseFromString(text,'text/html');
    };
    const rows=doc=>[...doc.querySelectorAll('tr')].flatMap(row=>{const a=[...row.querySelectorAll('a[href]')].find(a=>{try{return solutionPath.test(new URL(a.getAttribute('href'),problem).pathname);}catch{return false;}});return a?[{url:new URL(a.getAttribute('href'),problem).href,row}]:[];});
    if(operation==='submit'){
      if(current.pathname!==problem.pathname+'submit/')throw new Error('提交标签已切换，本次没有发送。');
      if(document.querySelector('input[type="password"]'))throw new Error('请先在 Chrome 登录 OpenJudge。');
      const label=e=>{const named=[...(e.labels||[])].map(l=>l.textContent.trim()).join(' ');if(named)return named;let text='';for(let n=e.nextSibling;n&&!(n.nodeType===1&&n.matches('input,select,textarea'));n=n.nextSibling){if(n.nodeType===1&&n.tagName==='BR')break;text+=n.textContent||'';}return text.trim();};
      const choices=f=>[...[...f.querySelectorAll('select[name]')].map(e=>({name:e.name,element:e,options:[...e.options].map(o=>({value:o.value,label:o.textContent.trim(),element:o}))})),...[...new Set([...f.querySelectorAll('input[type="radio"][name]')].map(e=>e.name))].map(name=>({name,options:[...f.querySelectorAll('input[type="radio"][name]')].filter(e=>e.name===name).map(e=>({value:e.value,label:label(e),element:e}))}))].filter(g=>g.options.some(o=>/c\+\+|g\+\+/i.test(o.label)));
      const forms=[...document.forms].filter(f=>f.querySelector('textarea[name]')&&choices(f).length);
      if(forms.length!==1)throw new Error('没有唯一可核对的提交表单。');
      const form=forms[0],sources=[...form.querySelectorAll('textarea[name]')],groups=choices(form),action=new URL(form.action,problem);
      if(sources.length!==1||groups.length!==1)throw new Error('代码框或语言选择存在歧义，本次没有提交。');
      const source=sources[0],language=groups[0];
      if(action.origin!==problem.origin||form.method.toLowerCase()!=='post'||!(action.pathname===problem.pathname+'submit/'||/^\/api\/solution\/submit(?:v2)?\/$/.test(action.pathname)))throw new Error('这个官方提交接口尚未核对，本次没有发送。');
      const choice=language.options.find(o=>o.value===parameters.language&&/c\+\+|g\+\+/i.test(o.label));if(!choice)throw new Error('请选择页面实际提供的 C++ 编译器。');
      if(typeof parameters.code!=='string'||parameters.code.length<5||parameters.code.length>100000)throw new Error('提交源码为空或过长。');
      const encoding=[...form.elements].find(e=>e.name==='sourceEncode')?.value??null;
      if(encoding!==null&&!['text','plain','base64'].includes(encoding))throw new Error('页面源码编码方式尚未核对，本次没有发送。');
      const profile=[...document.querySelectorAll('#userToolbar a[href],.account-link a[href]')].find(a=>/\/user\//.test(a.getAttribute('href')));
      const before=await fetchDoc(statusUrl).catch(()=>null);
      receipt={before:[...(before?rows(before).map(r=>r.url):[]),...(parameters.existingSolutionUrls||[])],ownProfile:profile?new URL(profile.getAttribute('href'),problem).pathname:null,statusUrl,postedAt:new Date().toISOString()};
      source.value=parameters.code;if(language.element)language.element.value=choice.value;else choice.element.checked=true;
      const data=new FormData(form),body=new URLSearchParams();for(const [name,value]of data)if(typeof value==='string')body.append(name,value);
      if(encoding==='base64')body.set(source.name,btoa(Array.from(new TextEncoder().encode(parameters.code),byte=>String.fromCharCode(byte)).join('')));
      sent=true;
      const response=await fetch(action.href,{method:'POST',body,credentials:'same-origin',redirect:'error',headers:{'X-Requested-With':'XMLHttpRequest'},signal:AbortSignal.timeout(12000)});
      if(!response.ok)throw new Error('提交返回 HTTP '+response.status+'；不要自动重试，请先查看 OJ 提交记录。');
      const text=await response.text();let result;try{result=JSON.parse(text);}catch{throw new Error('OJ 未返回可核对的提交结果；可能已发送，请先查看记录，不能自动重试。');}
      if(result.result!=='SUCCESS')throw new Error(String(result.message||result.result||'OJ 未确认提交成功').slice(0,1000));
      const redirect=result.redirect?new URL(result.redirect,problem):null;
      if(redirect?.origin===problem.origin&&solutionPath.test(redirect.pathname))receipt.solutionUrl=redirect.href;
      const id=result.solutionId||result.data?.solutionId;if(id&&/^\d+$/.test(String(id)))receipt.solutionUrl=new URL('/'+group+'/solution/'+id+'/',problem).href;
    }else if(operation!=='refresh')throw new Error('不支持的判题操作。');
    if(!receipt.solutionUrl&&receipt.ownProfile){
      const doc=await fetchDoc(statusUrl),candidates=rows(doc).filter(r=>!receipt.before?.includes(r.url)&&[...r.row.querySelectorAll('a[href]')].some(a=>new URL(a.getAttribute('href'),problem).pathname===receipt.ownProfile)&&[...r.row.querySelectorAll('a[href]')].some(a=>new URL(a.getAttribute('href'),problem).pathname===problem.pathname));
      if(candidates.length===1)receipt.solutionUrl=candidates[0].url;
    }
    return {receipt,status:receipt.solutionUrl?'pending':'unlinked',message:receipt.solutionUrl?'已提交，可刷新本次评测。':'OJ 已确认提交，但尚不能唯一绑定提交编号；请打开本次提交详情，不会猜测 AC。'};
  }catch(error){return {error:String(error.message).slice(0,1200),uncertain:sent,receipt};}
}
