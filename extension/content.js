(() => {
  if(document.getElementById('pku-coach-root'))return;
  const host=document.createElement('div');host.id='pku-coach-root';document.documentElement.append(host);
  const ui=host.attachShadow({mode:'closed'});
  ui.innerHTML=`<style>
    :host{all:initial}*{box-sizing:border-box}button,select,textarea{font:inherit}button{cursor:pointer;border:1px solid #cad5e3;border-radius:7px;padding:8px 12px;background:white;color:#17324e}button:disabled{opacity:.55;cursor:wait}.primary{background:#135d85;color:white;border-color:#135d85}#launch{position:fixed;right:22px;bottom:22px;z-index:2147483647;box-shadow:0 4px 18px #0003;font:14px system-ui}
    #panel{position:fixed;right:20px;top:6vh;width:min(620px,92vw);height:84vh;z-index:2147483647;background:#f8fafc;color:#172f44;border:1px solid #c4d2df;border-radius:12px;box-shadow:0 12px 48px #0004;font:14px/1.6 system-ui;overflow:auto;padding:18px}#panel[hidden]{display:none}header{display:flex;justify-content:space-between;align-items:center}h2{font-size:19px;margin:0}label{display:block;margin:12px 0 5px}textarea{width:100%;resize:vertical;border:1px solid #b6c7d7;border-radius:6px;padding:9px;background:white;color:#102a43}#code{font-family:Consolas,monospace}#state{white-space:pre-wrap;color:#405d75;margin:12px 0}.row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.hint{font-size:12px;color:#526b80}#report{white-space:pre-wrap;overflow-wrap:anywhere;font:14px/1.75 system-ui;background:white;padding:14px;border-radius:8px}select{max-width:100%;padding:6px}
    </style><style>
    #report{overflow-wrap:anywhere;font:14px/1.8 system-ui;background:white;padding:22px 24px;border:1px solid #e1eaf1;border-radius:10px;color:#23384b}
    #report h2,#report h3,#report h4,#report h5{color:#154f73;line-height:1.4;margin:1.45em 0 .55em}
    #report h2{font-size:18px;border-bottom:1px solid #d9e5ee;padding-bottom:7px}
    #report h3{font-size:16px}#report p{margin:.65em 0}
    #report ul,#report ol{padding-left:1.6em;margin:.5em 0 1em}#report li{padding-left:.2em;margin:.3em 0}
    #report blockquote{margin:.8em 0;padding:.35em .9em;border-left:3px solid #82b6d2;background:#f2f8fb;color:#405d75}
    #report .report-code{position:relative;margin:1em 0;padding:14px 16px;overflow:auto;border-radius:8px;background:#f2f5f8;color:#16324a;font:13px/1.65 Consolas,monospace;white-space:pre-wrap}
    #report .report-code[data-language]::before{content:attr(data-language);display:block;margin:-3px 0 8px;color:#6a8194;font:11px/1.2 system-ui;text-transform:uppercase}
    #report .math-inline{padding:0 .12em;color:#123e5c}
    #report .math-block{margin:1em -4px;padding:14px 10px;overflow-x:auto;text-align:center;border-radius:8px;background:#f5f9fc;color:#123e5c}
    #report .katex-display{margin:.25em 0}
    </style><button id="launch" class="primary">保存并后台分析</button><section id="panel" hidden><header><h2>C++ 学习教练</h2><button id="close">收起</button></header>
    <div id="state">正在读取题目和编辑器…</div><details id="preview" open><summary>核对题目各部分和自己的代码</summary><div class="hint">首次先核对。报告由本机 Codex 登录会话生成，会使用 Codex 额度。</div><label>题目名称</label><textarea id="title" rows="1"></textarea><label>题目描述</label><textarea id="description" rows="6"></textarea><label>关于输入</label><textarea id="input" rows="4"></textarea><label>关于输出</label><textarea id="output" rows="4"></textarea><label>例子输入</label><textarea id="sampleInput" rows="4" spellcheck="false"></textarea><label>例子输出</label><textarea id="sampleOutput" rows="4" spellcheck="false"></textarea><label>代码来源</label><select id="source"></select><textarea id="code" rows="12" spellcheck="false"></textarea><label>语言标准</label><select id="standard"><option>c++17</option><option>c++11</option><option>c++14</option><option>c++20</option></select></details>
    <details id="runtimePreview"><summary>运行界面（单独保存）</summary><p class="hint">读取页面已有的运行信息；没有运行结果时保持空白。</p><label>运行输入</label><textarea id="runInput" rows="3" spellcheck="false"></textarea><label>执行输出</label><textarea id="runOutput" rows="3" spellcheck="false"></textarea><label>提示信息</label><textarea id="runHints" rows="3" spellcheck="false"></textarea><label>错误信息</label><textarea id="runError" rows="3" spellcheck="false"></textarea><label>运行状态</label><textarea id="runStatus" rows="1"></textarea><label>运行界面文本</label><textarea id="runText" rows="5" spellcheck="false"></textarea></details>
    <label>本次修改 / debug 备注（选填）</label><textarea id="note" rows="2" placeholder="例如：空字符串时越界，增加了长度检查"></textarea>
    <p><label class="hint"><input id="quick" type="checkbox">记住此页面类型的代码来源，下次点击直接保存（题面仍可展开核对）</label></p><div class="row"><button id="run" class="primary" disabled>保存过程版本</button><button id="refresh">重新读取</button><button id="download" hidden>下载报告</button></div><p class="hint">过程版本保存在本机；报告后台生成，每周日 20:00 汇总。</p><details><summary>本题修改与提交记录（本地）</summary><div id="attempts">暂无记录</div></details><details open><summary>最终归档（仅保存在本机）</summary><div id="archiveState" class="hint">检测到本次提交 AC 后，在本机单独生成最终代码、README 和 debug 总结。归档期间仍可保存和修改代码。</div><div id="archives"></div></details><details open><summary>后台报告</summary><div id="jobs">暂无保存记录</div></details><div id="reportStatus" class="hint"></div><article id="report" hidden></article></section>`;
  const katexStyle=document.createElement('link');
  katexStyle.rel='stylesheet';
  katexStyle.href=chrome.runtime.getURL('vendor/katex/katex.min.css');
  ui.prepend(katexStyle);
  const $=id=>ui.getElementById(id);
  const problemKeys=['description','input','output','sampleInput','sampleOutput'];
  const runtimeFields={input:'runInput',output:'runOutput',hints:'runHints',error:'runError',status:'runStatus',text:'runText'};
  let port,capture=null,candidates=[],busy=false,lastReport='',autoRun=false,pendingNote='';
  const jobs=new Map();let selectedReportId=null;
  const state=text=>{$('state').textContent=text;};
  function updateProblem(problem) {
    const kinds={draft:'过程保存',submission:'提交评测',ac:'通过 AC',legacy:'旧版保存'};
    $('attempts').replaceChildren();
    for(const a of problem.attempts.slice(-30).reverse()) {
      const row=document.createElement('div');row.textContent=`#${a.number} ${kinds[a.kind]||a.kind} · ${a.codeHash?.slice(0,8)||''}${a.verdict?' · '+a.verdict.status:''}${a.note?' · '+a.note:''}`;$('attempts').append(row);
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
    port.onDisconnect.addListener(()=>{port=null;busy=false;$('run').disabled=false;state('页面连接已断开，请刷新；已确认保存的后台任务仍会继续。');});
    port.onMessage.addListener(async msg=>{
      if(msg.type==='capture'){
        capture=msg.capture;if(!capture){state('未读取到页面。');return;}
        candidates=capture.candidates||[];
        $('title').value=capture.title;
        for(const key of problemKeys)$(key).value=capture.problem?.[key] || (key==='description'&&!capture.problem?capture.statement||'':'');
        for(const [key,id] of Object.entries(runtimeFields))$(id).value=capture.runtime?.[key]||'';
        $('source').replaceChildren();
        for(const c of candidates){const option=document.createElement('option');option.textContent=c.label;option.value=c.source;$('source').append(option);}
        const settings=await chrome.storage.local.get(['preferredSource','quick']);
        const preferred=candidates.find(c=>c.source===settings.preferredSource);
        if(preferred)$('source').value=preferred.source;
        port.postMessage({type:'observe',source:$('source').value});
        $('code').value=(preferred||candidates[0])?.value||'';
        $('quick').checked=Boolean(settings.quick);
        $('run').disabled=false;
        state(candidates.length===0?'没有找到可完整读取的编辑器。请先粘贴代码；不要选择题目样例。':candidates.length>1?'发现多个代码缓冲区，请选中自己的代码。':'已读取代码。请核对题面、输入范围和代码完整性。');
        if(capture.missingSections?.length)state('题目部分已分开；部分栏目未能识别，请展开核对后补全。运行信息会单独保存。');
        if(capture.statementTruncated){state('题面过长已截断，请手动精简并核对后再分析。');return;}
        if(autoRun&&settings.quick&&preferred&&candidates.length===1&&!capture.needsVerification&&capture.statement.length>=20){autoRun=false;run();}else{$('preview').open=true;autoRun=false;}
      }else if(msg.type==='saved') {
        updateJob(msg);
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
        if(!msg.requestType||['save','analyze'].includes(msg.requestType)){busy=false;$('run').disabled=false;$('refresh').disabled=false;state(msg.error);}
        else if(['submission','accepted','judged','finish','verdict','retry_archive'].includes(msg.requestType))$('archiveState').textContent=msg.error;
        else $('reportStatus').textContent=msg.error;
      }
    });
    port.postMessage({type:'recent'});
    port.postMessage({type:'problem'});
  }
  function extract(quick=false){if(busy)return;connect();autoRun=quick;state('正在读取题目和编辑器…');$('run').disabled=true;port.postMessage({type:'extract'});}
  async function run(){
    if(busy||!capture)return;
    const problem=Object.fromEntries(problemKeys.map(key=>[key,$(key).value]));
    const runtime=Object.fromEntries(Object.entries(runtimeFields).map(([key,id])=>[key,$(id).value]));
    if($('code').value.trim().length<5||Object.values(problem).join('\n').trim().length<20){state('需要题目各部分和自己的代码。');return;}
    busy=true;$('run').disabled=true;$('refresh').disabled=true;
    chrome.storage.local.set({quick:$('quick').checked,preferredSource:$('source').value}).catch(()=>{});
    state('正在保存到本机…');
    pendingNote=$('note').value;
    port.postMessage({type:'save',note:pendingNote,capture:{url:capture.url,title:$('title').value,problem,runtime,code:$('code').value,standard:$('standard').value}});
  }
  $('launch').onclick=()=>{$('panel').hidden=false;extract(true);};
  $('close').onclick=()=>{$('panel').hidden=true;};
  $('run').onclick=run;$('refresh').onclick=()=>extract(false);
  $('source').onchange=()=>{$('code').value=candidates.find(c=>c.source===$('source').value)?.value||'';connect();port.postMessage({type:'observe',source:$('source').value});};
  $('download').onclick=()=>{const url=URL.createObjectURL(new Blob([lastReport],{type:'text/markdown;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='C++作业复盘.md';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
  document.addEventListener('pku-coach-submitted',event=>{connect();port.postMessage({type:'submission',receipt:event.detail,note:$('note').value,standard:$('standard').value});});
  document.addEventListener('pku-coach-judged',event=>{connect();port.postMessage({type:'judged',accepted:event.detail});});
  setInterval(()=>{if(port){for(const job of jobs.values())if(['queued','pending','running'].includes(job.status))port.postMessage({type:'review',id:job.id});port.postMessage({type:'problem'});}},5000);
  connect();
})();

