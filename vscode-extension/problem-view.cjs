const vscode=require('vscode'),fs=require('node:fs/promises'),{randomUUID}=require('node:crypto');
const {identity}=require('./problem-navigation.cjs');
const {ProblemTimers}=require('./problem-timers.cjs');
class ProblemView{
  constructor(context){
    this.timers=new ProblemTimers(context,{onState:state=>this.view?.webview.postMessage({type:'timer_state',state}),onTimes:value=>this.view?.webview.postMessage(value)});
    this.progress={type:'problem_progress',items:[]};
    this.context=context;this.latest={status:'waiting',connected:false};
    this.navigationState={type:'problem_navigation',problems:[],busy:false,message:'连接网页后自动读取本次作业题单。'};this.navigationSequence=0;
    context.subscriptions.push(vscode.window.registerWebviewViewProvider('gridCoach.problemStatement',this));
    context.subscriptions.push({dispose:()=>{this.disposed=true;clearTimeout(this.followTimer);}});
  }
  async resolveWebviewView(view){
    this.view=view;const nonce=randomUUID().replaceAll('-',''),webview=view.webview;
    const uri=file=>webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri,file)).toString();
    webview.options={enableScripts:true,localResourceRoots:[this.context.extensionUri]};
    const scripts=['media/vendor/marked/marked.umd.js','media/vendor/katex/katex.min.js','media/report-renderer.js','problem-view.js','study-timer.js','problem-navigation.js','assignment-closing.js'];
    webview.html='<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+
      `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource}; img-src data:; connect-src 'none';">`+
      `<link rel="stylesheet" href="${uri('media/vendor/katex/katex.min.css')}"><link rel="stylesheet" href="${uri('problem-view.css')}"></head><body>`+
      '<section class="study-timer" aria-label="做题计时"><div class="timer-tabs"><button id="timerStopwatch" aria-pressed="true">秒表</button><button id="timerCountdown" aria-pressed="false">倒计时</button></div><div class="timer-readout"><span id="timerScopeLabel">本题</span><div id="timerDisplay" class="timer-display" role="timer" aria-live="off">00:00:00</div></div><button id="timerStart" disabled>开始</button><details class="timer-settings"><summary aria-label="计时设置" title="计时范围与设置">⋯</summary><div class="timer-popover"><label>计时范围 <select id="timerScope"><option value="problem">本题</option><option value="assignment">整套题单</option></select></label><div id="timerDuration" class="timer-duration" hidden><label>分钟 <input id="timerMinutes" type="number" min="0" max="10080" step="1" value="25"></label><label>秒 <input id="timerSeconds" type="number" min="0" max="59" step="1" value="0"></label></div><button id="timerReset" disabled>归零 / 重置显示</button><p id="timerStatus" role="status">正在恢复计时器…</p></div></details></section>'+
      '<header><span class="eyebrow">编程网格 · 题面</span><h1 id="title">等待浏览器打开题目</h1><p id="state" role="status">Chrome 打开编程网格具体题目的 IDE 后，这里会自动显示。</p></header><main id="sections"></main>'+
      '<section class="problem-navigation" aria-label="作业题目列表"><div class="navigation-heading"><strong>本次作业</strong><span id="problemCount"></span><button id="assignmentTimer" title="查看整套题单计时">整套计时</button><button id="problemRefresh" disabled>刷新</button></div><p id="assignmentClosing" class="assignment-closing" role="status">题集截止时间尚未读取</p><div class="navigation-actions"><button id="problemPrevious" disabled>上一题</button><button id="problemNext" disabled>下一题</button></div><details open><summary>题目列表</summary><input id="problemSearch" type="search" placeholder="搜索题名或序号" aria-label="搜索题目"><ol id="problemList"></ol></details><p id="navigationStatus" role="status">连接网页后自动读取题单。</p></section>'+
      '<footer><p id="problemUrl" class="problem-source-url" hidden></p><button id="openProblem" hidden>在浏览器查看原题</button><p>题面自动显示；状态栏可打开网格·评测、提示与交流。</p></footer>'+
      scripts.map(file=>`<script nonce="${nonce}" src="${uri(file)}"></script>`).join('')+'</body></html>';
    this.context.subscriptions.push(view.onDidDispose(()=>{if(this.view===view)this.view=null;}),webview.onDidReceiveMessage(async message=>{
      if(message.type==='closing_ready'){await webview.postMessage(this.latest);return webview.postMessage(this.navigationState);}
      if(message.type==='navigation_ready'){
        await webview.postMessage(this.navigationState);
        if(this.latest.connected&&this.latest.status==='ready'&&this.listedUrl!==this.latest.url)await this.refreshNavigation();return;
      }
      if(message.type==='refresh_problems'){if(message.problemUrl===this.latest.url)await this.refreshNavigation({forceDeadline:true});else await this.postNavigation({busy:false,message:'当前题目已更新，请再次刷新。'});return;}
      if(message.type==='switch_problem'){
        if(this.navigation?.switching||this.navigationState.busy)return;
        try{await this.switchProblem(message.problemUrl,message.targetUrl);}catch(error){await this.postNavigation({message:error.message});}
        return;
      }
      if(message.type==='progress_ready'){await webview.postMessage(this.progress);return webview.postMessage(this.timers.timeSnapshot());}
      if(message.type==='timer_ready')return this.timers.publishState();
      if(message.type==='timer_action'){
        try{await this.timers.handle(message);}catch(error){await webview.postMessage({type:'timer_error',error:error.message});}
        return;
      }
      if(message.type==='ready')return webview.postMessage(this.latest);
      if(message.type==='open_problem'&&this.latest.url)return vscode.env.openExternal(vscode.Uri.parse(this.latest.url));
      if(message.type==='copy_sample'&&typeof message.text==='string'&&message.text.length<=20000)await vscode.env.clipboard.writeText(message.text);
    }));
  }
  async switchProblem(problemUrl,targetUrl){
    if(!this.navigation||this.navigation.switching||this.navigationState.busy)throw new Error('正在读取或切换题目，请稍候。');
    if(problemUrl!==this.latest.url||!this.navigationState.problems.some(item=>item.url===targetUrl))throw new Error('列表已过期，请刷新后选题。');
    ++this.navigationSequence;await this.postNavigation({busy:true,message:'正在切换题目与源码…'});
    try{
      const result=await this.navigation.activate(problemUrl,targetUrl,this.navigationState.problems.find(item=>item.url===targetUrl));
      if(result.cancelled){await this.postNavigation({busy:false,message:'已取消切题。'});return;}
      this.listedUrl=result.url;
      await this.accept({type:'problem_display',connected:true,status:'ready',url:result.url,tabId:result.tabId,page:result.page,revision:randomUUID()});
      await this.postNavigation({busy:false,message:'已切换题目并打开对应源码。'});
    }catch(error){await this.postNavigation({busy:false,message:error.message});throw error;}
  }
  async adjacent(direction){
    if(!this.latest.connected||this.latest.status!=='ready')throw new Error('请先连接编程网格 IDE。');
    if(this.navigationState.problemUrl!==this.latest.url||!this.navigationState.problems.length)await this.refreshNavigation();
    const problems=this.navigationState.problems,index=problems.findIndex(item=>identity(item.url)?.key===identity(this.latest.url)?.key),target=problems[index+direction];
    if(index<0||!target)throw new Error(index<0?'当前题目不在列表中，请刷新题单。':direction<0?'已经是第一题。':'已经是最后一题。');
    return this.switchProblem(this.latest.url,target.url);
  }
  async acceptProgress(value){this.progress=value;if(this.view)await this.view.webview.postMessage(value);}
  async accept(value){
    const duplicate=this.latest.revision===value.revision&&this.latest.connected===value.connected;
    this.latest=value;if(value.status==='ready'&&value.url)await this.timers.setProblem(value.url);if(this.view)await this.view.webview.postMessage(value);
    if(this.navigationState.problemUrl!==value.url)await this.postNavigation({});
    if(value.connected&&value.status==='ready'&&this.listedUrl!==value.url&&!this.navigation?.switching)void this.refreshNavigation();
    if(!duplicate&&value.connected&&['ready','loading'].includes(value.status))await this.show();
    if(value.connected&&value.status==='ready')this.scheduleSourceFollow();
  }
  scheduleSourceFollow(){
    clearTimeout(this.followTimer);
    this.followTimer=setTimeout(()=>{void this.followSource();},120);
  }
  async followSource(){
    if(this.disposed||!this.navigation)return;
    if(this.navigation.switching){this.scheduleSourceFollow();return;}
    const value=this.latest,target=identity(value.url);
    if(!value.connected||value.status!=='ready'||!target||this.navigation.followedKey===target.key)return;
    try{
      const problem=this.navigationState.problems.find(item=>identity(item.url)?.key===target.key)||{title:value.page?.title};
      const result=await this.navigation.followDisplay(value,problem);
      if(result?.opened&&identity(this.latest.url)?.key===target.key)await this.postNavigation({message:'已跟随网页切题，打开本题源码。'});
    }catch(error){
      if(identity(this.latest.url)?.key===target.key)await this.postNavigation({message:'自动打开源码未完成：'+error.message+'；可从题单再次选择此题。'});
    }finally{
      if(!this.disposed&&identity(this.latest.url)?.key!==target.key)this.scheduleSourceFollow();
      if(!this.disposed&&this.latest.connected&&this.latest.status==='ready'&&this.listedUrl!==this.latest.url)void this.refreshNavigation();
    }
  }
  async postNavigation(patch){
    const group=url=>{try{return new URL(url).pathname.match(/\/probset\/([a-f0-9]{32})\//i)?.[1]?.toLowerCase();}catch{return undefined;}};
    const oldGroup=group(this.navigationState.problemUrl),newGroup=group(this.latest.url);
    if(oldGroup!==newGroup&&!Object.hasOwn(patch,'closesAt'))patch={...patch,closesAt:this.context.workspaceState.get('gridCoach.assignmentDeadlines.v1',{})[newGroup]??null};
    const problems=(patch.problems||this.navigationState.problems).filter(item=>group(item.url)===group(this.latest.url));
    this.navigationState={...this.navigationState,...patch,problems,type:'problem_navigation',problemUrl:this.latest.url};
    if(this.view)await this.view.webview.postMessage(this.navigationState);
  }
  async refreshNavigation({forceDeadline=false}={}){
    if(!this.navigation||this.navigation.switching)return;
    const url=this.latest.url;if(!url)return;
    const sequence=++this.navigationSequence;this.listedUrl=url;
    await this.postNavigation({busy:true,message:'正在读取网页题目列表…'});
    try{
      const [result,progress]=await Promise.all([this.navigation.list(url,forceDeadline),this.navigation.progress(url).catch(()=>null)]);
      if(sequence!==this.navigationSequence||url!==this.latest.url)return;
      if(progress)await this.acceptProgress(progress);
      const group=new URL(url).pathname.match(/\/probset\/([a-f0-9]{32})\//i)?.[1]?.toLowerCase();
      if(group){
        const saved={...this.context.workspaceState.get('gridCoach.assignmentDeadlines.v1',{})};
        if(Number.isFinite(result.closesAt))saved[group]=result.closesAt;else delete saved[group];
        await this.context.workspaceState.update('gridCoach.assignmentDeadlines.v1',saved);
      }
      if(sequence!==this.navigationSequence||url!==this.latest.url)return;
      await this.postNavigation({problems:result.problems,closesAt:result.closesAt??null,busy:false,message:result.message||'按网站顺序排列；点击题目切换。'});
    }catch(error){if(sequence===this.navigationSequence)await this.postNavigation({busy:false,message:error.message});}
  }
  async show(){
    if(this.view)this.view.show(true);
    else await vscode.commands.executeCommand('gridCoach.problemStatement.focus',{preserveFocus:true});
  }
}
module.exports={ProblemView};
