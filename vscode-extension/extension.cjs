const vscode=require('vscode'),fs=require('node:fs/promises'),path=require('node:path'),{randomUUID}=require('node:crypto'),{execFile}=require('node:child_process'),{promisify}=require('node:util');
const {RpcClient}=require('./rpc-client.cjs');
const {ProblemView}=require('./problem-view.cjs');
const {ProblemNavigation}=require('./problem-navigation.cjs');
const {planDateOrganization,applyDateOrganization}=require('./date-organizer.cjs');
const isCpp=document=>document?.languageId==='cpp'&&!document.isClosed;
const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function activate(context){
  let rpc,opening,lastSource;const panels=new Map(),judgePanels=new Map(),buttons=[];
  const output=vscode.window.createOutputChannel('编程网格 学习教练');context.subscriptions.push(output);
  const statementView=new ProblemView(context);
  statementView.navigation=new ProblemNavigation({context,backend,currentEditor:()=>vscode.window.activeTextEditor?.document.languageId==='cpp'?vscode.window.activeTextEditor:lastSource,display:()=>statementView.latest});
  const settings=()=>vscode.workspace.getConfiguration('gridCoach');
  const aiSettings=()=>({model:settings().get('ai.model','gpt-6-luna'),effort:settings().get('ai.effort','low')});
  const verdictSettings=()=>Object.fromEntries(['AC','WA','CE','TLE','RE','MLE','PE','OLE'].map(code=>[code,{
    text:settings().get(`verdicts.${code}.text`,''),fontSize:settings().get(`verdicts.${code}.fontSize`,0),color:settings().get(`verdicts.${code}.color`,'')
  }]));
  async function selectModel(){
    const current=aiSettings();
    const choice=await vscode.window.showQuickPick([
      {label:'GPT-6 Luna',description:'gpt-6-luna · 日常学习，默认',model:'gpt-6-luna'},
      {label:'GPT-6.1 Sol',description:'gpt-6.1-sol',model:'gpt-6.1-sol'},
      {label:'GPT-6 Astra',description:'gpt-6-astra',model:'gpt-6-astra'},
      {label:'自定义模型 ID',description:`当前：${current.model}`,model:null}
    ],{title:'编程网格：选择 AI 模型（1/2）',placeHolder:'由当前 Codex 登录账号调用，模型可用性取决于账号'});
    if(!choice)return;
    const model=choice.model??await vscode.window.showInputBox({title:'自定义模型 ID',value:current.model,validateInput:value=>/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,119}$/.test(value.trim())?undefined:'请输入有效模型 ID，例如 gpt-6-luna'});
    if(!model)return;
    const efforts=['low','medium','high','xhigh','max'];if(!['gpt-6.1-sol','gpt-6-astra','gpt-6-sol'].includes(model.trim()))efforts.unshift('none');
    const effort=await vscode.window.showQuickPick(efforts.map(value=>({label:value,description:value===current.effort?'当前强度':value==='low'?'优先速度':value==='none'?'不额外推理':'增加分析，可能更慢且消耗更多额度'})),{title:'编程网格：选择推理强度（2/2）',placeHolder:'自定义模型请在设置中指定其支持的强度'});
    if(!effort)return;
    // Application settings stay in the local user profile, never the shared repository.
    if(current.effort==='none'&&model!=='gpt-6-luna')await settings().update('ai.effort','low',vscode.ConfigurationTarget.Global);
    await settings().update('ai.model',model.trim(),vscode.ConfigurationTarget.Global);
    await settings().update('ai.effort',effort.label,vscode.ConfigurationTarget.Global);
    await (await backend()).request({type:'configure_ai',settings:aiSettings()});
    void vscode.window.showInformationMessage(`AI 已设为 ${model.trim()} / ${effort.label}；从下一次请求生效。`);
  }
  async function backend(){
    if(opening)return opening;
    if(rpc&&!rpc.closed)return rpc;
    opening=(async()=>{
      if(!vscode.workspace.isTrusted)throw new Error('请先在可信的 C++ 工作区使用学习教练。');
      let local={};try{local=JSON.parse(await fs.readFile(path.join(context.globalStorageUri.fsPath,'backend.json'),'utf8'));}catch{}
      let root=local.backendPath||process.env.GRID_COACH_BACKEND||'';
      if(!root&&process.platform==='win32')try{
        const result=await promisify(execFile)('reg.exe',['query','HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\edu.pku.grid_vscode_coach','/ve'],{windowsHide:true});
        const manifest=result.stdout.match(/REG_SZ\s+(.+)/)?.[1]?.trim();if(manifest)root=path.dirname(path.dirname(manifest));
      }catch{}
      if(!root)throw new Error('尚未安装编程网格本机连接。请运行 install-grid.ps1，或执行“编程网格：选择本机程序目录”。');
      await fs.access(path.join(root,'src/vscode-host.js'));const config=JSON.parse(await fs.readFile(path.join(root,'native/paths.json'),'utf8'));
      if(config.variant!=='programminggrid-vscode')throw new Error('所选目录不是独立的 编程网格 版本，不会使用或覆盖原北大插件。');
      let node=local.nodePath||'';
      if(!node)node=(await fs.readFile(path.join(root,'native/node-path.txt'),'utf8')).trim();
      rpc=new RpcClient(node,root,why=>output.appendLine(why),event=>{if(event.event==='problem_display')void statementView.accept(event.value).catch(e=>output.appendLine(e.message));});rpc.root=root;await rpc.request({type:'status'});
      try{await rpc.request({type:'configure_ai',settings:aiSettings()});}catch(error){output.appendLine('AI 设置未同步：'+error.message);}
      return rpc;
    })().finally(()=>opening=null);return opening;
  }
  function sourceFor(state,allowNavigationRecovery=false){
    if(statementView.navigation.switching||statementView.navigation.blocked&&!allowNavigationRecovery)throw new Error('切题尚未完成。请重试选择目标题目，或执行“关联当前 C++ 文件与 Chrome 题目”后再测试/提交。');
    const active=vscode.window.activeTextEditor;
    if(active&&(!isCpp(active.document)||state&&active.document.uri.toString()!==state.uri))throw new Error('已切换源码文件，请从目标题目的三个按钮重新打开教练。');
    const visible=vscode.window.visibleTextEditors.filter(editor=>isCpp(editor.document));
    const editor=active||(isCpp(lastSource?.document)?lastSource:undefined)||(state?visible.find(editor=>editor.document.uri.toString()===state.uri):visible.length===1?visible[0]:undefined);
    if(!isCpp(editor?.document)||state&&editor.document.uri.toString()!==state.uri)throw new Error('请先打开或选中你正在写的 C++ 文件。');
    if(!allowNavigationRecovery)statementView.navigation.assertSource(editor.document.uri.toString());
    lastSource=editor;
    const doc=editor.document;
    const diagnostics=vscode.languages.getDiagnostics(doc.uri).slice(0,25).map(d=>`第 ${d.range.start.line+1} 行：${d.message}`).join('\n').slice(0,12000);
    return {uri:doc.uri.toString(),name:path.basename(doc.fileName),code:doc.getText(),version:doc.version,selectedCode:editor.document.getText(editor.selection).slice(0,8000),diagnostics};
  }
  async function bind(source){
    const client=await backend(),{tabs}=await client.request({type:'browser_tabs'});
    const context=await client.request({type:'context_get',uri:source.uri});
    const selected=await vscode.window.showQuickPick(tabs.filter(t=>t.kind==='problem').map(t=>({label:t.title||t.url,description:t.url,tab:t})),{placeHolder:'将当前 C++ 文件关联到 Chrome 中的编程网格 IDE 页'});
    if(!selected){if(!tabs.some(t=>t.kind==='problem'))throw new Error('请在 Chrome 打开具体题目 IDE，并点击“编程网格 · VS Code 连接”扩展图标。');return false;}
    await client.request({type:'context_bind',uri:source.uri,binding:{problemUrl:selected.tab.url,tabId:selected.tab.id}});
    await statementView.navigation.associate(source.uri,selected.tab.url);
    await statementView.navigation.clearBlock();
    return true;
  }
  async function ensureBinding(source){const client=await backend();let saved=await client.request({type:'context_get',uri:source.uri});if(!saved.binding){if(!await bind(source))return null;saved=await client.request({type:'context_get',uri:source.uri});}return saved;}
  async function showRecords(){const client=await backend(),status=await client.request({type:'status'});await vscode.env.openExternal(vscode.Uri.file(status.dataDirectory));}
  async function organizeProjectByDate(){
    const folders=vscode.workspace.workspaceFolders||[];
    if(!folders.length)throw new Error('请先在 VS Code 打开一个项目文件夹。');
    const activeUri=vscode.window.activeTextEditor?.document.uri;
    let folder=folders.length===1?folders[0]:activeUri?vscode.workspace.getWorkspaceFolder(activeUri):undefined;
    if(!folder){
      const choice=await vscode.window.showQuickPick(folders.map(item=>({label:item.name,description:item.uri.toString(),folder:item})),{placeHolder:'选择要整理的项目文件夹'});
      if(!choice)return;
      folder=choice.folder;
    }
    const moves=await planDateOrganization(vscode,folder.uri,{extensions:new Set(['.c','.cc','.cpp','.cxx']),dateField:'mtime'});
    if(!moves.length){void vscode.window.showInformationMessage('项目根目录没有需要整理的 C/C++ 源码文件。');return;}
    const moveSources=new Set(moves.map(move=>move.source.toString()));
    if(vscode.workspace.textDocuments.some(document=>document.isDirty&&moveSources.has(document.uri.toString())))throw new Error('要整理的源码有未保存的改动，请先保存文件，再点击“按日期整理”。');
    const preview=moves.slice(0,8).map(move=>`${path.basename(move.source.path)} → 按日期整理/${move.day}/`).join('\n');
    const choice=await vscode.window.showWarningMessage(`将按最后修改日期整理 ${moves.length} 个 C/C++ 源码文件`,{modal:true,detail:`项目：${folder.name}\n${preview}${moves.length>8?'\n……':''}\n文件路径会变化，依赖旧路径的编译任务可能需要更新。`},'开始整理');
    if(choice!=='开始整理')return;
    await applyDateOrganization(vscode,moves);
    void vscode.window.showInformationMessage(`已整理 ${moves.length} 个源码文件到“按日期整理”文件夹。`);
  }
  async function html(webview){
    let template=await fs.readFile(path.join(context.extensionPath,'media/assist-window.html'),'utf8');
    template=template.replace('<title>C++ 学习教练</title>','<title>北大编程网格 · C++ 学习教练</title>').replace('<span class="eyebrow">C++ 学习教练 · 右侧浮窗</span>','<span class="eyebrow">北大编程网格 · C++ 学习教练</span>');
    const nonce=randomUUID().replace(/-/g,''),uri=file=>webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri,file)).toString();
    template=template.replace(/href="([^"]+)"/g,(all,file)=>file.startsWith('vendor/')||file==='sidepanel.css'?`href="${uri('media/'+file)}"`:all);
    template=template.replace(/<script([^>]*?)src="([^"]+)"([^>]*)>/g,(_all,before,file,after)=>`<script nonce="${nonce}"${before}src="${uri('media/'+file)}"${after}>`);
    template=template.replace('<head>','<head><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'nonce-'+nonce+'\'; style-src '+webview.cspSource+' \'unsafe-inline\'; font-src '+webview.cspSource+'; img-src '+webview.cspSource+' data:; connect-src \'none\';">');
    template=template.replace('</head>',`<link rel="stylesheet" href="${uri('theme.css')}"></head>`);
    const header=template.match(/<header>[\s\S]*?<\/header>/)?.[0]||'';
    const contextText=template.match(/<p id="saveStatus"[\s\S]*?<\/p><p id="context"[\s\S]*?<\/p>/)?.[0]||'';
    template=template.replace(header,'').replace(contextText,'').replace('<article id="hintAnswer" class="markdown"></article>','');
    template=template.replace('<body>',`<body><div class="vscode-controls"><button id="closeCoach">收起</button></div>`);
    template=template.replace('<section id="hintPanel" hidden>','<section id="hintPanel" hidden><article id="hintAnswer" class="markdown"></article>');
    template=template.replace(/<details><summary>使用范围<\/summary>[\s\S]*?<\/details>\s*<script/,`<details><summary>使用范围</summary><p>这里是 AI 学习辅助：提示、交流和完整参考解答。编程网格测试、正式提交与网站返回原文在独立的“网格·评测”页面。</p><input id="source" value="" hidden></details><script`);
    template=template.replace(/<script nonce="[^"]+" src="[^"]*vendor\/marked\/marked\.umd\.js"/,`<script nonce="${nonce}" src="${uri('webview-adapter.js')}"></script>$&`);
    // Insert before the first shared script without changing the shared renderer.
    if(!template.includes('webview-adapter.js'))template=template.replace(/(<script nonce=)/,`<script nonce="${nonce}" src="${uri('webview-adapter.js')}"></script>$1`);
    template=template.replace('</body>',`<footer class="coach-footer"><details id="bindingControls"><summary>题目连接与保存位置</summary><button id="bindProblem">关联/更换题目</button><button id="showRecords">本机记录与报告</button></details>${contextText}${header}</footer></body>`);
    return template;
  }
  async function judgeHtml(webview){
    let template=await fs.readFile(path.join(context.extensionPath,'judge-window.html'),'utf8');
    const nonce=randomUUID().replace(/-/g,''),uri=file=>webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri,file)).toString();
    template=template.replace('<head>',`<head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource}; img-src ${webview.cspSource} data:; connect-src 'none';">`);
    template=template.replace(/href="([^"]+)"/g,(_all,file)=>`href="${uri(file)}"`);
    template=template.replace(/<script src="([^"]+)"><\/script>/g,(_all,file)=>`<script nonce="${nonce}" src="${uri(file)}"></script>`);
    return template;
  }
  async function panelMessage(state,message){
    const reply=value=>state.panel.webview.postMessage(value);
    try{
      if(message.type==='draft'&&state.closing)return;
      if(message.type==='collapse')state.closing=true;
      if(message.type==='copy_code'){
        if(typeof message.text!=='string'||message.text.length>100000)throw new Error('复制内容过长。');
        await vscode.env.clipboard.writeText(message.text);return reply({type:'copy_reply',id:message.id});
      }
      if(message.type==='collapse'&&state.kind==='judge'){
        state.panel.dispose();const doc=vscode.workspace.textDocuments.find(d=>d.uri.toString()===state.uri);
        if(doc)await vscode.window.showTextDocument(doc,{viewColumn:state.sourceColumn,preserveFocus:false});return;
      }
      if(message.type==='open_settings')return vscode.commands.executeCommand('workbench.action.openSettings','@ext:local-coach.pku-grid-cpp-coach');
      if(message.type==='judge_ready')await reply({type:'judge_settings',settings:verdictSettings()});
      const client=await backend();
      if(message.type==='judge_ready'){
        const [saved,history]=await Promise.all([
          client.request({type:'context_get',uri:state.uri,problemUrl:state.problemUrl}),
          client.request({type:'judge_history',uri:state.uri,problemUrl:state.problemUrl})
        ]);
        await reply({type:'assist_context',capture:{problem:saved.problem?.problem}});
        return reply(history);
      }
      if(message.type==='draft'||message.type==='collapse'){
        await client.request({type:'ui_save',uri:state.uri,problemUrl:state.problemUrl,ui:message.ui,uiStamp:{session:state.uiSession,startedAt:state.startedAt,revision:++state.uiRevision}});
        if(message.type==='collapse'){state.panel.dispose();const doc=vscode.workspace.textDocuments.find(d=>d.uri.toString()===state.uri);if(doc)await vscode.window.showTextDocument(doc,{viewColumn:state.sourceColumn,preserveFocus:false});}return;
      }
      if(message.type==='bind_problem'){
        const source=sourceFor(state,true);if(!await bind(source))return;
        if(state.kind==='judge'){
          const saved=await client.request({type:'context_get',uri:state.uri});state.problemUrl=saved.binding.problemUrl;
          return reply({type:'assist_context',capture:{problem:saved.problem?.problem}});
        }
        return reply({type:'resume_context',mode:state.mode});
      }
      if(message.type==='show_records')return showRecords();
      if(message.type==='resume'){
        await reply({type:'resume_context',mode:state.mode});const saved=await client.request({type:'context_get',uri:state.uri,problemUrl:state.problemUrl});if(saved.ui)await reply({type:'restore_ui',ui:saved.ui});return;
      }
      if(!['hint_status','assist_history','hint','discuss','quick_save','grid_test','grid_test_status','grid_test_refresh','oj_prepare','oj_submit','oj_status','oj_refresh'].includes(message.type))throw new Error('不支持的界面操作。');
      const request={type:message.type,uri:state.uri,problemUrl:state.problemUrl,language:message.language,input:message.input,actionId:message.actionId,id:message.id,question:message.question,purpose:message.purpose,requestedAt:message.requestedAt};
      if(!['hint_status','grid_test_status','grid_test_refresh','oj_prepare','oj_status','oj_refresh'].includes(message.type))request.source=sourceFor(state);
      if(['hint','discuss','quick_save'].includes(message.type))await client.request({type:'configure_ai',settings:aiSettings()});
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
    await (await backend()).request({type:'configure_ai',settings:aiSettings()});
    const source=sourceFor(),selected=await ensureBinding(source);if(!selected)return;
    const saving=mode==='hint'?(await backend()).request({type:'hint_open',source,problemUrl:selected.binding.problemUrl,actionId:randomUUID(),requestedAt:new Date().toISOString()}).then(result=>({result}),error=>({error})):null;
    let state=panels.get(source.uri);
    if(state&&new URL(state.problemUrl).host+new URL(state.problemUrl).pathname!==new URL(selected.binding.problemUrl).host+new URL(selected.binding.problemUrl).pathname){state.panel.dispose();state=null;}
    if(state){state.mode=mode;state.panel.reveal(state.panel.viewColumn);await state.panel.webview.postMessage({type:'resume_context',mode});}
    else{
    const panel=vscode.window.createWebviewPanel('gridCoach','编程网格 · 提示与交流 · '+source.name,vscode.ViewColumn.Beside,{enableScripts:true,retainContextWhenHidden:true,localResourceRoots:[context.extensionUri]});
    state={panel,uri:source.uri,problemUrl:selected.binding.problemUrl,mode,sourceColumn:lastSource?.viewColumn||vscode.ViewColumn.One,uiSession:randomUUID(),startedAt:Date.now(),uiRevision:0};panels.set(source.uri,state);
    context.subscriptions.push(panel.onDidDispose(()=>panels.delete(source.uri)),panel.webview.onDidReceiveMessage(message=>{void panelMessage(state,message);}));
    panel.webview.html=await html(panel.webview);
    }
    if(saving){const saved=await saving;if(saved.error)throw saved.error;vscode.window.setStatusBarMessage(saved.result.warning?'当前代码已保存；网页评测未更新，请查看连接。':saved.result.workerError?'当前代码已保存；后台启动失败，请查看 编程网格 输出。':'当前代码已自动保存，后台继续分析；上次对话保留。',3500);}
  }
  async function openJudge(){
    const source=sourceFor(),selected=await ensureBinding(source);if(!selected)return;
    let state=judgePanels.get(source.uri);
    if(state&&state.problemUrl!==selected.binding.problemUrl){state.panel.dispose();state=null;}
    if(state){state.panel.reveal(state.panel.viewColumn);return;}
    const panel=vscode.window.createWebviewPanel('gridCoachJudge','编程网格 · 测试与提交 · '+source.name,vscode.ViewColumn.Beside,{enableScripts:true,retainContextWhenHidden:true,localResourceRoots:[context.extensionUri]});
    state={kind:'judge',panel,uri:source.uri,problemUrl:selected.binding.problemUrl,sourceColumn:lastSource?.viewColumn||vscode.ViewColumn.One};judgePanels.set(source.uri,state);
    context.subscriptions.push(panel.onDidDispose(()=>judgePanels.delete(source.uri)),panel.webview.onDidReceiveMessage(message=>{void panelMessage(state,message);}));
    panel.webview.html=await judgeHtml(panel.webview);
  }
  async function quickSave(){
    await (await backend()).request({type:'configure_ai',settings:aiSettings()});
    const source=sourceFor(),selected=await ensureBinding(source);if(!selected)return;
    const result=await (await backend()).request({type:'quick_save',source,problemUrl:selected.binding.problemUrl,actionId:randomUUID(),requestedAt:new Date().toISOString()});
    vscode.window.setStatusBarMessage(result.workerError?'源码已保存；后台启动失败，请查看 编程网格 输出。':source.name+' 已保存，后台继续分析。',3500);
  }
  const safe=fn=>async()=>{try{return await fn();}catch(e){output.appendLine(e.message);void vscode.window.showErrorMessage(e.message);}};
  for(const [label,command,fn,priority]of [['网格·保存','quickSave',quickSave,1004],['网格·评测','judge',openJudge,1003],['网格·提示','hint',()=>open('hint'),1002],['网格·交流','discussion',()=>open('discussion'),1001]]){
    context.subscriptions.push(vscode.commands.registerCommand('gridCoach.'+command,safe(fn)));
    const button=vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right,priority);button.text=label;button.tooltip='编程网格 C++ 教练：'+label;button.command='gridCoach.'+command;button.name='编程网格 '+label;button.show();buttons.push(button);context.subscriptions.push(button);
  }
  context.subscriptions.push(vscode.commands.registerCommand('gridCoach.bindProblem',safe(()=>bind(sourceFor(undefined,true)))),vscode.commands.registerCommand('gridCoach.showRecords',safe(showRecords)),vscode.commands.registerCommand('gridCoach.organizeProjectByDate',safe(organizeProjectByDate)));
  const organizeButton=vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right,1000);
  organizeButton.text='$(calendar) 按日期整理';organizeButton.tooltip='将项目根目录的 C/C++ 源码按最后修改日期整理';organizeButton.command='gridCoach.organizeProjectByDate';organizeButton.name='编程网格 按日期整理';
  const showOrganizeButton=()=>vscode.workspace.workspaceFolders?.length?organizeButton.show():organizeButton.hide();
  context.subscriptions.push(organizeButton,vscode.workspace.onDidChangeWorkspaceFolders(showOrganizeButton));showOrganizeButton();
  context.subscriptions.push(vscode.commands.registerCommand('gridCoach.configureBackend',safe(async()=>{
    const chosen=await vscode.window.showOpenDialog({canSelectFolders:true,canSelectFiles:false,canSelectMany:false,openLabel:'选择 编程网格 新版目录'});if(!chosen)return;
    await fs.access(path.join(chosen[0].fsPath,'src/vscode-host.js'));await fs.mkdir(context.globalStorageUri.fsPath,{recursive:true});await fs.writeFile(path.join(context.globalStorageUri.fsPath,'backend.json'),JSON.stringify({backendPath:chosen[0].fsPath}));rpc?.dispose();rpc=null;await backend();
  })));
  context.subscriptions.push(vscode.commands.registerCommand('gridCoach.selectModel',safe(selectModel)),
    vscode.commands.registerCommand('gridCoach.openSettings',()=>vscode.commands.executeCommand('workbench.action.openSettings','@ext:local-coach.pku-grid-cpp-coach')));
  const modelButton=vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right,999);
  modelButton.command='gridCoach.selectModel';modelButton.name='编程网格 AI 模型与强度';
  const updateModelButton=()=>{const value=aiSettings();modelButton.text=`网格·AI ${value.model.replace(/^gpt-/, '')} / ${value.effort}`;modelButton.tooltip='选择 AI 模型与推理强度（提示、交流、后台报告）';modelButton.show();};
  let configTimer;
  context.subscriptions.push(modelButton,vscode.workspace.onDidChangeConfiguration(event=>{
    if(!event.affectsConfiguration('gridCoach'))return;
    for(const state of judgePanels.values())void state.panel.webview.postMessage({type:'judge_settings',settings:verdictSettings()});
    updateModelButton();
    if(event.affectsConfiguration('gridCoach.ai')){
      clearTimeout(configTimer);configTimer=setTimeout(()=>{void safe(async()=>{await (await backend()).request({type:'configure_ai',settings:aiSettings()});})();},200);
    }
  }),{dispose(){clearTimeout(configTimer);}});updateModelButton();
  const update=editor=>{if(isCpp(editor?.document))lastSource=editor;};
  context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(update));update(vscode.window.activeTextEditor);
  context.subscriptions.push({dispose(){rpc?.dispose();for(const state of [...panels.values(),...judgePanels.values()])state.panel.dispose();}});
  void backend().then(client=>client.request({type:'problem_display'})).then(value=>statementView.accept(value)).catch(e=>output.appendLine(e.message));
  return {backend,sourceFor,panels,judgePanels,statementView};
}
module.exports={activate};
