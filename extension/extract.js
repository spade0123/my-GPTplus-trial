// Executed in MAIN world by Chrome scripting API. Reads editor buffers only.
export function extractPage() {
  const candidates=[];
  const add=(label,value,source)=>{
    if(typeof value!=='string'||value.trim().length<5||value.length>100000)return;
    value=value.replace(/\r\n/g,'\n');
    if(!candidates.some(x=>x.value===value))candidates.push({label,value,source});
  };
  document.querySelectorAll('.ace_editor').forEach((el,i)=>{try{add(`Ace 编辑器 ${i+1}`,el.env?.editor?.getValue(),`ace:${i}`);}catch{}});
  document.querySelectorAll('.CodeMirror').forEach((el,i)=>{try{add(`CodeMirror 编辑器 ${i+1}`,el.CodeMirror?.getValue(),`cm:${i}`);}catch{}});
  try {window.monaco?.editor?.getModels().forEach((model,i)=>add(`Monaco 文档 ${i+1}`,model.getValue(),`monaco:${i}`));}catch{}
  document.querySelectorAll('textarea').forEach((el,i)=>{
    if(el.closest('#pku-coach-root')||el.matches('.ace_text-input,.inputarea')||el.closest('.CodeMirror,.monaco-editor,.cm-editor'))return;
    if(/#include|\bmain\s*\(|std::|\b(?:int|void)\s+\w+\s*\(/.test(el.value))add(`代码文本框 ${i+1}`,el.value,`textarea:${i}`);
  });
  const title=document.querySelector('h1,h2')?.innerText?.trim() || document.title;
  function plainText(fragment,imageText) {
    const clone=fragment.cloneNode(true);
    clone.querySelectorAll('script,style,nav,header,footer,input,button,select,textarea,.ace_editor,.CodeMirror,.monaco-editor,.cm-editor,#pku-coach-root').forEach(el=>el.remove());
    if(imageText)clone.querySelectorAll('img').forEach(el=>el.replaceWith(imageText(el)));
    clone.querySelectorAll('br').forEach(el=>el.replaceWith('\n'));
    clone.querySelectorAll('p,div,section,tr,h1,h2,h3,pre,li').forEach(el=>el.append('\n'));
    return clone.textContent.replace(/[\t ]+\n/g,'\n').replace(/\n{3,}/g,'\n\n').trim();
  }
  const labels={description:'题目描述',input:'关于输入',output:'关于输出',sampleInput:'例子输入',sampleOutput:'例子输出'};
  const names={description:['题目描述','描述','问题描述','description'],input:['关于输入','输入说明','输入描述','输入格式','输入','input'],output:['关于输出','输出说明','输出描述','输出格式','输出','output'],sampleInput:['例子输入','样例输入','输入样例','sample input'],sampleOutput:['例子输出','样例输出','输出样例','sample output'],runtime:['运行界面','运行结果','运行信息','测试运行结果','运行'],runtimeInput:['运行输入','执行输入','标准输入','自定义输入'],runtimeOutput:['执行输出','运行输出','实际输出','标准输出'],runtimeHints:['提示信息','运行提示','编译信息','编译提示'],runtimeError:['错误信息','运行错误','错误输出','标准错误'],runtimeStatus:['运行状态','执行状态']};
  const normalize=s=>s.replace(/[：:\s]/g,'').toLowerCase();
  const headings=[];
  document.querySelectorAll('h1,h2,h3,h4,h5,h6,dt,legend,th,div,p,span,strong,b,label').forEach(el=>{
    if(el.closest('nav,header,footer,button,pre,code,[contenteditable],.ace_editor,.CodeMirror,.monaco-editor,.cm-editor,#pku-coach-root'))return;
    const text=normalize(el.textContent.trim());if(!text||text.length>24)return;
    const key=Object.keys(names).find(k=>names[k].some(n=>normalize(n)===text));
    if(key) {
      // Prefer the outer heading wrapper, so an inner <b> does not create an empty duplicate.
      if(headings.some(h=>h.el.contains(el)))return;
      headings.push({key,el});
    }
  });
  const problem={description:'',input:'',output:'',sampleInput:'',sampleOutput:''};
  const figures=Object.fromEntries(Object.keys(problem).map(key=>[key,[]]));
  const pictureNodes=[...document.querySelectorAll('img')];
  const pictureKey=node=>{const source=(node.getAttribute('src')||'')+'|'+(node.getAttribute('srcset')||'');let hash=2166136261;for(let i=0;i<source.length;i++)hash=Math.imul(hash^source.charCodeAt(i),16777619);return (hash>>>0).toString(16);};
  function problemText(fragment,key){
    const pending=[];
    const marked=plainText(fragment,node=>{
      const index=pictureNodes.findIndex(original=>original.getAttribute('src')===node.getAttribute('src')&&original.getAttribute('srcset')===node.getAttribute('srcset'));
      if(index<0||pending.length>=24)return '[参考图请在网页查看]';
      const token=`\uE000GRIDFIG${pending.length}\uE001`;
      pending.push({token,id:`figure-${index}-${pictureKey(pictureNodes[index])}`,section:key,alt:String(node.getAttribute('alt')||'题目参考图').slice(0,200)});return token;
    });
    const images=[];let text='',start=0;
    for(const item of pending){const at=marked.indexOf(item.token,start);if(at<0)continue;text+=marked.slice(start,at);images.push({id:item.id,section:key,alt:item.alt,offset:text.length});start=at+item.token.length;}
    text+=marked.slice(start);return {text,images};
  }
  const runtime={input:'',output:'',hints:'',error:'',status:'',text:''};
  let runtimeSeen=false,truncated=false;
  for(const heading of headings) {
    if(heading.key.startsWith('runtime'))runtimeSeen=true;
    else if(runtimeSeen&&['input','output'].includes(heading.key)&&['输入','输出','input','output'].includes(normalize(heading.el.textContent)))heading.key=heading.key==='input'?'runtimeInput':'runtimeOutput';
  }
  const append=(key,text)=>{if(text&&!runtime[key].split('\n\n').includes(text))runtime[key]=[runtime[key],text].filter(Boolean).join('\n\n').slice(0,key==='status'?1000:20000);};
  for(let i=0;i<headings.length;i++) {
    const {key,el}=headings[i];
    const range=document.createRange();range.setStartAfter(el);
    if(headings[i+1])range.setEndBefore(headings[i+1].el);else range.setEndAfter(document.body.lastChild || el);
    const fragment=range.cloneContents();
    if(key.startsWith('runtime')) {
      append('text',`${el.textContent.trim()}\n${plainText(fragment)}`);
      const read=(selector)=>{
        const nodes=[...fragment.querySelectorAll(selector)];
        return nodes.filter(e=>!nodes.some(parent=>parent!==e&&parent.contains(e))).map(e=>typeof e.value==='string'?e.value:e.innerText||e.textContent).filter(Boolean).join('\n').slice(0,20000);
      };
      const selectors={input:'[data-role="stdin"],#stdin,.stdin,#input',output:'[data-role="stdout"],#stdout,.stdout,#output',hints:'[data-role="hints"],.run-hints',error:'[data-role="stderr"],#stderr,.stderr,#error',status:'[role="status"],.run-status'};
      const values=Object.fromEntries(Object.entries(selectors).map(([field,selector])=>[field,read(selector)]));
      for(const [field,value] of Object.entries(values))append(field,value);
      const field={runtimeInput:'input',runtimeOutput:'output',runtimeHints:'hints',runtimeError:'error',runtimeStatus:'status'}[key];
      if(field&&!values[field]) {
        const content=fragment.cloneNode(true);
        for(const [other,selector] of Object.entries(selectors))if(other!==field)content.querySelectorAll(selector).forEach(e=>e.remove());
        const blocks=[...content.querySelectorAll('pre,textarea')];
        append(field,blocks.length?blocks.map(e=>typeof e.value==='string'?e.value:e.textContent).join('\n\n'):plainText(content));
      }
      if(key==='runtime'&&!values.input)append('input',read('textarea:not(.ace_text-input):not(.inputarea)'));
    }else {
      const samples=[...fragment.querySelectorAll('pre')];
      const extracted=problemText(fragment,key);
      const text=(key==='sampleInput'||key==='sampleOutput')&&samples.length?samples.map(e=>e.textContent.replace(/\r\n/g,'\n')).join('\n\n'):extracted.text;truncated ||= text.length>20000;
      const offset=problem[key].length+(problem[key]?2:0);figures[key].push(...((key.startsWith('sample')&&samples.length)?[]:extracted.images).filter(image=>image.offset<=20000).map(image=>({...image,offset:image.offset+offset})));
      problem[key]=[problem[key],text.slice(0,20000)].filter(Boolean).join('\n\n');
    }
  }
  // Unknown layout stays in a clearly labelled description fallback; never use course navigation.
  if(!Object.values(problem).some(Boolean)&&!headings.some(h=>h.key.startsWith('runtime'))) {
    const section=document.querySelector('#problem,.problem-content,.problem-description,#problemContent,.problem_statement');
    if(section){const result=problemText(section,'description'),text=result.text;problem.description=text.slice(0,20000);figures.description=result.images.filter(image=>image.offset<=20000);truncated ||= text.length>20000;}
  }
  // Current PKU IDE: stable IDs take priority over ranges spanning unrelated panels.
  if(document.querySelector('#problemDescription')) {
    const ids={description:'problemDescription',input:'aboutInput',output:'aboutOutput',sampleInput:'sampleInput',sampleOutput:'sampleOutput'};
    for(const [key,id] of Object.entries(ids)){const el=document.getElementById(id);if(el){const samples=[...el.querySelectorAll('pre')],result=problemText(el,key);const text=key.startsWith('sample')&&samples.length?samples.map(e=>e.textContent.replace(/\r\n/g,'\n')).join('\n\n'):result.text;problem[key]=text.slice(0,20000);figures[key]=(key.startsWith('sample')&&samples.length?[]:result.images).filter(image=>image.offset<=text.slice(0,20000).length);truncated ||= text.length>20000;}}
    const problemHint=document.querySelector('#problemHint');
    if(problemHint&&(problemHint.textContent.trim()||problemHint.querySelector('img'))){const result=problemText(problemHint,'description'),prefix=problem.description.length+'\n\n题目提示\n'.length;problem.description+=`\n\n题目提示\n${result.text}`;figures.description.push(...result.images.map(image=>({...image,offset:image.offset+prefix})));}
    const output=document.querySelector('#output'),status=output?.querySelector(':scope > span.title');
    runtime.input=document.querySelector('#stdin')?.value||'';
    // This platform deliberately combines judge hints and stdout in one <pre>.
    // Keep its original text intact, without pretending it is pure program stdout.
    runtime.output='';runtime.hints='';runtime.error='';
    runtime.status=[status?.textContent.trim(),document.querySelector('#hintStatus')?.textContent.trim()].filter(Boolean).join(' · ').slice(0,1000);
    runtime.text=output?.textContent.trim()?`执行输出和提示信息（平台原始合并区）\n${output.textContent}`.slice(0,20000):'';
  }
  for(const key of Object.keys(problem)){truncated ||= problem[key].length>20000;problem[key]=problem[key].slice(0,20000);figures[key]=figures[key].filter(image=>image.offset<=problem[key].length);}
  const statement=Object.entries(labels).map(([key,label])=>problem[key]?`${label}\n${problem[key]}`:'').filter(Boolean).join('\n\n');
  const missingSections=Object.keys(labels).filter(key=>!problem[key]);
  const primaryIndex=[...document.querySelectorAll('.ace_editor')].findIndex(el=>el.id==='editor');
  let selectedCode='';try{selectedCode=document.querySelector('#editor.ace_editor')?.env?.editor?.getSelectedText?.()?.slice(0,8000)||'';}catch{}
  return {url:location.origin+location.pathname,title:title.slice(0,300),problem,images:Object.values(figures).flat().slice(0,24),runtime,statement,statementTruncated:truncated,candidates,primarySource:primaryIndex>=0?`ace:${primaryIndex}`:'',selectedCode,missingSections,needsVerification:missingSections.length>0};
}
