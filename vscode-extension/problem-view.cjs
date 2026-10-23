const vscode=require('vscode'),fs=require('node:fs/promises'),{randomUUID}=require('node:crypto');
class ProblemView{
  constructor(context,navigate,statistics,completion){
    this.context=context;this.navigate=navigate;this.statistics=statistics;this.completion=completion;this.completionSequence=0;this.latest={status:'waiting',connected:false};
    context.subscriptions.push(vscode.window.registerWebviewViewProvider('openjudgeCoach.problemStatement',this));
  }
  async resolveWebviewView(view){
    this.view=view;const nonce=randomUUID().replaceAll('-',''),webview=view.webview;
    this.context.subscriptions.push(view.onDidDispose(()=>{if(this.view===view){this.view=null;this.completionSequence++;}}));
    this.library=JSON.parse(await fs.readFile(vscode.Uri.joinPath(this.context.extensionUri,'problem-library.json').fsPath,'utf8'));
    if(this.view!==view)return;
    const uri=file=>webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri,file)).toString();
    webview.options={enableScripts:true,localResourceRoots:[this.context.extensionUri]};
    const scripts=['media/vendor/marked/marked.umd.js','media/vendor/katex/katex.min.js','media/report-renderer.js','problem-view.js'];
    webview.html='<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+
      `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource}; img-src data:; connect-src 'none';">`+
      `<link rel="stylesheet" href="${uri('media/vendor/katex/katex.min.css')}"><link rel="stylesheet" href="${uri('problem-view.css')}"></head><body>`+
      '<details id="library" open><summary>经典题库 · 337 题</summary><div class="library-filters"><input id="librarySearch" type="search" placeholder="搜索题号、题名、知识点" aria-label="搜索题库"><select id="libraryPlatform" aria-label="平台"><option value="">全部平台</option><option>百练</option><option>NOI</option></select><select id="libraryLevel" aria-label="按通过率划分难度"><option value="">全部难度</option><option value="1">基础 · ≥70%</option><option value="2">常规 · 50–70%</option><option value="3">进阶 · 30–50%</option><option value="4">较难 · &lt;30%</option></select></div><select id="libraryProblem" aria-label="选择题目"><option>正在载入题库…</option></select><div class="library-nav"><button id="previousProblem" disabled>上一题</button><span id="libraryPosition"></span><button id="nextProblem" disabled>下一题</button></div><p id="libraryState" role="status">难度按已保存的通过率快照划分；通过率越低，相对越难。两平台统计口径不同。</p></details>'+
      '<header><span class="eyebrow">OPENJUDGE · 原文题面</span><h1 id="title">等待打开题目</h1><div id="completion" hidden role="status"><strong id="completionBadge"></strong><span id="completionNote"></span></div><p id="state" role="status">从上方题库选择，或在 Chrome 打开百练 / NOI 题目。</p><button id="openProblem" hidden>在浏览器查看原题</button> <button id="showRate" hidden aria-expanded="false" aria-controls="ratePanel">查看通过率</button><div id="ratePanel" hidden role="status"><p id="rateState"></p><p id="rateBasis"></p><p id="rateChecked"></p><button id="refreshRate">刷新统计</button> <button id="openStatistics">官方统计页</button></div></header><main id="sections"></main><footer>题面保留原文；测试运行、提示和交流仍由右下角三个按钮操作。切题不改写源码。</footer>'+
      scripts.map(file=>`<script nonce="${nonce}" src="${uri(file)}"></script>`).join('')+'</body></html>';
    this.context.subscriptions.push(webview.onDidReceiveMessage(async message=>{
      if(message.type==='ready'){await webview.postMessage({type:'problem_library',...this.library});await webview.postMessage(this.latest);return this.refreshCompletion();}
      if(message.type==='library_open'){
        try{const result=await this.navigate(message.key);return webview.postMessage({...result,requestKey:message.key});}
        catch(e){return webview.postMessage({type:'library_error',requestKey:message.key,error:e.message});}
      }
      if(message.type==='open_problem'&&this.latest.url)return vscode.env.openExternal(vscode.Uri.parse(this.latest.url));
      if(message.type==='problem_statistics'&&message.url===this.latest.url&&this.latest.status==='ready'){
        try{const result=await this.statistics(message.url);return webview.postMessage({...result,requestId:message.requestId});}
        catch(e){return webview.postMessage({type:'problem_statistics',problemUrl:message.url,requestId:message.requestId,error:e.message});}
      }
      if(message.type==='open_statistics'&&this.latest.url)return vscode.env.openExternal(vscode.Uri.parse(this.latest.url+'statistics/'));
      if(message.type==='copy_sample'&&typeof message.text==='string'&&message.text.length<=20000)await vscode.env.clipboard.writeText(message.text);
    }));
  }
  async accept(value){
    const duplicate=this.latest.revision===value.revision&&this.latest.connected===value.connected;
    this.latest=value;if(this.view)await this.view.webview.postMessage(value);
    if(!duplicate&&value.connected&&['ready','loading'].includes(value.status))await this.show();
    await this.refreshCompletion(value.url);
  }
  async refreshCompletion(url=this.latest.url){
    if(!this.completion||!url||url!==this.latest.url||this.latest.status!=='ready')return;
    const sequence=++this.completionSequence;let result;
    try{result=await this.completion(url);}catch(error){result={type:'problem_completion',problemUrl:url,error:error.message};}
    if(sequence!==this.completionSequence||url!==this.latest.url||this.latest.status!=='ready')return;
    if(this.view)await this.view.webview.postMessage(result);
  }
  async show(focus=false){
    if(this.view)this.view.show(!focus);
    else await vscode.commands.executeCommand('openjudgeCoach.problemStatement.focus',{preserveFocus:!focus});
  }
  async openLibrary(){await this.show(true);await this.view?.webview.postMessage({type:'library_focus'});}
}
module.exports={ProblemView};
