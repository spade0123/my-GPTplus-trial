// Display only evidence explicitly present in the website reply. Never judge locally.
((root)=>{
  // Recognize only Grid's feedback markup. Never insert the reply as HTML.
  const markup=/<strong\s*>|<\/strong\s*>|<span\s+class\s*=\s*(['"])(highstd|highout|highin)\1\s*>|<\/span\s*>|<br\s*\/?>/gi;
  function tokens(raw){
    const text=String(raw||''),result=[];let start=0;
    for(const match of text.matchAll(markup)){
      if(match.index>start)result.push({text:text.slice(start,match.index)});
      const tag=match[0].toLowerCase();
      result.push(tag.startsWith('<br')?{text:'\n'}:tag.startsWith('</')?{close:tag.startsWith('</strong')?'strong':'span'}:{tag:tag.startsWith('<strong')?'strong':'span',className:match[2]?.toLowerCase()});
      start=match.index+match[0].length;
    }
    if(start<text.length)result.push({text:text.slice(start)});
    return result;
  }
  function decodeText(text){
    // Decode one layer of entities without parsing any surrounding user output.
    const named={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:'\u00a0'};
    return text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,(original,key)=>{
      if(key[0]!=='#')return named[key.toLowerCase()]??original;
      const value=key[1].toLowerCase()==='x'?parseInt(key.slice(2),16):Number(key.slice(1));
      return value>0&&value<=0x10ffff&&!(value>=0xd800&&value<=0xdfff)?String.fromCodePoint(value):original;
    });
  }
  function plainText(raw){return tokens(raw).filter(item=>item.text!==undefined).map(item=>decodeText(item.text)).join('');}
  function renderOriginal(container,raw){
    container.replaceChildren();const stack=[container];
    for(const item of tokens(raw)){
      if(item.text!==undefined){stack.at(-1).append(document.createTextNode(decodeText(item.text)));continue;}
      if(item.close){if(stack.length>1&&stack.at(-1).tagName.toLowerCase()===item.close)stack.pop();continue;}
      const node=document.createElement(item.tag);if(item.className)node.className='grid-'+item.className;
      stack.at(-1).append(node);stack.push(node);
    }
  }
  function extract(raw){
    let text=plainText(String(raw||'').slice(0,100000));const pairs=[];
    const hintMarkers=[...text.matchAll(/(?:^|\n)[ \t]*Hint:[ \t]*(?:\r?\n|$)/g)];
    if(hintMarkers.length){const marker=hintMarkers.at(-1);text=text.slice(marker.index+marker[0].length);}else if(/(?:^|\n)[ \t]*Output:/.test(text))return pairs;
    const quoted=/\bStd:[ \t]*(['"])([^\r\n]*?)\1[ \t]*(?:\r?\n[ \t]*)?Out:[ \t]*(['"])([^\r\n]*?)\3(?=[ \t]*(?:\r?$|Input of|Standard Output:|Different|Case\s+\d))/gm;
    for(const match of text.matchAll(quoted)){
      const before=text.slice(Math.max(0,match.index-1500),match.index),line=before.match(/Different at line\s+(\d+)\.?\s*$/i)?.[1];
      const cases=[...before.matchAll(/(?:Case\s+(\d+)\s*:|in case\s+(\d+))/gi)],caseId=cases.at(-1)?.slice(1).find(Boolean);
      pairs.push({expected:match[2],actual:match[4],line,caseId,excerpt:true});if(pairs.length>=20)break;
    }
    // Some replies expose complete output sections instead of quoted line excerpts.
    if(!pairs.length){
      const sections=/(?:^|\n)[ \t]*Standard Output:[ \t]*([^]*?)(?:\r?\n)[ \t]*Your Output:[ \t]*([^]*?)(?=\r?\n(?:Case\s+\d+\s*:|Testing Input:|Input of in case|Standard Output:)|$)/g;
      for(const match of text.matchAll(sections)){
        const expected=match[1],actual=match[2];
        if(!expected.trim()||/^(?:\.{2,}|…+)$/.test(expected.trim())||/^(?:\.{2,}|…+)$/.test(actual.trim()))continue;
        pairs.push({expected,actual,excerpt:false});if(pairs.length>=20)break;
      }
    }
    return pairs;
  }
  function splitDifference(expected,actual){
    const a=Array.from(expected),b=Array.from(actual);let start=0,end=0;
    while(start<Math.min(a.length,b.length)&&a[start]===b[start])start++;
    while(end<Math.min(a.length-start,b.length-start)&&a[a.length-1-end]===b[b.length-1-end])end++;
    const parts=value=>[{text:value.slice(0,start).join(''),changed:false},{text:value.slice(start,value.length-end).join(''),changed:true},{text:end?value.slice(-end).join(''):'',changed:false}];
    return {expected:parts(a),actual:parts(b),equal:expected===actual};
  }
  const visible=text=>text.replace(/ /g,'·').replace(/\t/g,'⇥').replace(/\r/g,'␍').replace(/\n/g,'↵\n').replace(/\u00a0/g,'⍽');
  function render(container,raw,{visibleWhitespace=true,showComparison=true}={}){
    container.replaceChildren();container.hidden=true;if(!showComparison)return;
    const pairs=extract(raw);if(!pairs.length)return;container.hidden=false;
    const el=(tag,text,className)=>{const value=document.createElement(tag);if(text!==undefined)value.textContent=text;if(className)value.className=className;return value;};
    container.append(el('h3','网格输出对照'),el('p','只对照网站给出的文本，不重新判题。'+(visibleWhitespace?' · 空格　⇥ 制表符　↵ 换行　␍ 回车　⍽ 不换行空格':''),'feedback-note'));
    for(const [index,pair] of pairs.entries()){
      const card=el('section',undefined,'feedback-case'),comparison=splitDifference(pair.expected,pair.actual);
      card.append(el('h4',[(pair.caseId===undefined?'片段 '+(index+1):'Case '+pair.caseId),pair.line?'第 '+pair.line+' 行':'',pair.excerpt?'网格差异片段':'网站显示的输出段落'].filter(Boolean).join(' · ')));
      const grid=el('div',undefined,'feedback-grid');
      for(const [key,label] of [['expected','标准输出（Std）'],['actual','你的输出（Out）']]){
        const column=el('div',undefined,'feedback-column'),pre=el('pre');column.append(el('strong',label));
        let remaining=12000;
        for(const part of comparison[key]){if(!remaining)break;const text=part.text.slice(0,remaining);remaining-=text.length;const span=el(part.changed?'mark':'span',visibleWhitespace?visible(text):text,part.changed?'feedback-changed':'');pre.append(span);}
        if(!pair[key].length)pre.append(el('span','∅（空文本）','feedback-empty'));
        if(pair[key].length>12000)pre.append(el('span','\n[对照显示已截短；完整内容见上方网格原文]','feedback-note'));
        column.append(pre);grid.append(column);
      }
      card.append(grid,el('p',comparison.equal?'这两段文本相同，请查看原文中的其他反馈。':pair.excerpt?'这是网格报告的差异片段，不代表完整输出；颜色标出首尾相同部分之间的差异区段。':'段落分隔的换行也可能来自网页排版；请结合上方原文确认。','feedback-note'));container.append(card);
    }
    if(pairs.length===20)container.append(el('p','最多显示前 20 组对照；其余内容请查看网格原文。','feedback-note'));
  }
  const api={extract,splitDifference,visible,render,renderOriginal,plainText};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.GridOutputFeedback=api;
})(globalThis);
