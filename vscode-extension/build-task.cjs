const vscode=require('vscode'),fs=require('node:fs/promises'),path=require('node:path');
const jsonc=require('./vendor/jsonc-parser/main.js');
const label='编程网格：编译当前源码到 build';
async function configureBuildTask(context,backend,document,{explicit=false}={}){
  if(!document||document.uri.scheme!=='file')return;
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
  if(refreshOnly&&! /(?:^|[/\\])local-compile\.cjs$/.test(tasks[index].args?.[0]||''))return;
  const client=await backend(),native=JSON.parse(await fs.readFile(path.join(client.root,'native/paths.json'),'utf8'));
  const node=(await fs.readFile(path.join(client.root,'native/node-path.txt'),'utf8')).trim();
  if(!path.isAbsolute(node)||!path.isAbsolute(native.compiler||''))throw new Error('本机 Node 或编译器路径不完整，请重新安装本机连接。');
  const args=vscode.workspace.getConfiguration('gridCoach').get('build.arguments',['-std=c++17','-g','-O0']);
  const task={label,type:'process',command:node,args:[path.join(context.extensionPath,'local-compile.cjs'),native.compiler,'${file}',JSON.stringify(args)],options:{cwd:'${fileDirname}'},problemMatcher:['$gcc'],group:{kind:'build',isDefault:true},presentation:{reveal:'always',panel:'dedicated',clear:true}};
  const apply=(target,value)=>{text=jsonc.applyEdits(text,jsonc.modify(text,target,value,{formattingOptions:{insertSpaces:true,tabSize:2,eol:'\n'}}));};
  if(refreshOnly){
    if(tasks[index].command===node&&tasks[index].args[0]===task.args[0]&&tasks[index].args[1]===native.compiler)return;
    apply(['tasks',index,'command'],node);apply(['tasks',index,'args',0],task.args[0]);apply(['tasks',index,'args',1],native.compiler);
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
