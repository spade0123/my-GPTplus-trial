const vscode=require('vscode');
const {sourceStem}=require('./source-template.cjs');
const {sourceTemplate}=require('./template-settings.cjs');
const {assignmentDirectory}=require('./assignment-files.cjs');
const CREATED_KEY='gridCoach.createdProblemFiles.v1';
const MAP_KEY='gridCoach.problemFiles.v1',PENDING_KEY='gridCoach.navigationPending.v1';
function identity(value){
  try{const u=new URL(value),m=u.pathname.match(/^\/(?:course\/)?probset\/([a-f0-9]{32})\/([a-f0-9]{32})\/ide\.do$/i);return u.origin==='https://programming.pku.edu.cn'&&!u.username&&!u.password&&!u.search&&!u.hash&&m?{key:m[1].toLowerCase()+'/'+m[2].toLowerCase(),group:m[1].toLowerCase(),id:m[2].toLowerCase()}:null;}catch{return null;}
}
class ProblemNavigation{
  constructor({context,backend,currentEditor,display,configureBuild}){Object.assign(this,{context,backend,currentEditor,display,configureBuild});this.switching=false;this.blocked=context.workspaceState.get(PENDING_KEY,false);}
  assertSource(uri){
    const mapping=this.context.workspaceState.get(MAP_KEY,{}),current=identity(this.display().url);
    if(current&&Object.values(mapping).includes(uri)&&mapping[current.key]!==uri)throw new Error('当前源码关联的是另一题，请从题目列表切换，或明确重新关联文件。');
  }
  async associate(uri,url){const target=identity(url);if(target)await this.context.workspaceState.update(MAP_KEY,{...this.context.workspaceState.get(MAP_KEY,{}),[target.key]:uri});}
  async clearBlock(){await this.context.workspaceState.update(PENDING_KEY,false);this.blocked=false;}
  async progress(url){return (await this.backend()).request({type:'problem_progress',problemUrl:url});}
  async list(url,forceDeadline=false){return (await this.backend()).request({type:'list_problems',problemUrl:url,forceDeadline});}
  async rememberAssignment(url,title){const target=identity(url);if(target&&typeof title==='string'&&title.trim())await this.context.workspaceState.update('gridCoach.assignmentNames.v1',{...this.context.workspaceState.get('gridCoach.assignmentNames.v1',{}),[target.group]:title.trim().slice(0,300)});}
  async directoryFor(client,folder,target){
    let title=this.context.workspaceState.get('gridCoach.assignmentNames.v1',{})[target.group];
    if(!title){
      const current=this.display();if(identity(current.url)?.group===target.group){const list=await this.list(current.url);await this.rememberAssignment(current.url,list.assignmentName);title=list.assignmentName;}
    }
    let moved;
    const remap=(uri,from,to)=>uri.startsWith(from.toString()+'/')?to.toString()+uri.slice(from.toString().length):uri;
    return assignmentDirectory(folder,target.group,title,{
      beforeRename:async(from,to)=>{
        const maps=[MAP_KEY,CREATED_KEY].map(key=>[key,this.context.workspaceState.get(key,{})]);
        const uris=[...new Set(maps.flatMap(([,map])=>Object.values(map)).filter(uri=>uri.startsWith(from.toString()+'/')))];
        if(uris.length)await client.request({type:'context_relocate',entries:uris.map(uri=>({from:uri,to:remap(uri,from,to)}))});
        moved=maps.map(([key,map])=>[key,Object.fromEntries(Object.entries(map).map(([id,uri])=>[id,remap(uri,from,to)]))]);
      },
      afterRename:async()=>{for(const [key,map]of moved||[])await this.context.workspaceState.update(key,map);}
    });
  }
  async rememberCurrent(client,url){
    const editor=this.currentEditor();if(editor?.document.languageId!=='cpp'||editor.document.isClosed)return;
    const uri=editor.document.uri.toString(),saved=await client.request({type:'context_lookup',uri});
    if(identity(saved.binding?.problemUrl)?.key!==identity(url)?.key)return;
    await this.context.workspaceState.update(MAP_KEY,{...this.context.workspaceState.get(MAP_KEY,{}),[identity(url).key]:uri});
  }
  async documentFor(client,url,problem={}){
    const target=identity(url),folders=vscode.workspace.workspaceFolders||[],activeUri=this.currentEditor()?.document.uri;
    let folder=folders.length===1?folders[0]:activeUri?vscode.workspace.getWorkspaceFolder(activeUri):undefined;
    // Resolve/rename the managed directory before reading cached URIs.
    let directory=folder?await this.directoryFor(client,folder,target):null;
    const mapping=this.context.workspaceState.get(MAP_KEY,{}),saved=mapping[target.key];
    if(saved&&identity((await client.request({type:'context_lookup',uri:saved})).binding?.problemUrl)?.key===target.key){
      const open=vscode.workspace.textDocuments.find(document=>document.uri.toString()===saved);
      if(open&&!open.isClosed)return open;
      if(!saved.startsWith('untitled:'))try{return await vscode.workspace.openTextDocument(vscode.Uri.parse(saved));}catch{/* A moved/deleted file can be chosen again. */}
    }
    const created=this.context.workspaceState.get(CREATED_KEY,{})[target.key];
    if(created){
      const record=await client.request({type:'context_lookup',uri:created});
      if(!record.binding||identity(record.binding.problemUrl)?.key===target.key)try{return await vscode.workspace.openTextDocument(vscode.Uri.parse(created));}catch{}
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
    const render=fileName=>sourceTemplate(this.context,{problemTitle:problem.title,problemId:target.id,problemNumber:problem.number,fileName});
    if(!folders.length)return vscode.workspace.openTextDocument({language:'cpp',content:await render(sourceStem(problem.title,problem.number)+'.cpp')});
    if(!folder){const chosen=await vscode.window.showQuickPick(folders.map(item=>({label:item.name,folder:item})),{placeHolder:'选择新题源码的项目文件夹'});if(!chosen)return;folder=chosen.folder;}
    directory ||= await this.directoryFor(client,folder,target);
    await vscode.workspace.fs.createDirectory(directory);
    const exists=async uri=>{try{await vscode.workspace.fs.stat(uri);return true;}catch(error){if(['FileNotFound','ENOENT'].includes(error.code))return false;throw error;}};
    // Keep legacy ID-named files usable. New names are short and collision-safe.
    const legacy=vscode.Uri.joinPath(directory,target.id+'.cpp');
    if(await exists(legacy))return vscode.workspace.openTextDocument(legacy);
    const stem=sourceStem(problem.title,problem.number)+'-'+target.id.slice(0,8);
    for(let suffix=0;suffix<100;suffix++){
      const uri=vscode.Uri.joinPath(directory,stem+(suffix?'-'+suffix:'')+'.cpp');
      if(await exists(uri))continue;
      const template=await render(uri.path.split('/').at(-1));
      const edit=new vscode.WorkspaceEdit();edit.createFile(uri,{overwrite:false,ignoreIfExists:false});edit.insert(uri,new vscode.Position(0,0),template);
      if(!await vscode.workspace.applyEdit(edit))throw new Error('未能创建本题源码文件；已有文件未被覆盖。');
      await this.context.workspaceState.update(CREATED_KEY,{...this.context.workspaceState.get(CREATED_KEY,{}),[target.key]:uri.toString()});
      const document=await vscode.workspace.openTextDocument(uri);if(!await document.save())throw new Error('模板已建立但未能写入磁盘，请先保存新文件。');return document;
    }
    throw new Error('同名文件过多，请整理本题目录。');
  }

  async activate(fromUrl,targetUrl,problem={}){
    if(this.switching)throw new Error('正在切题，请稍候。');
    const from=identity(fromUrl),target=identity(targetUrl);
    if(!from||!target||from.group!==target.group)throw new Error('请选择当前作业内的题目。');
    this.switching=true;
    try{
      const client=await this.backend();
      if(identity(this.display().url)?.key!==from.key)throw new Error('当前题目已改变，请刷新列表。');
      await this.rememberCurrent(client,fromUrl);
      const document=await this.documentFor(client,targetUrl,problem);if(!document)return {cancelled:true};
      this.blocked=true;await this.context.workspaceState.update(PENDING_KEY,true);
      const result=await client.request({type:'activate_problem',problemUrl:fromUrl,targetUrl});
      // Binding is explicit, only after Chrome has read the target problem.
      await client.request({type:'context_bind',uri:document.uri.toString(),binding:{problemUrl:result.url,tabId:result.tabId},requireActive:true});
      const visible=identity(this.display().url);if(visible&&visible.key!==target.key&&visible.key!==from.key)throw new Error('浏览器已切换到另一题，请重新选择。');
      await this.context.workspaceState.update(MAP_KEY,{...this.context.workspaceState.get(MAP_KEY,{}),[target.key]:document.uri.toString()});
      await vscode.window.showTextDocument(document,{viewColumn:this.currentEditor()?.viewColumn||vscode.ViewColumn.One,preview:false,preserveFocus:false});
      this.followedKey=target.key;
      await this.configureBuild?.(document);
      await this.clearBlock();
      return result;
    }catch(error){throw new Error(error.message+(this.blocked?' 请刷新题单并重试选择题目，或使用“关联当前 C++ 文件与 Chrome 题目”完成关联。':''));}
    finally{this.switching=false;}
  }
  async followDisplay(value,problem={}){
    const target=identity(value.url);
    if(!target||this.switching||this.followedKey===target.key)return;
    this.switching=true;
    const stillCurrent=()=>{const current=this.display();return current.connected&&current.status==='ready'&&identity(current.url)?.key===target.key&&current.tabId===value.tabId;};
    try{
      const client=await this.backend();if(!stillCurrent())return;
      const editor=this.currentEditor();
      if(editor?.document.languageId==='cpp'&&!editor.document.isClosed){
        const uri=editor.document.uri.toString(),record=await client.request({type:'context_lookup',uri});
        if(record.binding?.problemUrl)await this.associate(uri,record.binding.problemUrl);
      }
      const document=await this.documentFor(client,value.url,problem);
      if(!document||!stillCurrent())return;
      // Browser has already navigated: only bind/open its source, never navigate it again.
      await client.request({type:'context_bind',uri:document.uri.toString(),binding:{problemUrl:value.url,tabId:value.tabId},requireActive:true});
      if(!stillCurrent())return;
      await this.associate(document.uri.toString(),value.url);
      if(!stillCurrent())return;
      await vscode.window.showTextDocument(document,{viewColumn:editor?.viewColumn||vscode.ViewColumn.One,preview:false,preserveFocus:false});
      this.followedKey=target.key;await this.clearBlock();
      await this.configureBuild?.(document);
      return {opened:true};
    }finally{this.switching=false;}
  }
}
module.exports={ProblemNavigation,identity};
