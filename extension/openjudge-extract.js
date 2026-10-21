// This fixed read-only function is serialized into an already-open OJ tab.
// GETs are limited to the user's selected problem/solution on the same origin.
export async function readOpenJudgePage(targetUrl,expectedProblemUrl){
  const allowed=value=>{
    const u=new URL(value,location.href);
    if(!['http:','https:'].includes(u.protocol)||!['bailian.openjudge.cn','noi.openjudge.cn'].includes(u.hostname)||u.username||u.password||u.port||u.search||u.hash||!/^\/[\w-]+\/(?:\d+\/|solution\/\d+\/|status\/)$/.test(u.pathname))throw new Error('只读取 OpenJudge 题目、提交详情或状态页。');
    return u;
  };
  const target=allowed(targetUrl),expected=allowed(expectedProblemUrl);
  if(target.origin!==location.origin||target.hostname!==expected.hostname||target.pathname.split('/')[1]!==expected.pathname.split('/')[1])throw new Error('网页与本题不属于同一站点和题集。');
  let doc=document;
  if(target.href!==new URL(location.href).href){
    const response=await fetch(target.href,{method:'GET',credentials:'same-origin',redirect:'error'});
    if(!response.ok)throw new Error(response.status===401||response.status===403?'提交详情需要先在 Chrome 登录，或当前账号无权查看。':'网页读取失败：HTTP '+response.status);
    const text=await response.text();if(text.length>1000000)throw new Error('网页过长，未读取。');doc=new DOMParser().parseFromString(text,'text/html');
  }
  if(/登录|login/i.test(doc.title||'')&&!doc.querySelector('dl.problem-content'))throw new Error('目前读到登录页，请先在 Chrome 登录。');
  const plain=element=>{
    if(!element)return '';
    const clone=element.cloneNode(true);for(const br of clone.querySelectorAll('br'))br.replaceWith('\n');
    for(const bad of clone.querySelectorAll('script,style'))bad.remove();
    return clone.textContent.replace(/\r\n|\r/g,'\n');
  };
  const sections={description:'',input:'',output:'',sampleInput:'',sampleOutput:''},labels={'描述':'description','题目描述':'description','输入':'input','输出':'output','样例输入':'sampleInput','样例输出':'sampleOutput','Sample Input':'sampleInput','Sample Output':'sampleOutput'};
  for(const dt of doc.querySelectorAll('dl.problem-content>dt')){
    const label=dt.textContent.trim(),dd=dt.nextElementSibling;if(dd?.tagName!=='DD')continue;
    const key=labels[label];
    if(key){const pre=dd.querySelector('pre');sections[key]=(key.startsWith('sample')?plain(pre||dd).replace(/^\n|\n$/g,''):plain(dd).trim()).slice(0,20000);}
    else if(['提示','来源'].includes(label)&&plain(dd).trim())sections.description+=`\n\n题目${label}：\n${plain(dd).trim()}`;
  }
  const problemPath=/^\/[\w-]+\/\d+\/$/;
  const links=[...doc.querySelectorAll('a[href]')].flatMap(a=>{try{const u=new URL(a.getAttribute('href'),target);return u.hostname===expected.hostname&&problemPath.test(u.pathname)?[u]:[];}catch{return [];}});
  const isProblem=problemPath.test(target.pathname),uniqueProblems=[...new Map(links.map(u=>[u.hostname+u.pathname,u])).values()];
  const linked=isProblem?target:uniqueProblems.length===1?uniqueProblems[0]:target.pathname.endsWith('/status/')?links.find(u=>u.hostname+u.pathname===expected.hostname+expected.pathname):null;
  const problemMatches=Boolean(linked&&linked.hostname+linked.pathname===expected.hostname+expected.pathname);
  if(!problemMatches)throw new Error('无法将这个页面与选定题目核对，请在 VS Code 重新选择题面和提交详情。');
  const normalizeStatus=text=>{
    const s=String(text||'').trim();
    for(const [re,status]of [[/^(?:Accepted|AC|通过|正确)$/i,'AC'],[/^(?:Wrong Answer|WA|答案错误)$/i,'WA'],[/^(?:Compile Error|Compilation Error|CE|编译错误)$/i,'CE'],[/^(?:Runtime Error|RE|运行错误)$/i,'RE'],[/^(?:Time Limit Exceeded|TLE|超时)$/i,'TLE'],[/^(?:Memory Limit Exceeded|MLE)$/i,'MLE'],[/^(?:Presentation Error|PE)$/i,'PE'],[/^(?:Output Limit Exceeded|OLE)$/i,'OLE'],[/^(?:Pending|Waiting|Running|Compiling|Judging|排队|评测中)$/i,'pending']])if(re.test(s))return {status,text:s};
    return null;
  };
  const statuses=[];
  if(!isProblem){
    for(const el of doc.querySelectorAll('.solution-result,.result,.status,#result,#status,.result-right,.result-wrong')){const value=normalizeStatus(el.textContent);if(value)statuses.push(value);}
    for(const dt of doc.querySelectorAll('dt'))if(/^(?:结果|评测结果|状态|Result|Status)[:：]?$/.test(dt.textContent.trim())){const v=normalizeStatus(dt.nextElementSibling?.textContent);if(v)statuses.push(v);}
    for(const row of doc.querySelectorAll('tr')){
      const cells=[...row.querySelectorAll('th,td')];if(!cells.length)continue;
      if(cells.length===2&&/^(?:结果|评测结果|状态|Result|Status)[:：]?$/.test(cells[0].textContent.trim())){const v=normalizeStatus(cells[1].textContent);if(v)statuses.push(v);}
      const run=target.pathname.match(/\/solution\/(\d+)\//)?.[1];
      if(run&&!cells.some(c=>c.textContent.trim()===run)&&!row.closest('.solution,.solution-info,#solution'))continue;
      for(const cell of cells){const v=normalizeStatus(cell.textContent);if(v)statuses.push(v);}
    }
  }
  const unique=[...new Map(statuses.map(s=>[s.status,s])).values()],verdict=unique.length===1?unique[0]:{status:'unknown',text:unique.length?'存在多个不同状态，待核对':'未读到可核对的评测状态'};
  const sourceCandidates=[...doc.querySelectorAll('pre.source,pre.source-code,pre.sh_cpp,pre.sh_sourceCode,#sourcecode,#sourceCode,textarea#source,.source-code pre,.solution-source pre')].map(e=>plain(e)).filter(s=>s.trim().length>=5);
  const source=[...new Set(sourceCandidates)];
  const compiler=plain(doc.querySelector('.compile-error,.compiler-output,#compile-error,#compiler-output')).trim();
  const details={problemId:expected.pathname.split('/').filter(Boolean).at(-1),submitter:null,memory:null,time:null,language:null,submittedAt:null};
  if(!isProblem&&target.pathname.includes('/solution/')){
    const fields={'提交人':'submitter','用户':'submitter','User':'submitter','Submitter':'submitter','内存':'memory','Memory':'memory','时间':'time','耗时':'time','Time':'time','语言':'language','Language':'language','提交时间':'submittedAt','Submit Time':'submittedAt','Submitted':'submittedAt'},values={};
    const accept=(label,value)=>{
      const key=fields[label.replace(/[:：\s]+$/,'').trim()],text=value.replace(/\s+/g,' ').trim();
      if(!key||!text||text.length>300)return;
      (values[key]??=new Set()).add(text);
    };
    const safe=e=>!e.closest('pre,code,textarea,script,style,.problem-content,.source-code,.solution-source');
    for(const dt of doc.querySelectorAll('dt'))if(safe(dt)&&dt.nextElementSibling?.tagName==='DD')accept(plain(dt).trim(),plain(dt.nextElementSibling));
    for(const row of doc.querySelectorAll('tr'))if(safe(row)){const cells=[...row.children].filter(e=>['TD','TH'].includes(e.tagName));if(cells.length===2)accept(plain(cells[0]).trim(),plain(cells[1]));}
    for(const item of doc.querySelectorAll('li,p,.solution-info>div,#solution-info>div')){
      if(!safe(item)||item.querySelector('li,p,dl,table,pre,textarea,code'))continue;
      const match=plain(item).trim().match(/^([^:：\n]{1,30})\s*[:：]\s*([^\n]+)$/);
      if(match)accept(match[1],match[2]);
    }
    for(const [key,items]of Object.entries(values))if(items.size===1)details[key]=[...items][0];
  }
  return {url:target.href,problemUrl:expected.href,problemMatches,title:(doc.title||'OpenJudge').replace(/^OpenJudge\s*-\s*/i,'').trim().slice(0,300),problem:sections,
    kind:isProblem?'problem':target.pathname.includes('/solution/')?'solution':'status',submissionId:target.pathname.match(/\/solution\/(\d+)\//)?.[1]||null,
    details:!isProblem&&target.pathname.includes('/solution/')?details:null,
    observedAt:new Date().toISOString(),verdict,submittedCode:source.length===1?source[0].slice(0,100000):null,sourceTruncated:source.length===1&&source[0].length>100000,runtime:{input:'',output:'',hints:!isProblem?verdict.text:'',error:compiler.slice(0,20000),status:!isProblem?verdict.status:'',text:''},
    missingSections:Object.entries(sections).filter(([,value])=>!value.trim()).map(([key])=>key)};
}
