const vscode=require('vscode'),fs=require('node:fs/promises'),path=require('node:path'),{randomUUID}=require('node:crypto'),{execFile}=require('node:child_process'),{promisify}=require('node:util');
const {RpcClient}=require('./rpc-client.cjs');
const {ProblemView}=require('./problem-view.cjs');
const {sampleHtml}=require('./sample-view.cjs');
const {SampleWindow}=require('./sample-window.cjs');
const isCpp=document=>document?.languageId==='cpp'&&!document.isClosed;
const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function activate(context){
  let rpc,opening,lastSource,sampleSequence=0;const panels=new Map(),buttons=[],samplePanels=new Set();
  const output=vscode.window.createOutputChannel('OpenJudge 学习教练');context.subscriptions.push(output);
  const statementView=new ProblemView(context,async key=>(await backend()).request({type:'library_open',key}));
  const sampleWindow=new SampleWindow({
    create:()=>{
      const panel=vscode.window.createWebviewPanel('openjudgeCoach.sampleRun','样例测试',vscode.ViewColumn.Beside,{enableScripts:true,retainContextWhenHidden:true,localResourceRoots:[context.extensionUri]});
      samplePanels.add(panel);panel.onDidDispose(()=>samplePanels.delete(panel));return panel;
    },
    render:state=>sampleHtml({}, {session:state.session,nonce:randomUUID().replace(/-/g,''),cspSource:state.panel.webview.cspSource,uri:file=>state.panel.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri,file)).toString()}),
    receive:panelMessage,
    collapse:async state=>{const doc=vscode.workspace.textDocuments.find(d=>d.uri.toString()===state.uri);if(doc&&!doc.isClosed)await vscode.window.showTextDocument(doc,{viewColumn:state.sourceColumn,preserveFocus:false});},
    onError:e=>output.appendLine(e.message)
  });
  context.subscriptions.push(sampleWindow);
  async function backend(){
    if(rpc&&!rpc.closed)return rpc;
    if(opening)return opening;
    opening=(async()=>{
      if(!vscode.workspace.isTrusted)throw new Error('请先在可信的 C++ 工作区使用学习教练。');
      let local={};try{local=JSON.parse(await fs.readFile(path.join(context.globalStorageUri.fsPath,'backend.json'),'utf8'));}catch{}
      let root=local.backendPath||process.env.OPENJUDGE_COACH_BACKEND||'';
      if(!root&&process.platform==='win32')try{
        const result=await promisify(execFile)('reg.exe',['query','HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\edu.openjudge.cpp_coach','/ve'],{windowsHide:true});
        const manifest=result.stdout.match(/REG_SZ\s+(.+)/)?.[1]?.trim();if(manifest)root=path.dirname(path.dirname(manifest));
      }catch{}
      if(!root)throw new Error('尚未安装 OpenJudge 本机连接。请运行新版 install-openjudge.ps1，或执行“OpenJudge：选择本机程序目录”。');
      await fs.access(path.join(root,'src/vscode-host.js'));const config=JSON.parse(await fs.readFile(path.join(root,'native/paths.json'),'utf8'));
      if(config.variant!=='openjudge-vscode')throw new Error('所选目录不是独立的 OpenJudge 版本，不会使用或覆盖原北大插件。');
      let node=local.nodePath||'';
      if(!node)node=(await fs.readFile(path.join(root,'native/node-path.txt'),'utf8')).trim();
      rpc=new RpcClient(node,root,why=>output.appendLine(why),event=>{if(event.event==='problem_display')void statementView.accept(event.value).catch(e=>output.appendLine(e.message));});rpc.root=root;await rpc.request({type:'status'});return rpc;
    })().finally(()=>opening=null);return opening;
  }
  function sourceFor(state){
    const active=vscode.window.activeTextEditor;
    if(active&&(!isCpp(active.document)||state&&active.document.uri.toString()!==state.uri))throw new Error('已切换源码文件，请从目标题目的三个按钮重新打开教练。');
    const editor=active||lastSource;
    if(!isCpp(editor?.document)||state&&editor.document.uri.toString()!==state.uri)throw new Error('请先打开或选中你正在写的 C++ 文件。');
    lastSource=editor;
    const doc=editor.document;
    const diagnostics=vscode.languages.getDiagnostics(doc.uri).slice(0,25).map(d=>`第 ${d.range.start.line+1} 行：${d.message}`).join('\n').slice(0,12000);
    return {uri:doc.uri.toString(),name:path.basename(doc.fileName),code:doc.getText(),version:doc.version,selectedCode:editor.document.getText(editor.selection).slice(0,8000),diagnostics};
  }
  async function bind(source,submission=false){
    const client=await backend(),{tabs}=await client.request({type:'browser_tabs'});
    const context=await client.request({type:'context_get',uri:source.uri});
    let selected;
    if(submission){
      if(!context.binding)throw new Error('请先关联当前文件的题目页。');
      const expected=new URL(context.binding.problemUrl),group=expected.pathname.split('/')[1];
      const candidates=tabs.filter(t=>{const u=new URL(t.url);return t.kind==='solution'&&u.hostname===expected.hostname&&u.pathname.split('/')[1]===group;});
      selected=await vscode.window.showQuickPick(candidates.map(t=>({label:t.title||t.url,description:t.url,tab:t})),{placeHolder:'选择本题的 OpenJudge 提交详情标签；必须能与题号核对'});
      if(!selected)return false;
      await client.request({type:'context_bind',uri:source.uri,binding:{...context.binding,submissionTabId:selected.tab.id}});
    }else{
      selected=await vscode.window.showQuickPick(tabs.filter(t=>t.kind==='problem').map(t=>({label:t.title||t.url,description:t.url,tab:t})),{placeHolder:'将当前 C++ 文件关联到 Chrome 中的题目页（不会改动网页）'});
      if(!selected){if(!tabs.some(t=>t.kind==='problem'))throw new Error('请在 Chrome 打开具体题目页，并点击 OpenJudge 连接扩展图标。');return false;}
      await client.request({type:'context_bind',uri:source.uri,binding:{problemUrl:selected.tab.url,tabId:selected.tab.id}});
    }
    return true;
  }
  async function ensureBinding(source){const client=await backend();let saved=await client.request({type:'context_get',uri:source.uri});if(!saved.binding){if(!await bind(source))return null;saved=await client.request({type:'context_get',uri:source.uri});}return saved;}
  async function showRecords(){const client=await backend(),status=await client.request({type:'status'});await vscode.env.openExternal(vscode.Uri.file(status.dataDirectory));}
  async function html(webview){
    let template=await fs.readFile(path.join(context.extensionPath,'media/assist-window.html'),'utf8');
    const nonce=randomUUID().replace(/-/g,''),uri=file=>webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri,file)).toString();
    template=template.replace(/href="([^"]+)"/g,(all,file)=>file.startsWith('vendor/')||file==='sidepanel.css'?`href="${uri('media/'+file)}"`:all);
    template=template.replace(/<script([^>]*?)src="([^"]+)"([^>]*)>/g,(_all,before,file,after)=>`<script nonce="${nonce}"${before}src="${uri('media/'+file)}"${after}>`);
    template=template.replace('<head>','<head><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'nonce-'+nonce+'\'; style-src '+webview.cspSource+' \'unsafe-inline\'; font-src '+webview.cspSource+'; img-src '+webview.cspSource+' data:; connect-src \'none\';">');
    template=template.replace('</head>',`<link rel="stylesheet" href="${uri('theme.css')}"></head>`);
    template=template.replace('<button id="giveSolution" type="button">给出解答</button>','<button id="giveSolution" type="button">给出解答</button><button id="runSample" type="button">运行样例</button><button id="submitOJ" type="button">提交到 OJ</button>');
    template=template.replace('<details id="chatPanel"','<section id="samplePanel" class="execution-panel" hidden><h3>本机样例测试</h3><p id="sampleState" role="status"></p><div id="sampleResults"></div></section><section id="ojPanel" class="execution-panel" hidden><h3>OJ 提交与评测</h3><p class="muted">提交按钮会把本次完整代码发送到 OJ；刷新只查询评测，不重复提交。</p><label id="ojLanguageRow" hidden>编译器 <select id="ojLanguage"></select></label><button id="refreshOJ" type="button" disabled>刷新本次结果</button><p id="ojState" role="status"></p><div id="ojResults"></div></section><details id="chatPanel"');
    template=template.replace('<body><header>',`<body><header><div class="vscode-controls"><strong>OpenJudge · C++ 学习教练</strong><button id="closeCoach">收起</button></div>`);
    template=template.replace('<section id="hintPanel"',`<details id="bindingControls"><summary>题目连接与保存位置</summary><button id="bindProblem">关联/更换题目</button><button id="bindSubmission">选择提交详情标签</button><button id="showRecords">本机记录与报告</button></details><section id="hintPanel"`);
    template=template.replace(/<details><summary>使用范围<\/summary>[\s\S]*?<\/details>\s*<script/,`<details><summary>使用范围</summary><p>题面随浏览器只读同步；本次完整代码与评测在点击时读取。运行样例和提交 OJ 只在明确点击对应按钮时执行，不改写编辑器源码。网页 AC 只有在题号、提交源码和当前代码一致时才关联。原始输出若网站不提供就标为缺失。</p><input id="source" value="" hidden></details><script`);
    template=template.replace(/<script nonce="[^"]+" src="[^"]*vendor\/marked\/marked\.umd\.js"/,`<script nonce="${nonce}" src="${uri('webview-adapter.js')}"></script>$&`);
    // Insert before the first shared script without changing the shared renderer.
    if(!template.includes('webview-adapter.js'))template=template.replace(/(<script nonce=)/,`<script nonce="${nonce}" src="${uri('webview-adapter.js')}"></script>$1`);
    template=template.replace('</body>',`<script nonce="${nonce}" src="${uri('judge-controls.js')}"></script></body>`);
    return template;
  }
  async function panelMessage(state,message){
    const reply=value=>state.disposed?Promise.resolve(false):state.panel.webview.postMessage(value);
    try{
      if(message.type==='draft'&&state.closing)return;
      if(message.type==='collapse')state.closing=true;
      if(message.type==='copy_code'){
        if(typeof message.text!=='string'||message.text.length>100000)throw new Error('复制内容过长。');
        await vscode.env.clipboard.writeText(message.text);return reply({type:'copy_reply',id:message.id});
      }
      const client=await backend();
      if(message.type==='draft'||message.type==='collapse'){
        await client.request({type:'ui_save',uri:state.uri,problemUrl:state.problemUrl,ui:message.ui,uiStamp:{session:state.uiSession,startedAt:state.startedAt,revision:++state.uiRevision}});
        if(message.type==='collapse'){state.panel.dispose();const doc=vscode.workspace.textDocuments.find(d=>d.uri.toString()===state.uri);if(doc)await vscode.window.showTextDocument(doc,{viewColumn:state.sourceColumn,preserveFocus:false});}return;
      }
      if(message.type==='bind_problem'||message.type==='bind_submission'){await bind(sourceFor(state),message.type==='bind_submission');return reply({type:'resume_context',mode:state.mode});}
      if(message.type==='show_records')return showRecords();
      if(message.type==='resume'){
        await reply({type:'resume_context',mode:state.mode});const saved=await client.request({type:'context_get',uri:state.uri,problemUrl:state.problemUrl});if(saved.ui)await reply({type:'restore_ui',ui:saved.ui});return;
      }
      if(!['hint_status','assist_history','hint','discuss','quick_save','run_sample','oj_prepare','oj_submit','oj_refresh','sample_history'].includes(message.type))throw new Error('不支持的界面操作。');
      const request={type:message.type,uri:state.uri,problemUrl:state.problemUrl,language:message.language,actionId:message.actionId,id:message.id,question:message.question,purpose:message.purpose,requestedAt:message.requestedAt};
      if(!['hint_status','oj_prepare','oj_refresh'].includes(message.type))request.source=sourceFor(state);
      const result=await client.request(request);
      if(result.context){
        const selected=result.context;
        await reply({type:message.type==='assist_history'?'assist_context':'action_preview',requestType:message.type,actionId:message.actionId,capture:selected.capture,judgment:selected.judgment,missingSections:selected.missingSections});delete result.context;
      }
      await reply({...result,actionId:message.actionId,requestType:message.type});
    }catch(e){
      output.appendLine(e.message);
      if(message.type==='copy_code')return reply({type:'copy_reply',id:message.id,error:e.message});
      await reply({type:'error',requestType:message.type,actionId:message.actionId,error:e.message});
    }
  }
  async function open(mode){
    const source=sourceFor(),selected=await ensureBinding(source);if(!selected)return;
    const saving=mode==='hint'?(await backend()).request({type:'hint_open',source,problemUrl:selected.binding.problemUrl,actionId:randomUUID(),requestedAt:new Date().toISOString()}).then(result=>({result}),error=>({error})):null;
    let state=panels.get(source.uri);
    if(state&&new URL(state.problemUrl).host+new URL(state.problemUrl).pathname!==new URL(selected.binding.problemUrl).host+new URL(selected.binding.problemUrl).pathname){state.panel.dispose();state=null;}
    if(state){state.mode=mode;state.panel.reveal(state.panel.viewColumn);await state.panel.webview.postMessage({type:'resume_context',mode});}
    else{
    const panel=vscode.window.createWebviewPanel('openjudgeCoach','C++ 提示与交流 · '+source.name,vscode.ViewColumn.Beside,{enableScripts:true,retainContextWhenHidden:true,localResourceRoots:[context.extensionUri]});
    state={panel,uri:source.uri,problemUrl:selected.binding.problemUrl,mode,sourceColumn:lastSource?.viewColumn||vscode.ViewColumn.One,uiSession:randomUUID(),startedAt:Date.now(),uiRevision:0};panels.set(source.uri,state);
    context.subscriptions.push(panel.onDidDispose(()=>{state.disposed=true;panels.delete(source.uri);}),panel.webview.onDidReceiveMessage(message=>{void panelMessage(state,message);}));
    panel.webview.html=await html(panel.webview);
    }
    if(saving){const saved=await saving;if(saved.error)throw saved.error;vscode.window.setStatusBarMessage(saved.result.warning?'当前代码已保存；网页评测未更新，请查看连接。':saved.result.workerError?'当前代码已保存；后台启动失败，请查看 OpenJudge 输出。':'当前代码已自动保存，后台继续分析；上次对话保留。',3500);}
  }
  async function quickSave(){
    const source=sourceFor(),selected=await ensureBinding(source);if(!selected)return;
    const result=await (await backend()).request({type:'quick_save',source,problemUrl:selected.binding.problemUrl,actionId:randomUUID(),requestedAt:new Date().toISOString()});
    vscode.window.setStatusBarMessage(result.workerError?'源码已保存；后台启动失败，请查看 OpenJudge 输出。':source.name+' 已保存，后台继续分析。',3500);
  }
  async function testRun(){
    const sequence=++sampleSequence,source=sourceFor(),selected=await ensureBinding(source);if(!selected)return;
    const sourceColumn=lastSource?.viewColumn||vscode.ViewColumn.One;
    const state=sequence===sampleSequence?sampleWindow.open({uri:source.uri,problemUrl:selected.binding.problemUrl,sourceColumn,name:source.name}):null;
    const show=value=>{if(state&&sequence===sampleSequence)sampleWindow.show(state,value);};
    let saved;
    try{
      const client=await backend(),problemUrl=selected.binding.problemUrl;
      saved=await client.request({type:'quick_save',source,problemUrl,actionId:randomUUID(),requestedAt:new Date().toISOString()});
      show({saved:true,title:saved.title,message:'代码已保存，正在编译并运行题目样例…',workerError:saved.workerError});
      const result=await client.request({type:'run_sample',source,problemUrl,actionId:randomUUID(),requestedAt:new Date().toISOString()});
      show({...result,saved:true});return result;
    }catch(error){show({saved:Boolean(saved),title:saved?.title,error:error.message});output.appendLine(error.message);return {error:error.message,saved:Boolean(saved)};}
  }
  const safe=fn=>async()=>{try{return await fn();}catch(e){output.appendLine(e.message);void vscode.window.showErrorMessage(e.message);}};
  context.subscriptions.push(vscode.commands.registerCommand('openjudgeCoach.quickSave',safe(quickSave)));
  for(const [label,command,fn,priority]of [['测试运行','testRun',testRun,1003],['提示','hint',()=>open('hint'),1002],['交流','discussion',()=>open('discussion'),1001]]){
    context.subscriptions.push(vscode.commands.registerCommand('openjudgeCoach.'+command,safe(fn)));
    const button=vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right,priority);button.text=label;button.tooltip='OpenJudge C++ 教练：'+label;button.command='openjudgeCoach.'+command;button.name='OpenJudge '+label;buttons.push(button);context.subscriptions.push(button);
  }
  context.subscriptions.push(vscode.commands.registerCommand('openjudgeCoach.bindProblem',safe(()=>bind(sourceFor()))),vscode.commands.registerCommand('openjudgeCoach.bindSubmission',safe(()=>bind(sourceFor(),true))),vscode.commands.registerCommand('openjudgeCoach.showRecords',safe(showRecords)));
  context.subscriptions.push(vscode.commands.registerCommand('openjudgeCoach.openLibrary',safe(()=>statementView.openLibrary())));
  context.subscriptions.push(vscode.commands.registerCommand('openjudgeCoach.configureBackend',safe(async()=>{
    const chosen=await vscode.window.showOpenDialog({canSelectFolders:true,canSelectFiles:false,canSelectMany:false,openLabel:'选择 OpenJudge 新版目录'});if(!chosen)return;
    await fs.access(path.join(chosen[0].fsPath,'src/vscode-host.js'));await fs.mkdir(context.globalStorageUri.fsPath,{recursive:true});await fs.writeFile(path.join(context.globalStorageUri.fsPath,'backend.json'),JSON.stringify({backendPath:chosen[0].fsPath}));rpc?.dispose();rpc=null;await backend();
  })));
  const update=editor=>{if(isCpp(editor?.document))lastSource=editor;for(const button of buttons)button.show();};
  context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(update));update(vscode.window.activeTextEditor);
  context.subscriptions.push({dispose(){rpc?.dispose();for(const state of panels.values())state.panel.dispose();for(const panel of samplePanels)panel.dispose();}});
  void backend().then(client=>client.request({type:'problem_display'})).then(value=>statementView.accept(value)).catch(e=>output.appendLine(e.message));
  return {backend,sourceFor,panels,statementView,samplePanels};
}
module.exports={activate};
