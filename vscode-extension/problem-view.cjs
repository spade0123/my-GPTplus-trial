const vscode=require('vscode'),fs=require('node:fs/promises'),{randomUUID}=require('node:crypto');
const {StudyTimer}=require('./study-timer.cjs');
class ProblemView{
  constructor(context){
    this.timer=new StudyTimer(context,state=>this.view?.webview.postMessage({type:'timer_state',state}));
    this.context=context;this.latest={status:'waiting',connected:false};
    this.navigationState={type:'problem_navigation',problems:[],busy:false,message:'连接网页后自动读取本次作业题单。'};this.navigationSequence=0;
    context.subscriptions.push(vscode.window.registerWebviewViewProvider('gridCoach.problemStatement',this));
  }
  async resolveWebviewView(view){
    this.view=view;const nonce=randomUUID().replaceAll('-',''),webview=view.webview;
    const uri=file=>webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri,file)).toString();
    webview.options={enableScripts:true,localResourceRoots:[this.context.extensionUri]};
    const scripts=['media/vendor/marked/marked.umd.js','media/vendor/katex/katex.min.js','media/report-renderer.js','problem-view.js','study-timer.js','problem-navigation.js'];
    webview.html='<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+
      `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource}; img-src data:; connect-src 'none';">`+
      `<link rel="stylesheet" href="${uri('media/vendor/katex/katex.min.css')}"><link rel="stylesheet" href="${uri('problem-view.css')}"></head><body>`+
      '<section class="study-timer" aria-label="做题计时"><div class="timer-tabs"><button id="timerStopwatch" aria-pressed="true">秒表</button><button id="timerCountdown" aria-pressed="false">倒计时</button></div><div id="timerDisplay" class="timer-display" role="timer" aria-live="off">00:00:00</div><div id="timerDuration" class="timer-duration" hidden><label>分钟 <input id="timerMinutes" type="number" min="0" max="10080" step="1" value="25"></label><label>秒 <input id="timerSeconds" type="number" min="0" max="59" step="1" value="0"></label></div><div class="timer-actions"><button id="timerStart" disabled>开始</button><button id="timerReset" disabled>归零 / 重置</button></div><p id="timerStatus" role="status">正在恢复计时器…</p></section>'+
      '<section class="problem-navigation" aria-label="作业题目列表"><div class="navigation-heading"><strong>本次作业</strong><span id="problemCount"></span><button id="problemRefresh" disabled>刷新</button></div><div class="navigation-actions"><button id="problemPrevious" disabled>上一题</button><button id="problemNext" disabled>下一题</button></div><details><summary>选择题目</summary><input id="problemSearch" type="search" placeholder="搜索题名或序号" aria-label="搜索题目"><ol id="problemList"></ol></details><p id="navigationStatus" role="status">连接网页后自动读取题单。</p></section>'+
      '<header><span class="eyebrow">编程网格 · 题面</span><h1 id="title">等待浏览器打开题目</h1><p id="state" role="status">Chrome 打开编程网格具体题目的 IDE 后，这里会自动显示。</p><button id="openProblem" hidden>在浏览器查看原题</button></header><main id="sections"></main><footer>题面自动显示；状态栏可打开网格·评测、提示与交流。</footer>'+
      scripts.map(file=>`<script nonce="${nonce}" src="${uri(file)}"></script>`).join('')+'</body></html>';
    this.context.subscriptions.push(view.onDidDispose(()=>{if(this.view===view)this.view=null;}),webview.onDidReceiveMessage(async message=>{
      if(message.type==='navigation_ready'){
        await webview.postMessage(this.navigationState);
        if(this.latest.connected&&this.latest.status==='ready'&&this.listedUrl!==this.latest.url)await this.refreshNavigation();return;
      }
      if(message.type==='refresh_problems'){if(message.problemUrl===this.latest.url)await this.refreshNavigation();else await this.postNavigation({busy:false,message:'当前题目已更新，请再次刷新。'});return;}
      if(message.type==='switch_problem'){
        if(!this.navigation||this.navigation.switching||this.navigationState.busy)return;
        if(message.problemUrl!==this.latest.url||!this.navigationState.problems.some(item=>item.url===message.targetUrl)){await this.postNavigation({busy:false,message:'列表已过期，请刷新后选题。'});return;}
        ++this.navigationSequence;await this.postNavigation({busy:true,message:'正在切换题目与源码…'});
        try{
          const result=await this.navigation.activate(message.problemUrl,message.targetUrl);
          if(result.cancelled){await this.postNavigation({busy:false,message:'已取消切题。'});return;}
          this.listedUrl=result.url;
          await this.accept({type:'problem_display',connected:true,status:'ready',url:result.url,tabId:result.tabId,page:result.page,revision:randomUUID()});
          await this.postNavigation({busy:false,message:'已切换题目并打开对应源码。'});
        }catch(error){await this.postNavigation({busy:false,message:error.message});}
        return;
      }
      if(message.type==='timer_ready')return webview.postMessage({type:'timer_state',state:this.timer.snapshot()});
      if(message.type==='timer_action'){
        try{await this.timer.handle(message);}catch(error){await webview.postMessage({type:'timer_error',error:error.message});}
        return;
      }
      if(message.type==='ready')return webview.postMessage(this.latest);
      if(message.type==='open_problem'&&this.latest.url)return vscode.env.openExternal(vscode.Uri.parse(this.latest.url));
      if(message.type==='copy_sample'&&typeof message.text==='string'&&message.text.length<=20000)await vscode.env.clipboard.writeText(message.text);
    }));
  }
  async accept(value){
    const duplicate=this.latest.revision===value.revision&&this.latest.connected===value.connected;
    this.latest=value;if(this.view)await this.view.webview.postMessage(value);
    if(value.connected&&value.status==='ready'&&this.listedUrl!==value.url&&!this.navigation?.switching)void this.refreshNavigation();
    if(!duplicate&&value.connected&&['ready','loading'].includes(value.status))await this.show();
  }
  async postNavigation(patch){
    const group=url=>{try{return new URL(url).pathname.match(/\/probset\/([a-f0-9]{32})\//i)?.[1]?.toLowerCase();}catch{return undefined;}};
    const problems=(patch.problems||this.navigationState.problems).filter(item=>group(item.url)===group(this.latest.url));
    this.navigationState={...this.navigationState,...patch,problems,type:'problem_navigation',problemUrl:this.latest.url};
    if(this.view)await this.view.webview.postMessage(this.navigationState);
  }
  async refreshNavigation(){
    if(!this.navigation||this.navigation.switching)return;
    const url=this.latest.url;if(!url)return;
    const sequence=++this.navigationSequence;this.listedUrl=url;
    await this.postNavigation({busy:true,message:'正在读取网页题目列表…'});
    try{
      const result=await this.navigation.list(url);
      if(sequence!==this.navigationSequence||url!==this.latest.url)return;
      await this.postNavigation({problems:result.problems,busy:false,message:result.message||'按网站顺序排列；点击题目切换。'});
    }catch(error){if(sequence===this.navigationSequence)await this.postNavigation({busy:false,message:error.message});}
  }
  async show(){
    if(this.view)this.view.show(true);
    else await vscode.commands.executeCommand('gridCoach.problemStatement.focus',{preserveFocus:true});
  }
}
module.exports={ProblemView};
