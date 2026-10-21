// Serialized by scripting.executeScript: keep all helpers inside this function.
// Reads ordinary links from the logged-in DOM or the current assignment's HTML.
export async function readGridProblemList(expectedUrl){
  try{
    const expected=new URL(expectedUrl),pattern=/^\/(?:course\/)?probset\/([a-f0-9]{32})\/([a-f0-9]{32})\/(?:ide\.do|submit\.do)?$/i;
    const current=expected.pathname.match(pattern);
    if(location.origin!==expected.origin||location.pathname!==expected.pathname||expected.origin!=='https://programming.pku.edu.cn'||!current)throw new Error('当前题目已经改变，请刷新列表。');
    const group=current[1].toLowerCase(),currentId=current[2].toLowerCase();
    const canonical=id=>`${expected.origin}/probset/${group}/${id}/ide.do`;
    const clean=text=>String(text||'').replace(/\s+/g,' ').trim().slice(0,300);
    const normalize=(href,base)=>{
      try{
        const u=new URL(href,base),m=u.pathname.match(pattern);
        if(u.origin!==expected.origin||u.username||u.password||u.search||u.hash||!m||m[1].toLowerCase()!==group)return null;
        return {id:m[2].toLowerCase(),url:canonical(m[2].toLowerCase())};
      }catch{return null;}
    };
    const title=clean(document.querySelector('h1,h2')?.textContent||document.title).replace(/^题目\s*[:：-]\s*/,'');
    function read(root,base){
      // Confirmed site DOM: ol > li#li_<32 hex>.currentproblem > a without href.
      const currentRow=root.querySelector('#li_'+currentId),menu=currentRow?.closest('ol');
      if(menu){
        const exact=[],seen=new Set();
        for(const [index,row]of [...menu.children].entries()){
          const id=row.id?.match(/^li_([a-f0-9]{32})$/i)?.[1]?.toLowerCase(),anchor=row.querySelector('a');
          if(!id||!anchor||seen.has(id))continue;
          const target=anchor.hasAttribute('href')?normalize(anchor.getAttribute('href'),base):id===currentId?{id,url:canonical(id)}:null;
          if(!target||target.id!==id)continue;
          const label=clean(anchor.textContent);if(!label)continue;
          seen.add(id);exact.push({url:target.url,title:label,number:index+1});
        }
        if(exact.length)return exact.slice(0,500);
      }
      const candidates=[];
      // The website may leave a hidden menu in the DOM; visibility is irrelevant.
      for(const anchor of root.querySelectorAll('a[href]')){
        if(anchor.closest('pre,code,.ace_editor,.CodeMirror,.monaco-editor'))continue;
        const target=normalize(anchor.getAttribute('href'),base),label=clean(anchor.textContent);
        if(!target||!label||/^(?:下一题|上一题|提交|提交程序|IDE|查看|返回|测试代码|next|previous)$/i.test(label))continue;
        candidates.push({anchor,target,label});
      }
      if(!candidates.length)return [];
      // Prefer a compact common container with the most distinct problems.
      const containers=new Map();
      for(const item of candidates){
        let element=item.anchor.parentElement;
        for(let depth=0;element&&element!==root.body&&depth<7;depth++,element=element.parentElement){
          if(!containers.has(element))containers.set(element,[]);
          containers.get(element).push(item);
        }
      }
      const ranked=[...containers].map(([element,items])=>({element,items,count:new Set(items.map(x=>x.target.id)).size})).sort((a,b)=>b.count-a.count||a.element.querySelectorAll('*').length-b.element.querySelectorAll('*').length);
      const selected=ranked[0],items=selected?.items||candidates,seen=new Set(),result=[];
      for(const item of items){
        if(seen.has(item.target.id))continue;seen.add(item.target.id);
        const row=item.anchor.closest('li,tr'),number=Number(row?.getAttribute('value'))||Number(clean(row?.textContent).match(/^(\d+)[.、)\s]/)?.[1])||Number(item.label.match(/^(\d+)[.、)\s]/)?.[1])||0;
        result.push({url:item.target.url,title:item.label.replace(/^\d+[.、)]\s*/,''),number,id:item.target.id});
      }
      // Current item is often plain text without an href. Read its position.
      if(selected&&!seen.has(currentId)){
        const rows=[...selected.element.querySelectorAll('li')],row=rows.find(el=>!el.querySelector('a[href]')&&clean(el.textContent).replace(/^\d+[.、)]\s*/,'')===title);
        if(row){const index=rows.indexOf(row);result.splice(Math.min(index,result.length),0,{url:canonical(currentId),title,number:index+1,id:currentId});}
      }
      if(!result.some(item=>item.id===currentId))result.unshift({url:canonical(currentId),title:title||'当前题目',number:0,id:currentId});
      return result.slice(0,500).map((item,index)=>({url:item.url,title:item.title,number:item.number||index+1}));
    }
    let problems=read(document,expected.href),source='ide-menu';
    if(problems.length<2){
      const assignmentUrl=`${expected.origin}/probset/${group}/`;
      try{
        const response=await fetch(assignmentUrl,{method:'GET',credentials:'same-origin',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(4000)});
        if(response.ok&&response.headers.get('content-type')?.includes('text/html')){
          const text=await response.text();if(text.length>2_000_000)throw new Error('题集页面过大。');
          const parsed=new DOMParser().parseFromString(text,'text/html');
          if(!parsed.querySelector('input[type="password"]')&&!/未登录|请先登录|请您登录/.test(parsed.querySelector('#errorMessage')?.textContent||'')){
            const discovered=read(parsed,assignmentUrl);if(discovered.length>problems.length){problems=discovered;source='assignment-page';}
          }
        }
      }catch{/* Keep the visible DOM result; never request login or guess APIs. */}
    }
    if(!problems.length)problems=[{url:canonical(currentId),title:title||'当前题目',number:1}];
    if(location.pathname!==expected.pathname)throw new Error('读取列表时切换了题目，请重试。');
    return {problems,source,message:problems.length<2?'只识别到当前题。请在网页展开一次作业菜单，然后点击刷新；仍无列表时需要核对菜单元素。':''};
  }catch(error){return {error:String(error.message||error).slice(0,1000)};}
}
