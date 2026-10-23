(() => {
  if(document.getElementById('pku-coach-root'))return;
  const host=document.createElement('div');host.id='pku-coach-root';document.documentElement.append(host);
  const ui=host.attachShadow({mode:'closed'});
  ui.innerHTML=`<style>
    :host{all:initial}*{box-sizing:border-box}button,select,textarea{font:inherit}button{cursor:pointer;border:1px solid #cad5e3;border-radius:7px;padding:8px 12px;background:white;color:#17324e}button:disabled{opacity:.55;cursor:wait}.primary{background:#135d85;color:white;border-color:#135d85}#launchers{position:fixed;right:22px;bottom:22px;z-index:2147483647;display:flex;gap:8px;font:14px system-ui}#launchers button{box-shadow:0 4px 18px #0003}#toast{position:fixed;right:22px;bottom:75px;width:min(440px,90vw);z-index:2147483647;border:1px solid #bfd4df;border-radius:9px;background:#f4fafc;padding:12px;color:#17324e;box-shadow:0 4px 18px #0002;font:13px/1.6 system-ui}#toast[hidden]{display:none}#toast button{font-size:12px;margin-top:7px}#hintPanel{position:fixed;right:20px;bottom:76px;width:min(600px,92vw);max-height:80vh;overflow:auto;z-index:2147483647;background:#f8fafc;border:1px solid #c4d2df;border-radius:12px;box-shadow:0 12px 48px #0004;padding:18px;color:#17324e;font:14px/1.7 system-ui}#hintPanel[hidden]{display:none}#hintState{white-space:pre-wrap;margin:12px 0;color:#526b80}#hintVersion{font-size:12px;color:#526b80}
    #panel{position:fixed;right:20px;top:6vh;width:min(620px,92vw);height:84vh;z-index:2147483647;background:#f8fafc;color:#172f44;border:1px solid #c4d2df;border-radius:12px;box-shadow:0 12px 48px #0004;font:14px/1.6 system-ui;overflow:auto;padding:18px}#panel[hidden]{display:none}header{display:flex;justify-content:space-between;align-items:center}h2{font-size:19px;margin:0}label{display:block;margin:12px 0 5px}textarea{width:100%;resize:vertical;border:1px solid #b6c7d7;border-radius:6px;padding:9px;background:white;color:#102a43}#code{font-family:Consolas,monospace}#state{white-space:pre-wrap;color:#405d75;margin:12px 0}.row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.hint{font-size:12px;color:#526b80}#report{white-space:pre-wrap;overflow-wrap:anywhere;font:14px/1.75 system-ui;background:white;padding:14px;border-radius:8px}select{max-width:100%;padding:6px}
    </style><style>
    #report{white-space:normal;overflow-wrap:anywhere;font:14px/1.8 system-ui;background:white;padding:22px 24px;border:1px solid #e1eaf1;border-radius:10px;color:#23384b}
    #report h1{font-size:21px;line-height:1.4;color:#154f73;margin:.3em 0 1em}
    #report h2,#report h3,#report h4,#report h5{color:#154f73;line-height:1.4;margin:1.45em 0 .55em}
    #report h2{font-size:18px;border-bottom:1px solid #d9e5ee;padding-bottom:7px}
    #report h3{font-size:16px}#report p{margin:.65em 0}
    #report h4,#report h5,#report h6{font-size:14px}#report li>p{margin:.25em 0}
    #report ul,#report ol{padding-left:1.6em;margin:.5em 0 1em}#report li{padding-left:.2em;margin:.3em 0}
    #report strong{font-weight:650;color:#173c58}#report a{color:#116894;text-decoration:underline;text-underline-offset:3px}
    #report :not(pre)>code{padding:.12em .35em;border-radius:4px;background:#edf3f8;color:#305775;font:12.5px/1.6 Consolas,monospace}
    #report hr{border:0;border-top:1px solid #d9e5ee;margin:1.4em 0}
    #report .table-scroll{overflow-x:auto;margin:1em 0;border:1px solid #dbe5ed;border-radius:8px}
    #report table{width:100%;border-collapse:collapse;font-size:13px;line-height:1.65}
    #report th,#report td{padding:9px 11px;border-bottom:1px solid #e5edf3;vertical-align:top;min-width:80px}
    #report th{background:#edf4f9;color:#234f70;font-weight:650;text-align:left}#report tbody tr:nth-child(even){background:#f8fafc}
    #report tr:last-child td{border-bottom:0}#report .report-image{color:#607b90;font-size:12px}
    #report blockquote{margin:.8em 0;padding:.35em .9em;border-left:3px solid #82b6d2;background:#f2f8fb;color:#405d75}
    #report .report-code{position:relative;margin:1em 0;padding:14px 16px;overflow:auto;border-radius:8px;background:#f2f5f8;color:#16324a;font:13px/1.65 Consolas,monospace;white-space:pre;tab-size:4}
    #report .report-code[data-language]::before{content:attr(data-language);display:block;margin:-3px 0 8px;color:#6a8194;font:11px/1.2 system-ui;text-transform:uppercase}
    #report .math-inline{padding:0 .12em;color:#123e5c}
    #report .math-block{margin:1em -4px;padding:14px 10px;overflow-x:auto;text-align:center;border-radius:8px;background:#f5f9fc;color:#123e5c}
    #report .katex-display{margin:.25em 0}
    </style><div id="launchers"><button id="launch" class="primary">快捷保存</button><button id="hintLaunch">提示</button><button id="chatLaunch">交流</button></div><div id="toast" role="status" aria-live="polite" hidden><div id="toastText"></div><button id="openRecords">查看保存记录</button></div><section id="hintPanel" hidden><header><h2>当前代码的提示</h2><button id="hintClose">收起</button></header><div id="hintVersion"></div><div id="hintState" role="status" aria-live="polite">正在读取当前题目和代码…</div><article id="hintReport" hidden></article><div class="row"><button id="hintRetry" hidden>重试深入提示</button><button id="hintDetails">核对详情 / 保存记录</button></div><p class="hint">先显示本地即时检查，深入分析在后台补充。只提供提示与改正方法，不修改编辑器或自动提交。</p></section><section id="chatPanel" hidden><header><h2>本题代码交流</h2><button id="chatClose">收起</button></header><p class="hint">每次发送会保存当时的题目、代码和运行信息。可在编辑器选中片段，或提问“第 12 行是什么意思”。</p><div id="chatState" class="hint" role="status"></div><div id="chatMessages"></div><label>你的问题</label><textarea id="chatQuestion" rows="3" maxlength="2000" placeholder="例如：这里的 find 返回值为什么要先检查？"></textarea><div class="row"><button id="chatSend" class="primary">发送并保存</button><button id="chatHistory">刷新本题对话</button></div><p class="hint">本地能解释的接口先即时回复；需要模型判断的逻辑在后台补充。问题和回复均作为后续报告参考。</p></section><section id="panel" hidden><header><h2>C++ 学习教练</h2><button id="close">收起</button></header>
    <div id="state">正在读取题目和编辑器…</div><details id="draftPreview"><summary>自动草稿备份与恢复</summary><p id="draftStatus" class="hint">在平台“编辑修改”状态下，停止输入约 0.6 秒后独立备份草稿。</p><div class="row"><button id="draftList">查看本题草稿</button><select id="draftChoice" hidden></select></div><textarea id="draftCode" rows="8" readonly spellcheck="false" hidden></textarea><div class="row"><button id="downloadDraft" hidden>下载这份草稿</button><button id="restoreDraft" hidden>将这份草稿恢复到网站编辑器</button></div><p class="hint">每题、每账号保留最近 10 个不同版本。草稿只保存在本机 Chrome 扩展中，不生成报告、不自动提交。恢复前会先备份屏幕上的代码；不会自动覆盖。卸载扩展会移除这些自动草稿，重要版本请另存文件或使用“保存过程版本”。</p></details><details id="preview" open><summary>核对题目各部分和自己的代码</summary><div class="hint">首次先核对。报告由本机 Codex 登录会话生成，会使用 Codex 额度。</div><label>题目名称</label><textarea id="title" rows="1"></textarea><label>题目描述</label><textarea id="description" rows="6"></textarea><label>关于输入</label><textarea id="input" rows="4"></textarea><label>关于输出</label><textarea id="output" rows="4"></textarea><label>例子输入</label><textarea id="sampleInput" rows="4" spellcheck="false"></textarea><label>例子输出</label><textarea id="sampleOutput" rows="4" spellcheck="false"></textarea><label>代码来源</label><select id="source"></select><textarea id="code" rows="12" spellcheck="false"></textarea><label>语言标准</label><select id="standard"><option>c++17</option><option>c++11</option><option>c++14</option><option>c++20</option></select></details>
    <details id="runtimePreview"><summary>运行界面（单独保存）</summary><p class="hint">读取页面已有的运行信息；没有运行结果时保持空白。</p><label>运行输入</label><textarea id="runInput" rows="3" spellcheck="false"></textarea><label>执行输出</label><textarea id="runOutput" rows="3" spellcheck="false"></textarea><label>提示信息</label><textarea id="runHints" rows="3" spellcheck="false"></textarea><label>错误信息</label><textarea id="runError" rows="3" spellcheck="false"></textarea><label>运行状态</label><textarea id="runStatus" rows="1"></textarea><label>运行界面文本</label><textarea id="runText" rows="5" spellcheck="false"></textarea></details>
    <label>本次修改 / debug 备注（选填）</label><textarea id="note" rows="2" placeholder="例如：空字符串时越界，增加了长度检查"></textarea>
    <div class="row"><button id="run" class="primary" disabled>保存过程版本</button><button id="refresh">重新读取</button><button id="download" hidden>下载报告</button></div><p class="hint">过程版本保存在本机；报告后台生成；定期总结按 Codex 中设置的计划运行。</p><details><summary>本题修改与提交记录（本地）</summary><div id="attempts">暂无记录</div></details><details open><summary>最终归档（仅保存在本机）</summary><div id="archiveState" class="hint">检测到本次提交 AC 后，在本机单独生成最终代码、README 和 debug 总结。归档期间仍可保存和修改代码。</div><div id="archives"></div></details><details open><summary>后台报告</summary><div id="jobs">暂无保存记录</div></details><div id="reportStatus" class="hint"></div><article id="report" hidden></article></section>`;
  for(const style of ui.querySelectorAll('style'))style.textContent=style.textContent.replace(/#report(?=[\s:{.>])/g,':is(#report,#hintReport,.chatAnswer)');
  const chatStyle=document.createElement('style');chatStyle.textContent='#chatPanel{position:fixed;right:20px;bottom:76px;width:min(620px,92vw);max-height:82vh;overflow:auto;z-index:2147483647;background:#f8fafc;border:1px solid #c4d2df;border-radius:12px;box-shadow:0 12px 48px #0004;padding:18px;color:#17324e;font:14px/1.7 system-ui}#chatPanel[hidden]{display:none}#chatMessages{max-height:45vh;overflow:auto}.chatMessage{padding:12px 0;border-bottom:1px solid #dbe5ed}.chatQuestion{white-space:pre-wrap;background:#e7f1f7;border-radius:8px;padding:9px 12px}.chatMeta{font-size:12px;color:#627c8b;margin:7px 0}.chatAnswer{margin-top:7px}';ui.prepend(chatStyle);
  const katexStyle=document.createElement('link');
  katexStyle.rel='stylesheet';
  katexStyle.href=chrome.runtime.getURL('vendor/katex/katex.min.css');
  ui.prepend(katexStyle);
  const $=id=>ui.getElementById(id);
  ui.append($('toast'));
  const cacheTools=document.createElement('details');cacheTools.innerHTML='<summary>网站题面缓存清理（自动保护已开启）</summary><p class="hint">接近容量预警线或出现容量错误时，自动备份并清理可重新下载的题面和题集缓存。保留源码、草稿、提交、登录信息和报告，不自动刷新页面。备份失败则停止清理。</p><div class="row"><button id="clearSiteCacheDetails">备份并清理题面缓存</button><button id="exportSiteCache">下载最近一次清理备份</button></div><p id="cacheStatus" class="hint" role="status">自动检查已开启。</p>';$('panel').append(cacheTools);
  const cacheButton=document.createElement('button');cacheButton.id='clearSiteCache';cacheButton.textContent='清理题面缓存';$('hintDetails').parentElement.append(cacheButton);
  const problemKeys=['description','input','output','sampleInput','sampleOutput'];
  const runtimeFields={input:'runInput',output:'runOutput',hints:'runHints',error:'runError',status:'runStatus',text:'runText'};
  let port,capture=null,candidates=[],busy=false,lastReport='',pendingNote='';
  let quickAction=null,hintAction=null,currentHint=null,hintCapture=null,hintJudgment={},hintDeadline=null,previewReceived=false;
  const chats=new Map();
  function renderChats(){
    const list=$('chatMessages'),bottom=list.scrollHeight-list.scrollTop-list.clientHeight<80;
    list.replaceChildren();
    for(const item of [...chats.values()].sort((a,b)=>String(a.job?.createdAt||a.requestedAt||'').localeCompare(String(b.job?.createdAt||b.requestedAt||'')))){
      const box=document.createElement('section');box.className='chatMessage';
      const question=document.createElement('div');question.className='chatQuestion';question.textContent=`你：${item.question}`;
      const meta=document.createElement('div');meta.className='chatMeta';
      const labels={queued:'已保存，交流队列处理中',running:item.job?.partialAnalysis?'正在回复（逐步显示）':'已保存，模型正在思考',complete:'助教回复',failed:'已保存，回复未完成'};
      meta.textContent=item.job?`${labels[item.job.status]||item.job.status} · 版本 ${item.job.codeHash?.slice(0,8)||''}`:item.status||'正在读取并保存当前版本…';
      const answer=document.createElement('article');answer.className='chatAnswer';
      const markdown=item.job?.status==='complete'?item.job.analysis:item.job?.partialAnalysis||item.preview||item.job?.instantAnalysis||'';
      if(markdown)globalThis.PkuReportRenderer?.render(answer,markdown,globalThis.katex);
      box.append(question,meta,answer);
      if(item.job?.status==='failed'){
        const error=document.createElement('p');error.className='hint';error.textContent=item.job.error||'后台暂不可用，本地解释仍然保留。';
        const retry=document.createElement('button');retry.textContent='重试这条回复';retry.onclick=()=>{connect();port.postMessage({type:'hint_retry',id:item.job.id,actionId:item.actionId});};box.append(error,retry);
      }
      list.append(box);
    }
    if(bottom)list.scrollTop=list.scrollHeight;
  }
  function updateChat(job,actionId){
    const key=actionId||job.eventId;
    const existing=chats.get(key)||{actionId:key,question:job.question};
    if(existing.job&&existing.job.status===job.status&&existing.job.partialAnalysis===job.partialAnalysis&&existing.job.analysis===job.analysis&&existing.job.error===job.error)return;
    chats.set(key,{...existing,job});renderChats();
  }
  let toastTimer;
  const toast=text=>{$('toastText').textContent=text;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,5000);};
  let lastCacheWarning='';
  function cacheWarning(message){$('cacheStatus').textContent=message;if(lastCacheWarning!==message){lastCacheWarning=message;toast(message);}}
  function renderInstant(compiler){
    if(!hintCapture)return;
    const result=globalThis.PkuInstantHints?.generate(hintCapture,hintJudgment,compiler);
    if(result){globalThis.PkuReportRenderer?.render($('hintReport'),result.markdown,globalThis.katex);$('hintReport').hidden=false;}
  }
  function showHint(job){
    currentHint=job;
    $('hintVersion').textContent=`${job.title||'本题'} · 点击时版本 ${job.codeHash?.slice(0,8)||job.id.slice(0,8)}`;
    $('hintRetry').hidden=job.status!=='failed';
    if(job.status==='skipped'){
      $('hintState').textContent=job.message;$('hintReport').hidden=true;
    }else if(job.status==='complete'){
      globalThis.PkuReportRenderer?.render($('hintReport'),job.analysis,globalThis.katex);$('hintReport').hidden=false;
      $('hintState').textContent='深入提示已完成，针对点击时保存的版本；后续修改请重新点“提示”。';
    }else{
      renderInstant(job.compiler);
      $('hintState').textContent=job.status==='failed'?`本地即时提示仍可查看；深入分析失败：${job.error||'可重试'}`:'本地即时提示已显示；深入分析在后台进行，可以继续修改或快捷保存。';
    }
  }
  function action(type){
    connect();const actionId=crypto.randomUUID();
    if(type==='quick_save'){
      if(quickAction)return;quickAction=actionId;$('launch').disabled=true;$('launch').textContent='保存中…';toast('正在读取并保存当前代码…');
    }else{
      if($('hintLaunch').disabled)return;
      hintAction=actionId;currentHint=null;hintCapture=null;previewReceived=false;
      $('hintLaunch').disabled=true;$('hintPanel').hidden=false;$('chatPanel').hidden=true;$('toast').hidden=true;$('panel').hidden=true;$('hintReport').hidden=true;$('hintRetry').hidden=true;$('hintVersion').textContent='';
      $('hintState').textContent='正在读取题目、当前代码与运行界面，立即进行本地检查…';
      clearTimeout(hintDeadline);
      hintDeadline=setTimeout(()=>{
        if(hintAction===actionId&&!previewReceived){$('hintState').textContent='未能在 4.5 秒内读取完整编辑器，已结束等待。请核对页面或使用“核对详情”；已发出的保存请求仍会继续。';$('hintLaunch').disabled=false;}
      },4500);
    }
    try{port.postMessage({type,actionId,requestedAt:new Date().toISOString()});}catch(error){toast(error.message);if(type==='quick_save'){quickAction=null;$('launch').disabled=false;$('launch').textContent='快捷保存';}else{$('hintLaunch').disabled=false;}}
  }
  const jobs=new Map();let selectedReportId=null;
  let draftAccount='',draftRecord=null;
  const draftReply=detail=>document.dispatchEvent(new CustomEvent('pku-coach-draft-reply',{detail}));
  function showDraft(){
    const version=draftRecord?.versions.find(v=>v.id===$('draftChoice').value);
    $('draftCode').value=version?.code||'';
    for(const id of ['draftCode','downloadDraft','restoreDraft'])$(id).hidden=!version;
  }
  const state=text=>{$('state').textContent=text;};
  function updateProblem(problem) {
    const kinds={draft:'过程保存',submission:'提交评测',ac:'通过 AC',legacy:'旧版保存'};
    $('attempts').replaceChildren();
    for(const a of problem.attempts.slice(-30).reverse()) {
      const numbers=a.numbers||[a.number];
      const label=numbers.length>6?`${numbers.slice(0,3).join('、')}…${numbers.at(-1)}`:numbers.join('、');
      const repeat=a.occurrenceCount>1?` · 相同内容已合并 ${a.occurrenceCount} 次`:'';
      const row=document.createElement('div');row.textContent=`#${label} ${kinds[a.kind]||a.kind} · ${a.codeHash?.slice(0,8)||''}${a.verdict?' · '+a.verdict.status:''}${a.note?' · '+a.note:''}${repeat}`;$('attempts').append(row);
    }
    if(!problem.attempts.length)$('attempts').textContent='暂无记录';
    const labels={queued:'AC 已记录，等待生成最终 README',waiting_reports:'AC 已记录，等待后台报告',building:'正在后台整理修改与 debug 总结',complete:'本机归档已完成',failed:'最终归档失败，过程保存不受影响'};
    $('archives').replaceChildren();
    for(const f of problem.finalizations.slice(-5).reverse()) {
      const row=document.createElement('div');row.className='row';row.style.margin='8px 0';
      const text=document.createElement('span');text.textContent=`${labels[f.status]||f.status}${f.error?'：'+f.error:''}`;row.append(text);
      if(f.status==='failed'){const b=document.createElement('button');b.textContent='重试最终归档';b.onclick=()=>{connect();port.postMessage({type:'retry_archive',archiveId:f.id});};row.append(b);}
      $('archives').append(row);
    }
  }
  function updateJob(job) {
    jobs.set(job.id,{...jobs.get(job.id),...job});
    const ordered=[...jobs.values()].sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))).slice(0,20);
    jobs.clear();for(const item of ordered)jobs.set(item.id,item);
    const labels={queued:'已保存 · 排队中',pending:'已保存 · 等待处理',running:'已保存 · 报告生成中',complete:'报告已完成',failed:'已保存 · 报告失败'};
    $('jobs').replaceChildren();
    for(const item of ordered) {
      const row=document.createElement('div');row.className='row';row.style.margin='8px 0';
      const text=document.createElement('span');text.textContent=`${item.title||'作业'} · ${item.id.slice(0,7)} · ${labels[item.status]||item.status}`;
      const button=document.createElement('button');button.textContent=item.status==='failed'?'重试报告':item.status==='complete'?'查看报告':'刷新状态';
      button.onclick=()=>{connect();if(item.status==='failed')port.postMessage({type:'retry',id:item.id});else{selectedReportId=item.id;$('reportStatus').textContent='正在读取报告状态…';port.postMessage({type:'review',id:item.id});}};
      row.append(text,button);$('jobs').append(row);
    }
  }
  function connect(){
    if(port)return;
    port=chrome.runtime.connect({name:'pku-coach'});
    port.onDisconnect.addListener(()=>{port=null;busy=false;quickAction=null;clearTimeout(hintDeadline);for(const item of chats.values())if(!item.job){clearTimeout(item.deadline);item.status='连接中断，尚未确认问题已保存；请重试或刷新本题对话核对。';}renderChats();$('launch').disabled=false;$('launch').textContent='快捷保存';$('hintLaunch').disabled=false;$('chatSend').disabled=false;$('run').disabled=false;state('页面连接已断开，请刷新；已确认保存的后台任务仍会继续。');});
    port.onMessage.addListener(async msg=>{
      if(msg.type==='auto_site_cache_status'){
        if(msg.status==='cleaned'){
          lastCacheWarning='';
          const message=`已自动备份并清理 ${msg.cleared} 条题面/题集缓存，约释放 ${(msg.estimatedBytes/1024).toFixed(1)} KB。源码和草稿保留，可继续写代码。`;
          $('cacheStatus').textContent=message;
        }else if(msg.status==='blocked')cacheWarning(`自动清理暂未完成：${msg.error}`);
        else if(msg.status==='no_safe_cache')cacheWarning('网站出现容量错误，但没有可安全清理的题面缓存。代码和草稿未删除；请先另存当前代码。');
        return;
      }
      if(msg.type==='site_cache_cleared'){
        $('clearSiteCache').disabled=false;$('clearSiteCacheDetails').disabled=false;
        const message=msg.cleared?`已备份并清理 ${msg.cleared} 条题面/题集缓存，约释放 ${(msg.estimatedBytes/1024).toFixed(1)} KB。代码、草稿、提交和登录信息保留；先备份当前未保存代码，再刷新题目页。${msg.changed?' 清理期间变化的缓存已保留。':''}`:'没有可清理的题面/题集缓存，其他数据保持原样。';
        $('cacheStatus').textContent=message;toast(message);return;
      }
      if(msg.type==='site_cache_export'){
        const url=URL.createObjectURL(new Blob([msg.text],{type:'application/json;charset=utf-8'}));
        const link=document.createElement('a');link.href=url;link.download='北大题面缓存-清理前备份.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),30000);return;
      }
      if(msg.type==='discussion_preview'){
        const item=chats.get(msg.actionId);if(!item)return;
        clearTimeout(item.deadline);item.status='本地即时回复；正在保存并安排深入分析。';
        item.preview=globalThis.PkuInstantHints?.discuss(msg.capture,msg.question,msg.selectedCode).markdown;
        $('chatSend').disabled=false;renderChats();return;
      }
      if(msg.type==='discussion_history'){
        for(const job of msg.entries)updateChat(job,job.eventId);
        $('chatState').textContent=msg.total?`本题已有 ${msg.total} 轮已保存交流。`:'本题暂未保存交流，可以开始提问。';return;
      }
      if(msg.type==='hint_preview'){
        if(msg.actionId!==hintAction)return;
        clearTimeout(hintDeadline);previewReceived=true;hintCapture=msg.capture;hintJudgment=msg.judgment||{};
        $('hintLaunch').disabled=false;
        $('hintVersion').textContent=`${hintCapture.title} · 针对刚读取的版本`;
        renderInstant();$('hintState').textContent=hintJudgment.status==='AC'?'当前版本有对应 AC，正在保存；无需等待排错提示。':'即时提示已生成，正在保存版本并安排后台分析。';
        return;
      }
      if(msg.type==='hint_status'){
        if(msg.kind==='discussion')updateChat(msg,msg.actionId);
        else if(currentHint?.id===msg.id&&msg.actionId===hintAction)showHint(msg);return;
      }
      if(msg.type==='draft_saved'){
        draftReply({requestId:msg.requestId,ok:true});
        $('draftStatus').textContent=`草稿已独立备份 · ${new Date(msg.updatedAt).toLocaleTimeString()}。不影响过程保存和后台报告。`;return;
      }
      if(msg.type==='draft_list'){
        draftRecord=msg.record;$('draftChoice').replaceChildren();
        for(const version of [...draftRecord.versions].reverse()){
          const option=document.createElement('option');option.value=version.id;option.textContent=`${new Date(version.updatedAt).toLocaleString()} · ${version.code.length} 字符`;$('draftChoice').append(option);
        }
        $('draftChoice').hidden=!draftRecord.versions.length;showDraft();
        if(!draftRecord.versions.length)$('draftStatus').textContent='本题暂未捕获自动草稿。旧的“保存过程版本”仍在原来的本机记录中。';
        return;
      }
      if(msg.type==='draft_restored'){$('draftStatus').textContent='已恢复到网站编辑器；恢复前屏幕上的代码也已备份。请核对后自行测试。';extract(false);return;}
      if(msg.type==='error'&&msg.requestType?.startsWith('draft_')){
        draftReply({requestId:msg.requestId,ok:false,error:msg.error});
        $('draftStatus').textContent=`草稿操作失败：${msg.error} 请先复制代码到本地文件。`;return;
      }
      if(msg.type==='capture'){
        capture=msg.capture;if(!capture){state('未读取到页面。');return;}
        candidates=capture.candidates||[];
        $('title').value=capture.title;
        for(const key of problemKeys)$(key).value=capture.problem?.[key] || (key==='description'&&!capture.problem?capture.statement||'':'');
        for(const [key,id] of Object.entries(runtimeFields))$(id).value=capture.runtime?.[key]||'';
        $('source').replaceChildren();
        for(const c of candidates){const option=document.createElement('option');option.textContent=c.label;option.value=c.source;$('source').append(option);}
        const settings=await chrome.storage.local.get(['preferredSource','standard']);
        const preferred=candidates.find(c=>c.source===settings.preferredSource);
        if(preferred)$('source').value=preferred.source;
        port.postMessage({type:'observe',source:$('source').value});
        $('code').value=(preferred||candidates[0])?.value||'';
        if(settings.standard)$('standard').value=settings.standard;
        $('run').disabled=false;
        state(candidates.length===0?'没有找到可完整读取的编辑器。请先粘贴代码；不要选择题目样例。':candidates.length>1?'发现多个代码缓冲区，请选中自己的代码。':'已读取代码。请核对题面、输入范围和代码完整性。');
        if(capture.missingSections?.length)state('题目部分已分开；部分栏目未能识别，请展开核对后补全。运行信息会单独保存。');
        if(capture.statementTruncated){state('题面过长已截断，请手动精简并核对后再分析。');return;}
        $('preview').open=true;
      }else if(msg.type==='saved') {
        updateJob(msg);
        if(msg.requestType==='discuss'&&chats.has(msg.actionId)){
          $('chatSend').disabled=false;const item=chats.get(msg.actionId);clearTimeout(item.deadline);
          if(msg.hint)updateChat(msg.hint,msg.actionId);
          else{item.status=`源码已保存，但问题未确认保存：${msg.hintError||'请重试'}`;renderChats();}
          if(msg.hintWorkerError)$('chatState').textContent=`问题和源码已保存，后台未启动：${msg.hintWorkerError}`;
        }
        if(msg.requestType==='quick_save'&&msg.actionId===quickAction){
          quickAction=null;$('launch').disabled=false;$('launch').textContent='快捷保存';
          toast(msg.workerError?`当前版本已保存；后台启动失败：${msg.workerError}`:'当前版本已保存并安排后台分析，可以继续写代码。');
        }
        if(msg.requestType==='hint'&&msg.actionId===hintAction){
          $('hintLaunch').disabled=false;
          if(msg.hint)showHint(msg.hint);
          if(msg.hintError||msg.hintWorkerError)$('hintState').textContent=`版本已保存，本地即时提示仍可查看；深入提示未启动：${msg.hintError||msg.hintWorkerError}`;
        }
        if(['save','analyze'].includes(msg.requestType)){
          busy=false;$('run').disabled=false;$('refresh').disabled=false;
          if($('note').value===pendingNote)$('note').value='';
          state(msg.workerError?`已保存。后台启动失败：${msg.workerError}`:msg.status==='complete'?'这个版本已保存，报告已完成。可以继续保存其他代码。':'已保存，报告正在后台排队生成。可以继续保存其他代码、切换题目或关闭标签页。');
        }
        if(msg.requestType==='submission')$('archiveState').textContent='已独立保存本次提交，等待它的评测结果。';
        if(msg.requestType==='finish')$('archiveState').textContent='已记录与提交代码对应的 AC。正在后台整理最终 README 和 debug 总结，过程保存可继续使用。';
        port.postMessage({type:'problem'});
      }else if(msg.type==='recent') {for(const job of msg.records)updateJob(job);}
      else if(msg.type==='problem_status')updateProblem(msg);
      else if(msg.type==='verdict_saved'){port.postMessage({type:'problem'});$('archiveState').textContent='已记录本次评测结果；继续修改后可以再次提交。';}
      else if(msg.type==='review_status') {
        updateJob(msg);
        if(selectedReportId===msg.id) {
          if(msg.status==='complete'){lastReport=msg.analysis;globalThis.PkuReportRenderer?.render($('report'),lastReport,globalThis.katex);$('report').hidden=false;$('download').hidden=false;$('reportStatus').textContent=`${msg.title} · ${msg.id.slice(0,7)}`;}
          else $('reportStatus').textContent=msg.status==='failed'?`报告失败：${msg.error||'可点击重试'}`:'这份报告尚在后台生成，保存其他代码不受影响。';
        }
      }else if(msg.type==='error') {
        if(msg.requestType==='auto_site_cache'){cacheWarning(`自动检查暂不可用：${msg.error}`);return;}
        if(['clear_site_cache','export_site_cache'].includes(msg.requestType)){$('clearSiteCache').disabled=false;$('clearSiteCacheDetails').disabled=false;$('cacheStatus').textContent=msg.error;toast(msg.error);return;}
        if(msg.requestType==='discuss'&&chats.has(msg.actionId)){
          const item=chats.get(msg.actionId);clearTimeout(item.deadline);item.status=`未确认保存：${msg.error}`;$('chatSend').disabled=false;renderChats();
        }else if(['hint_status','hint_retry'].includes(msg.requestType)&&chats.has(msg.actionId)){$('chatState').textContent=msg.error;}
        else if(msg.requestType==='discussion_history')$('chatState').textContent=msg.error;
        else if(msg.requestType==='quick_save'&&msg.actionId===quickAction){quickAction=null;$('launch').disabled=false;$('launch').textContent='快捷保存';toast(`尚未确认保存：${msg.error}`);}
        else if(['hint','hint_status','hint_retry'].includes(msg.requestType)&&msg.actionId===hintAction){clearTimeout(hintDeadline);$('hintLaunch').disabled=false;$('hintState').textContent=`${previewReceived?'即时提示仍可查看；':''}后台操作失败：${msg.error}`;}
        else if(!msg.requestType||['save','analyze'].includes(msg.requestType)){busy=false;$('run').disabled=false;$('refresh').disabled=false;state(msg.error);}
        else if(['submission','accepted','judged','finish','verdict','retry_archive'].includes(msg.requestType))$('archiveState').textContent=msg.error;
        else $('reportStatus').textContent=msg.error;
      }
    });
    port.postMessage({type:'recent'});
    port.postMessage({type:'problem'});
    port.postMessage({type:'auto_site_cache'});
  }
  function extract(){if(busy)return;connect();state('正在读取题目和编辑器…');$('run').disabled=true;port.postMessage({type:'extract'});}
  async function run(){
    if(busy||!capture)return;
    const problem=Object.fromEntries(problemKeys.map(key=>[key,$(key).value]));
    const runtime=Object.fromEntries(Object.entries(runtimeFields).map(([key,id])=>[key,$(id).value]));
    if($('code').value.trim().length<5||Object.values(problem).join('\n').trim().length<20){state('需要题目各部分和自己的代码。');return;}
    busy=true;$('run').disabled=true;$('refresh').disabled=true;
    chrome.storage.local.set({preferredSource:$('source').value,standard:$('standard').value}).catch(()=>{});
    state('正在保存到本机…');
    pendingNote=$('note').value;
    port.postMessage({type:'save',note:pendingNote,capture:{url:capture.url,title:$('title').value,problem,runtime,code:$('code').value,standard:$('standard').value}});
  }
  $('launch').onclick=()=>action('quick_save');
  $('hintLaunch').onclick=()=>action('hint');
  $('chatLaunch').onclick=()=>{$('chatPanel').hidden=false;$('hintPanel').hidden=true;$('toast').hidden=true;$('panel').hidden=true;connect();port.postMessage({type:'discussion_history'});};
  $('chatClose').onclick=()=>{$('chatPanel').hidden=true;};
  const clearCache=()=>{connect();$('clearSiteCache').disabled=true;$('clearSiteCacheDetails').disabled=true;$('cacheStatus').textContent='正在备份并核对缓存，备份成功后才清理…';toast('正在备份并清理可重新下载的题面缓存…');port.postMessage({type:'clear_site_cache'});};
  $('clearSiteCache').onclick=clearCache;$('clearSiteCacheDetails').onclick=clearCache;
  $('exportSiteCache').onclick=()=>{connect();port.postMessage({type:'export_site_cache'});};
  $('chatHistory').onclick=()=>{connect();port.postMessage({type:'discussion_history'});};
  $('chatSend').onclick=()=>{
    const question=$('chatQuestion').value.trim();if(!question||$('chatSend').disabled)return;
    const actionId=crypto.randomUUID(),requestedAt=new Date().toISOString();
    const item={actionId,question,requestedAt};chats.set(actionId,item);$('chatQuestion').value='';$('chatSend').disabled=true;renderChats();connect();
    item.deadline=setTimeout(()=>{if(!item.job&&!item.preview){item.status='未能在 4.5 秒内读取完整代码；已结束等待，后台请求仍会继续。';$('chatSend').disabled=false;renderChats();}},4500);
    port.postMessage({type:'discuss',actionId,question,requestedAt});
  };
  const openDetails=()=>{$('hintPanel').hidden=true;$('chatPanel').hidden=true;$('panel').hidden=false;extract();};
  $('openRecords').onclick=openDetails;$('hintDetails').onclick=openDetails;
  $('hintClose').onclick=()=>{$('hintPanel').hidden=true;};
  $('hintRetry').onclick=()=>{if(currentHint){connect();port.postMessage({type:'hint_retry',id:currentHint.id,actionId:hintAction});}};
  $('draftList').onclick=()=>{
    if(!draftAccount){$('draftStatus').textContent='请先在本题点击平台“编辑修改”，等待草稿保护就绪。';return;}
    connect();port.postMessage({type:'draft_list',account:draftAccount});
  };
  $('draftChoice').onchange=showDraft;
  $('restoreDraft').onclick=()=>{connect();port.postMessage({type:'draft_restore',account:draftAccount,versionId:$('draftChoice').value});};
  $('downloadDraft').onclick=()=>{
    const url=URL.createObjectURL(new Blob([$('draftCode').value],{type:'text/plain;charset=utf-8'}));
    const a=document.createElement('a');a.href=url;a.download='本题草稿.cpp';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  $('close').onclick=()=>{$('panel').hidden=true;};
  $('run').onclick=run;$('refresh').onclick=()=>extract(false);
  $('source').onchange=()=>{$('code').value=candidates.find(c=>c.source===$('source').value)?.value||'';chrome.storage.local.set({preferredSource:$('source').value}).catch(()=>{});connect();port.postMessage({type:'observe',source:$('source').value});};
  $('download').onclick=()=>{const url=URL.createObjectURL(new Blob([lastReport],{type:'text/markdown;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='C++作业复盘.md';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
  document.addEventListener('pku-coach-submitted',event=>{connect();port.postMessage({type:'submission',receipt:event.detail,note:$('note').value,standard:$('standard').value});});
  document.addEventListener('pku-coach-judged',event=>{connect();port.postMessage({type:'judged',accepted:event.detail});});
  document.addEventListener('pku-coach-draft-ready',event=>{draftAccount=String(event.detail?.account||'');});
  document.addEventListener('pku-coach-draft-save',event=>{
    try{connect();port.postMessage({type:'draft_save',requestId:event.detail.requestId,draft:event.detail.draft});}
    catch(error){draftReply({requestId:event.detail?.requestId,ok:false,error:error.message});}
  });
  document.addEventListener('pku-coach-draft-notice',event=>{
    $('draftStatus').textContent=String(event.detail?.message||'');
    if(event.detail?.kind==='cache')toast(String(event.detail.message));
    // A failed backup needs a visible warning even while the report panel is shut.
    if(['error','changed'].includes(event.detail?.kind)){$('panel').hidden=false;$('draftPreview').open=true;}
  });
  document.addEventListener('pku-coach-storage-pressure',()=>{try{connect();port.postMessage({type:'auto_site_cache',reason:'pressure'});}catch{}});
  setInterval(()=>{if(port)port.postMessage({type:'auto_site_cache'});},30000);
  setInterval(()=>{if(port){for(const job of jobs.values())if(['queued','pending','running'].includes(job.status))port.postMessage({type:'review',id:job.id});port.postMessage({type:'problem'});}},5000);
  setInterval(()=>{if(port&&currentHint&&['queued','running'].includes(currentHint.status))port.postMessage({type:'hint_status',id:currentHint.id,actionId:hintAction});},1000);
  setInterval(()=>{if(port)for(const item of chats.values())if(item.job&&['queued','running'].includes(item.job.status))port.postMessage({type:'hint_status',id:item.job.id,actionId:item.actionId});},300);
  connect();
})();
