// Deterministic first-pass feedback: no network, model call, or student execution.
(() => {
  function masked(code){
    const out=code.split('');let i=0;
    const erase=(from,to)=>{for(let p=from;p<to;p++)if(code[p]!=='\n')out[p]=' ';};
    while(i<code.length){
      const start=i;
      if(code.startsWith('//',i)){const end=code.indexOf('\n',i+2);i=end<0?code.length:end;erase(start,i);}
      else if(code.startsWith('/*',i)){const end=code.indexOf('*/',i+2);i=end<0?code.length:end+2;erase(start,i);}
      else if(code.startsWith('R"',i)){
        const offset=code.slice(i+2,i+19).indexOf('('),open=offset<0?-1:i+2+offset;
        if(open<0){i++;continue;}
        const delimiter=code.slice(i+2,open);
        if(/[\s()\\]/.test(delimiter)){i++;continue;}
        const end=code.indexOf(')'+delimiter+'"',open+1);i=end<0?code.length:end+delimiter.length+2;erase(start,i);
      }else if(code[i]==='"'||code[i]==="'"){
        const quote=code[i++];while(i<code.length){if(code[i]==='\\'){i+=2;continue;}if(code[i++]===quote)break;}
        erase(start,Math.min(i,code.length));
      }else i++;
    }
    return out.join('');
  }
  const fence=text=>{const runs=String(text).match(/`+/g)||[];const mark='`'.repeat(Math.max(3,...runs.map(s=>s.length+1)));return `${mark}text\n${text}\n${mark}`;};
  function generate(capture,judgment={},compiler){
    if(judgment.status==='AC')return {markdown:'## 当前版本已 AC\n\n已有与这份代码对应的通过记录。版本仍会保存并排队分析，本次无需排错提示。',accepted:true};
    const code=String(capture.code||''),lines=code.split('\n'),items=[];
    // Keep line numbers while masking strings/comments for syntax-shaped checks.
    const clean=masked(code).split('\n'),hasSubscripts=clean.some(s=>/\[[^\]]+\]/.test(s));
    const add=(line,reason,correction)=>{if(items.length<4)items.push({line,reason,correction});};
    if(compiler?.status==='diagnostics'){
      const first=compiler.output?.split('\n').find(s=>/\berror:/.test(s));
      if(first)items.push({line:'编译器检查',reason:'当前冻结版本未通过本地语法检查。',correction:first,confirmed:true});
    }
    for(let i=0;i<clean.length&&items.length<4;i++){
      const text=clean[i];
      if(/\bwhile\s*\(\s*!\s*cin\.eof\s*\(/.test(text))add(i+1,'循环先检查 eof，可能在一次读取失败后仍处理旧数据。','以读取操作本身作为循环条件，例如 while (cin >> x)，并按实际输入字段补全条件。');
      if(/\bif\s*\([^\n;]*[^=!<>]=[^=]/.test(text))add(i+1,'条件中出现赋值，请确认是有意赋值，还是把相等判断写成了单个等号。','如果目标是比较相等，改为 ==；若有意赋值，要明确检查赋值后的结果。');
      if(/\.size\s*\(\s*\)\s*-\s*1/.test(text))add(i+1,'size() - 1 在容器为空时可能发生无符号回绕。','访问前先检查 !empty()；逆向遍历可从 size() 开始，在 i > 0 时使用 i - 1。');
      if(hasSubscripts&&/\bfor\s*\([^;]*;[^;]*<=/.test(text))add(i+1,'循环包含 <=，而代码中有下标访问，需要核对终止边界。','长度为 n 的连续容器通常使用 [0,n)；只有题目与实际数组容量允许时才使用 <=。这只是待验证线索。');
    }
    const getlineLine=clean.findIndex(s=>/\bgetline\s*\(\s*cin\s*,/.test(s));
    if(getlineLine>=0&&clean.slice(0,getlineLine+1).some(s=>/\bcin\s*>>/.test(s)))add(getlineLine+1,'代码混合了 >> 与 getline，需核对题目中字段和换行的位置。','如果下一字段确实从下一行开始，getline 前清理当前行剩余换行；同一行还有有效内容时不要直接丢弃整行。');
    for(let i=0;i<lines.length&&items.length<4;i++)if(/\bscanf\s*\(/.test(clean[i])&&/%s/.test(lines[i]))add(i+1,'scanf 的 %s 没有显式宽度限制，可能超出字符数组容量。','若数组容量为 N，读取宽度至多 N-1；需要保留空格时另选 getline 或按题意读取。');
    const problem=capture.problem||{};
    const parts=['## 题意与当前代码 · 即时核对','后台会根据完整题面推导解题方向，再对照当前代码定位差距。以下是本地初筛，未运行程序，也不代表已得到正确解法。'];
    if(problem.output)parts.push(`### 本题要求的结果\n\n${fence(problem.output.slice(0,900))}`);
    else if(problem.description||capture.statement)parts.push(`### 本题目标核对\n\n${fence((problem.description||capture.statement).slice(0,900))}\n\n输出说明未单独采集，请先核对题面是否完整。`);
    if(items.length)for(const item of items)parts.push(`### ${item.line} · ${item.confirmed?'已确认编译错误':'待验证'}\n\n**检查点：**${item.reason}\n\n**改正方法：**${item.correction}`);
    else parts.push('### 先核对输入与边界\n\n本地规则没有发现明显线索，这不代表程序正确。请对照当前题目逐项核对输入顺序、空白与多组输入，以及最小规模、重复值和找不到答案时的分支。');
    if(problem.input)parts.push(`### 本题输入核对\n\n按下面的输入说明核对当前读取方式：\n\n${fence(problem.input.slice(0,900))}`);
    const runtime=capture.runtime||{};
    const runtimeClues=[runtime.error,runtime.text,runtime.status&&runtime.status!=='unknown'?`状态：${runtime.status}`:''].filter(Boolean).join('\n\n');
    if(runtimeClues)parts.push(`### 运行界面的线索\n\n网页现有结果可能属于旧版本，先确认它与当前代码相对应；本机样例与网页评测的来源也要分开看。\n\n${fence(runtimeClues.slice(0,1600))}`);
    if(problem.sampleInput&&problem.sampleOutput)parts.push(`### 验证方法\n\n先手算样例，再在平台自行测试；这里没有代你运行。\n\n样例输入：\n\n${fence(problem.sampleInput.slice(0,700))}\n\n题目要求的样例输出：\n\n${fence(problem.sampleOutput.slice(0,700))}`);
    if(compiler?.status==='passed')parts.push('本地语法检查通过；算法正确性和平台 AC 仍需验证。');
    return {markdown:parts.join('\n\n'),accepted:false,findings:items.length};
  }
  function discuss(capture,question,selectedCode=''){
    const lines=String(capture.code||'').split('\n');
    const concepts=[
      ['getline',/getline/i,'getline(cin, s) 读取一整行，可保留中间空格。若前面刚用 >> 读取过数据，要根据题目格式核对换行残留。'],
      ['find',/\bfind\b|npos/i,'string 的 find 返回首次出现的位置；找不到时返回 string::npos。建议用 auto 接收位置，使用前先比较是否等于 string::npos。'],
      ['substr',/substr/i,'substr(pos, count) 从 pos 开始截取最多 count 个字符；第二个参数是长度，不是终点。pos 超过字符串长度会抛异常。'],
      ['stoi',/stoi/i,'stoi 把字符串开头可解析的整数部分转换成 int；可能只转换前缀。输入无数字或超出 int 范围时会抛异常，格式与范围需要分开核对。'],
      ['size',/\bsize\b|empty/i,'size() 是当前元素数量，empty() 判断是否为空。有效下标通常是 0 到 size()-1；为空时不能直接用 size()-1 作为合法下标。'],
      ['sort',/\bsort\b|stable_sort/i,'sort 对半开区间 [begin,end) 排序；默认升序。比较函数需满足严格弱序，通常不能用 <= 代替 <；stable_sort 额外保持等价元素的相对顺序。'],
      ['scanf',/scanf/i,'scanf 的格式必须与目标变量的实际类型对应，数值通常要传地址；%s 要按字符数组容量限制宽度，且不会保留词内空格。'],
      ['vector',/vector|push_back/i,'vector<T>(n) 已经包含 n 个元素；push_back 会在末尾新增一个元素。不要把“已有 n 个元素”误当成“只预留容量”。']
    ];
    const concept=concepts.find(([token,pattern])=>pattern.test(question)&&String(capture.code).includes(token));
    const range=question.match(/第?\s*(\d+)\s*(?:到|至|-|~|—)\s*(\d+)\s*行/),single=question.match(/第\s*(\d+)\s*行/);
    let selected=selectedCode;
    if(!selected&&range)selected=lines.slice(Math.max(0,Number(range[1])-1),Math.min(lines.length,Number(range[2]))).join('\n');
    if(!selected&&single)selected=lines[Number(single[1])-1]||'';
    if(!selected&&concept)selected=lines.filter(line=>line.includes(concept[0])).slice(0,3).join('\n');
    if(concept)return {markdown:`## 本地即时解释\n\n${concept[2]}${selected?`\n\n当前代码中的相关片段：\n\n${fence(selected.slice(0,2000))}`:''}\n\n这解释了相关接口的含义；结合本题判断具体逻辑的深入回复仍在后台生成。`,targeted:true};
    return {markdown:`## 已定位本轮代码\n\n${selected?`你指向的片段：\n\n${fence(selected.slice(0,2000))}\n\n`:''}这轮问题和代码会一同保存。这个问题需要结合题意和程序逻辑判断，本地规则不能可靠代答；模型的具体解释将在后台补充。`,targeted:false};
  }
  globalThis.PkuInstantHints={generate,discuss};
})();
