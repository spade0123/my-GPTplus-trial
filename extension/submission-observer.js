// Runs in MAIN world. Submission code is captured before the page's submit handler.
export function installSubmissionObserver(preferredSource='') {
  if(window.__pkuCoachSubmissionObserver){window.__pkuCoachSubmissionObserver.preferredSource=preferredSource;return;}
  const state={preferredSource,pending:null,timer:null};window.__pkuCoachSubmissionObserver=state;
  function verdict() {
    const excluded='pre,code,textarea,button,.ace_editor,.CodeMirror,.monaco-editor,.cm-editor,#pku-coach-root,#stdout,.stdout,#stderr,.stderr,[data-role="stdout"],[data-role="stderr"]';
    const pkuTitle=document.querySelector('#output > span.title');
    let nodes=pkuTitle&&document.querySelector('#btnSubmit')?[pkuTitle]:[...document.querySelectorAll('[data-verdict],#judge-result,#judgeResult,.judge-result,.submission-result,.verdict,[data-role="verdict"]')];
    if(!nodes.length)nodes=[...document.querySelectorAll('th,td,dt,dd,label,span,div')].filter(e=>/^(?:评测结果|判题结果|提交结果)\s*[:：]/.test(e.textContent.trim())&&e.textContent.trim().length<100);
    const values=nodes.filter(e=>e===pkuTitle||!e.closest(excluded)).map(e=>({text:(e.getAttribute('data-verdict')||e.textContent).trim(),identity:e.getAttribute('data-submission-id')||e.closest('[data-submission-id]')?.getAttribute('data-submission-id')||''}));
    const statuses={AC:/^(AC|Accepted|答案正确|全部通过|通过)$/i,WA:/^(WA|Wrong Answer|Empty Output|答案错误|结果错误|输出为空)$/i,CE:/^(CE|Compile Error|Compilation Error|编译错误)$/i,RE:/^(RE|Runtime Error|运行错误)$/i,TLE:/^(TLE|Time Out|Time Limit Exceeded|运行超时|时间超限)$/i,MLE:/^(MLE|Out Of Memory|Memory Limit Exceeded|内存超限)$/i,PE:/^(PE|Presentation Error|格式错误)$/i,OLE:/^(OLE|Output Exceeded|Output Limit Exceeded|输出超限)$/i};
    for(const value of values)for(const [status,pattern] of Object.entries(statuses))if(pattern.test(value.text.replace(/^(?:评测结果|判题结果|提交结果)\s*[:：]\s*/,'')))return {status,...value};
    return {status:values.some(v=>/评测中|判题中|提交中|Processing|Judging|Pending|Waiting|Running/i.test(v.text))?'pending':'other',text:values.map(v=>v.text).join(' | '),identity:values.map(v=>v.identity).join('|')};
  }
  function code() {
    const values=[];const add=(source,value)=>{if(typeof value==='string'&&value.trim().length>=5&&value.length<=100000&&!values.some(v=>v.code===value))values.push({source,code:value});};
    document.querySelectorAll('.ace_editor').forEach((e,i)=>{try{add(`ace:${i}`,e.env?.editor?.getValue());}catch{}});
    document.querySelectorAll('.CodeMirror').forEach((e,i)=>{try{add(`cm:${i}`,e.CodeMirror?.getValue());}catch{}});
    try{window.monaco?.editor?.getModels().forEach((m,i)=>add(`monaco:${i}`,m.getValue()));}catch{}
    document.querySelectorAll('textarea').forEach((e,i)=>{if(!e.closest('#pku-coach-root,.ace_editor,.CodeMirror,.monaco-editor,.cm-editor')&&/#include|\bmain\s*\(|std::/.test(e.value))add(`textarea:${i}`,e.value);});
    return values.find(v=>v.source===state.preferredSource)||(values.length===1?values[0]:null);
  }
  function submit() {
    const source=code();if(!source)return;
    if(state.pending&&state.pending.code===source.code&&Date.now()-state.pending.time<1000)return;
    const initial=verdict(),id=crypto.randomUUID();
    state.initialOutputTitle=document.querySelector('#output > span.title');
    state.pending={id,...source,url:location.origin+location.pathname,submittedAt:new Date().toISOString(),time:Date.now(),initial,transitioned:false};
    document.dispatchEvent(new CustomEvent('pku-coach-submitted',{detail:{...state.pending,initial:undefined}}));
  }
  document.addEventListener('click',event=>{
    if(!event.isTrusted)return;
    if(event.target.closest?.('#btnTest,#btnClearOutput,#href_history,#btnRecover,#btnEdit,#div_msg_text .sltn')){state.pending=null;return;}
    const button=event.target.closest?.('#btnSubmit,button,input[type="submit"],input[type="button"],a');
    if(!button||button.closest('#pku-coach-root'))return;
    if(button.hasAttribute('disabled')||button.getAttribute('aria-disabled')==='true')return;
    if(/^(?:提交|提交程序|提交代码|提交评测|评测提交|Submit)$/i.test((button.value||button.innerText||button.textContent).trim()))submit();
  },true);
  document.addEventListener('submit',event=>{if(event.isTrusted)submit();},true);
  new MutationObserver(()=>{
    if(!state.pending)return;
    clearTimeout(state.timer);state.timer=setTimeout(()=>{
      const pending=state.pending;if(!pending)return;
      if(Date.now()-pending.time>10*60*1000){state.pending=null;return;}
      const current=verdict();
      if(state.initialOutputTitle&&state.initialOutputTitle!==document.querySelector('#output > span.title'))pending.transitioned=true;
      if(['pending','other'].includes(current.status)){if(current.text!==pending.initial.text||current.status==='pending')pending.transitioned=true;return;}
      if(!pending.transitioned&&current.text===pending.initial.text&&current.identity===pending.initial.identity)return;
      state.pending=null;
      document.dispatchEvent(new CustomEvent('pku-coach-judged',{detail:{submissionId:pending.id,url:pending.url,code:pending.code,verdict:{source:'judge-dom',status:current.status,text:current.text,identity:current.identity,observedAt:new Date().toISOString()}}}));
    },50);
  }).observe(document.body||document.documentElement,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['data-verdict','data-submission-id']});
}
