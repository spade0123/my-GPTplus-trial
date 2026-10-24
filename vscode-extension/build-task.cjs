const vscode=require('vscode'),fs=require('node:fs/promises'),path=require('node:path');
const jsonc=require('./vendor/jsonc-parser/main.js');
const label='编程网格：编译当前源码到 build';
async function configureBuildTask(context,backend,document,{explicit=false}={}){
  if(!document)return;
  const wsl=document.uri.scheme==='vscode-remote'&&/^wsl\+/i.test(document.uri.authority);
  if(document.uri.scheme!=='file'&&!wsl)throw new Error('自动构建任务目前支持 Windows 本机与 Remote-WSL；其他远程环境请使用原有任务。');
  const folder=vscode.workspace.getWorkspaceFolder(document.uri);if(!folder)return;
  const tasksUri=vscode.Uri.joinPath(folder.uri,'.vscode','tasks.json');
  let text='{"version":"2.0.0","tasks":[]}',doc;
  let present=false;try{await vscode.workspace.fs.stat(tasksUri);present=true;}catch(error){if(!['FileNotFound','ENOENT'].includes(error.code))throw error;}
  if(present){doc=await vscode.workspace.openTextDocument(tasksUri);if(doc.isDirty)throw new Error('请先保存 tasks.json，再配置编译目录。');text=doc.getText();}
  const originalText=text;
  const errors=[],config=jsonc.parse(text,errors,{allowTrailingComma:true});
  if(errors.length||!config||typeof config!=='object'||Array.isArray(config)||config.tasks!==undefined&&!Array.isArray(config.tasks))throw new Error('tasks.json 格式无法识别，已有任务未修改。');
  const tasks=config.tasks||[],index=tasks.findIndex(task=>task.label===label);
  // Keep user arguments/default choices, but refresh the installed helper path on upgrades.
  const refreshOnly=index>=0&&!explicit;
  if(refreshOnly&&! /(?:^|[/\\])(?:local-compile\.cjs|grid-build\.sh)$/.test(tasks[index].args?.[0]||''))return;
  const args=vscode.workspace.getConfiguration('gridCoach').get('build.arguments',['-std=c++17','-g','-O0']);
  if(!Array.isArray(args)||args.length>100||args.some(arg=>typeof arg!=='string'||arg.includes('\0')||/^-o/.test(arg)))throw new Error('编译参数应为字符串数组，不含 -o；输出目录由插件统一管理。');
  let command,taskArgs;
  if(wsl){
    const compiler=vscode.workspace.getConfiguration('gridCoach').get('build.wslCompiler','g++');
    if(typeof compiler!=='string'||!compiler.trim()||/[\r\n\0]/.test(compiler))throw new Error('WSL 编译器应是 g++ 或 WSL 内的绝对路径。');
    const scriptUri=vscode.Uri.joinPath(folder.uri,'.vscode','grid-build.sh');
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(folder.uri,'.vscode'));
    let scriptPresent=false;
    try{const metadata=await vscode.workspace.fs.stat(scriptUri);if(metadata.type&vscode.FileType.SymbolicLink)throw new Error('grid-build.sh 不能是符号链接。');scriptPresent=true;}catch(error){if(!['FileNotFound','ENOENT'].includes(error.code))throw error;}
    if(scriptPresent){const old=Buffer.from(await vscode.workspace.fs.readFile(scriptUri)).toString('utf8');if(!old.includes('# Grid-Code managed WSL build v1'))throw new Error('已有 grid-build.sh 不是插件生成的脚本，未覆盖。请先改名保留它，再重新配置。');}
    const script=await fs.readFile(path.join(context.extensionPath,'wsl-build.sh'),'utf8');
    await vscode.workspace.fs.writeFile(scriptUri,Buffer.from(script.replace(/\r\n/g,'\n')));
    command='/bin/sh';taskArgs=[scriptUri.path,'${file}',compiler,...args];
  }else{
    const client=await backend(),native=JSON.parse(await fs.readFile(path.join(client.root,'native/paths.json'),'utf8'));
    const node=(await fs.readFile(path.join(client.root,'native/node-path.txt'),'utf8')).trim();
    if(!path.isAbsolute(node)||!path.isAbsolute(native.compiler||''))throw new Error('本机 Node 或编译器路径不完整，请重新安装本机连接。');
    command=node;taskArgs=[path.join(context.extensionPath,'local-compile.cjs'),native.compiler,'${file}',JSON.stringify(args)];
  }
  const task={label,type:'process',command,args:taskArgs,options:{cwd:'${fileDirname}'},problemMatcher:['$gcc'],group:{kind:'build',isDefault:true},presentation:{reveal:'always',panel:'dedicated',clear:true}};
  const apply=(target,value)=>{text=jsonc.applyEdits(text,jsonc.modify(text,target,value,{formattingOptions:{insertSpaces:true,tabSize:2,eol:'\n'}}));};
  if(refreshOnly){
    if(tasks[index].command===command&&tasks[index].args[0]===task.args[0]&&tasks[index].args[1]===task.args[1]&&tasks[index].args[2]===task.args[2])return;
    apply(['tasks',index,'command'],command);
    // Keep edited flags when refreshing the same runtime; replace incompatible Windows args in WSL.
    const sameRuntime=wsl?tasks[index].command==='/bin/sh':tasks[index].command!=='/bin/sh';
    apply(['tasks',index,'args'],sameRuntime?[...task.args.slice(0,3),...tasks[index].args.slice(3)]:task.args);
  }else{
  if(!config.version)apply(['version'],'2.0.0');
  if(!config.tasks)apply(['tasks'],[]);
  for(const [i,item]of tasks.entries())if(i!==index&&item.group?.kind==='build'&&item.group.isDefault===true)apply(['tasks',i,'group','isDefault'],false);
  apply(['tasks',index<0?tasks.length:index],task);
  }
  if(doc){
    if(doc.isDirty||doc.getText()!==originalText)throw new Error('tasks.json 刚被修改，请先保存再配置编译目录。');
    const edit=new vscode.WorkspaceEdit();edit.replace(tasksUri,new vscode.Range(doc.positionAt(0),doc.positionAt(doc.getText().length)),text);
    if(!await vscode.workspace.applyEdit(edit)||!await doc.save())throw new Error('编译任务未能保存，请检查 tasks.json。');
  }else{
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(folder.uri,'.vscode'));
    const edit=new vscode.WorkspaceEdit();edit.createFile(tasksUri,{overwrite:false});edit.insert(tasksUri,new vscode.Position(0,0),text+'\n');
    if(!await vscode.workspace.applyEdit(edit))throw new Error('编译任务创建未完成，已有文件未覆盖。');
    const created=await vscode.workspace.openTextDocument(tasksUri);if(!await created.save())throw new Error('请保存新建的 tasks.json。');
  }
  vscode.window.setStatusBarMessage('已配置 Ctrl+Shift+B：编译产物保存到源码旁的 build 文件夹。',5000);
}
module.exports={configureBuildTask};
