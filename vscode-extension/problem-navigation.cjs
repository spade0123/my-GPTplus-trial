const vscode=require('vscode');
const MAP_KEY='gridCoach.problemFiles.v1',PENDING_KEY='gridCoach.navigationPending.v1';
function identity(value){
  try{const u=new URL(value),m=u.pathname.match(/^\/(?:course\/)?probset\/([a-f0-9]{32})\/([a-f0-9]{32})\/ide\.do$/i);return u.origin==='https://programming.pku.edu.cn'&&!u.username&&!u.password&&!u.search&&!u.hash&&m?{key:m[1].toLowerCase()+'/'+m[2].toLowerCase(),group:m[1].toLowerCase(),id:m[2].toLowerCase()}:null;}catch{return null;}
}
class ProblemNavigation{
  constructor({context,backend,currentEditor,display}){Object.assign(this,{context,backend,currentEditor,display});this.switching=false;this.blocked=context.workspaceState.get(PENDING_KEY,false);}
  assertSource(uri){
    const mapping=this.context.workspaceState.get(MAP_KEY,{}),current=identity(this.display().url);
    if(current&&Object.values(mapping).includes(uri)&&mapping[current.key]!==uri)throw new Error('当前源码关联的是另一题，请从题目列表切换，或明确重新关联文件。');
  }
  async associate(uri,url){const target=identity(url);if(target)await this.context.workspaceState.update(MAP_KEY,{...this.context.workspaceState.get(MAP_KEY,{}),[target.key]:uri});}
  async clearBlock(){await this.context.workspaceState.update(PENDING_KEY,false);this.blocked=false;}
  async list(url,forceDeadline=false){return (await this.backend()).request({type:'list_problems',problemUrl:url,forceDeadline});}
  async rememberCurrent(client,url){
    const editor=this.currentEditor();if(editor?.document.languageId!=='cpp'||editor.document.isClosed)return;
    const uri=editor.document.uri.toString(),saved=await client.request({type:'context_lookup',uri});
    if(identity(saved.binding?.problemUrl)?.key!==identity(url)?.key)return;
    await this.context.workspaceState.update(MAP_KEY,{...this.context.workspaceState.get(MAP_KEY,{}),[identity(url).key]:uri});
  }
  async documentFor(client,url){
    const target=identity(url),mapping=this.context.workspaceState.get(MAP_KEY,{}),saved=mapping[target.key];
    if(saved&&identity((await client.request({type:'context_lookup',uri:saved})).binding?.problemUrl)?.key===target.key){
      const open=vscode.workspace.textDocuments.find(document=>document.uri.toString()===saved);
      if(open&&!open.isClosed)return open;
      if(!saved.startsWith('untitled:'))try{return await vscode.workspace.openTextDocument(vscode.Uri.parse(saved));}catch{/* A moved/deleted file can be chosen again. */}
    }
    // Recover already-associated open files, including those created before navigation existed.
    const documents=vscode.workspace.textDocuments.filter(document=>document.languageId==='cpp'&&!document.isClosed).slice(0,50);
    const records=await Promise.all(documents.map(async document=>({document,record:await client.request({type:'context_lookup',uri:document.uri.toString()})})));
    const matches=records.filter(item=>identity(item.record.binding?.problemUrl)?.key===target.key);
    if(matches.length===1)return matches[0].document;
    if(matches.length>1){
      const choice=await vscode.window.showQuickPick(matches.map(item=>({label:item.document.fileName,document:item.document})),{placeHolder:'此题关联了多个文件，选择要继续编写的源码'});
      return choice?.document;
    }
    const folders=vscode.workspace.workspaceFolders||[];
    if(!folders.length)return vscode.workspace.openTextDocument({language:'cpp',content:''});
    const activeUri=this.currentEditor()?.document.uri;
    let folder=folders.length===1?folders[0]:activeUri?vscode.workspace.getWorkspaceFolder(activeUri):undefined;
    if(!folder){const chosen=await vscode.window.showQuickPick(folders.map(item=>({label:item.name,folder:item})),{placeHolder:'选择新题源码的项目文件夹'});if(!chosen)return;folder=chosen.folder;}
    const directory=vscode.Uri.joinPath(folder.uri,'编程网格',target.group),uri=vscode.Uri.joinPath(directory,target.id+'.cpp');
    await vscode.workspace.fs.createDirectory(directory);
    // WorkspaceEdit creates only if missing; existing code is never replaced.
    const edit=new vscode.WorkspaceEdit();edit.createFile(uri,{ignoreIfExists:true});
    if(!await vscode.workspace.applyEdit(edit))throw new Error('未能创建本题源码文件。');
    return vscode.workspace.openTextDocument(uri);
  }
  async activate(fromUrl,targetUrl){
    if(this.switching)throw new Error('正在切题，请稍候。');
    const from=identity(fromUrl),target=identity(targetUrl);
    if(!from||!target||from.group!==target.group)throw new Error('请选择当前作业内的题目。');
    this.switching=true;
    try{
      const client=await this.backend();
      if(identity(this.display().url)?.key!==from.key)throw new Error('当前题目已改变，请刷新列表。');
      await this.rememberCurrent(client,fromUrl);
      const document=await this.documentFor(client,targetUrl);if(!document)return {cancelled:true};
      this.blocked=true;await this.context.workspaceState.update(PENDING_KEY,true);
      const result=await client.request({type:'activate_problem',problemUrl:fromUrl,targetUrl});
      // Binding is explicit, only after Chrome has read the target problem.
      await client.request({type:'context_bind',uri:document.uri.toString(),binding:{problemUrl:result.url,tabId:result.tabId},requireActive:true});
      const visible=identity(this.display().url);if(visible&&visible.key!==target.key&&visible.key!==from.key)throw new Error('浏览器已切换到另一题，请重新选择。');
      await this.context.workspaceState.update(MAP_KEY,{...this.context.workspaceState.get(MAP_KEY,{}),[target.key]:document.uri.toString()});
      await vscode.window.showTextDocument(document,{preview:false,preserveFocus:false});
      await this.clearBlock();
      return result;
    }catch(error){throw new Error(error.message+(this.blocked?' 请刷新题单并重试选择题目，或使用“关联当前 C++ 文件与 Chrome 题目”完成关联。':''));}
    finally{this.switching=false;}
  }
}
module.exports={ProblemNavigation};
