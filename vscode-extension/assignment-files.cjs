const vscode=require('vscode'),path=require('node:path');
const marker='.grid-assignment.json';
const validFiles=value=>Object.fromEntries(Object.entries(value&&typeof value==='object'?value:{}).filter(([id,name])=>/^[a-f0-9]{32}$/i.test(id)&&typeof name==='string'&&name.length<=240&&!/[\\/\u0000-\u001f]/.test(name)&&/\.(?:cpp|cc|cxx|c)$/i.test(name)));
async function readSourceIndex(directory,group,id){
  try{const data=JSON.parse(Buffer.from(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(directory,marker))).toString('utf8'));return data.group===group?validFiles(data.files)[id]:undefined;}catch{return undefined;}
}
async function recordManagedSource(source,group,id){
  if(!['file','vscode-remote'].includes(source.scheme))return;
  const directory=source.with({path:path.posix.dirname(source.path),query:'',fragment:''}),uri=vscode.Uri.joinPath(directory,marker);
  let stat;try{stat=await vscode.workspace.fs.stat(uri);}catch(error){if(['FileNotFound','ENOENT'].includes(error.code))return;throw error;}
  if(stat.type&vscode.FileType.SymbolicLink)throw new Error('题单文件索引不能是符号链接。');
  const data=JSON.parse(Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8'));if(data.group!==group)return;
  const files={...validFiles(data.files),[id]:path.posix.basename(source.path)};
  await vscode.workspace.fs.writeFile(uri,Buffer.from(JSON.stringify({...data,files},null,2)+'\n'));
}
const safeName=value=>{
  let name=String(value||'').normalize('NFC').replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g,'_').replace(/\s+/g,' ').trim().replace(/[. ]+$/g,'').slice(0,70).replace(/[. ]+$/g,'');
  if(!name||name==='.'||name==='..')return '';
  if(/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name))name='题单 '+name;
  return name;
};
async function exists(uri){try{return await vscode.workspace.fs.stat(uri);}catch(e){if(['FileNotFound','ENOENT'].includes(e.code))return null;throw e;}}
function checkChild(base,child){
  if(base.scheme!==child.scheme||base.authority!==child.authority||base.query||child.query||base.fragment||child.fragment)throw new Error('目录不属于同一个项目文件系统。');
  // Remote URI paths are POSIX paths even though this UI extension runs on Windows.
  const api=base.scheme==='file'?path:path.posix;
  const parent=base.scheme==='file'?api.resolve(base.fsPath):api.normalize(base.path),target=child.scheme==='file'?api.resolve(child.fsPath):api.normalize(child.path);
  const relative=api.relative(parent,target);
  if(!relative||relative==='..'||relative.startsWith('..'+api.sep)||api.isAbsolute(relative))throw new Error('目录超出当前编程网格项目范围。');
}
async function assignmentDirectory(folder,group,title,{beforeRename,afterRename}={}){
  const root=vscode.Uri.joinPath(folder.uri,'编程网格');await vscode.workspace.fs.createDirectory(root);
  if((await vscode.workspace.fs.stat(root)).type&vscode.FileType.SymbolicLink)throw new Error('编程网格目录是符号链接，请使用项目内的普通目录。');
  let existing;
  for(const [name,type]of await vscode.workspace.fs.readDirectory(root)){
    if(!(type&vscode.FileType.Directory)||type&vscode.FileType.SymbolicLink)continue;
    const uri=vscode.Uri.joinPath(root,name);
    try{const data=JSON.parse(Buffer.from(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(uri,marker))).toString('utf8'));if(data.group===group){existing=uri;break;}}catch{}
  }
  const old=vscode.Uri.joinPath(root,group),oldStat=await exists(old);
  if(!existing&&oldStat&&(oldStat.type&vscode.FileType.Directory)&&!(oldStat.type&vscode.FileType.SymbolicLink))existing=old;
  const name=safeName(title);
  if(!name&&!existing)throw new Error('尚未读到题单名字。请重新加载 Chrome 连接扩展，在题目原文页刷新题单后再切题。');
  // Already-readable directories remain stable even if the website renames an assignment.
  const readable=existing&&existing.path.split('/').at(-1)!==group;
  let directory=existing;
  if(name&&!readable){
    let available;
    for(let index=1;index<=100;index++){
      const candidate=vscode.Uri.joinPath(root,name+(index===1?'':`（${index}）`));
      if(!await exists(candidate)){available=candidate;break;}
    }
    if(!available)throw new Error('同名题单目录过多，请检查项目目录。');
    directory=available;
    if(existing&&directory.toString()!==existing.toString()){
      checkChild(root,existing);checkChild(root,directory);
      await beforeRename?.(existing,directory);
      const edit=new vscode.WorkspaceEdit();edit.renameFile(existing,directory,{overwrite:false});
      if(!await vscode.workspace.applyEdit(edit))throw new Error('题单目录改名未完成，旧文件保留。');
      await afterRename?.(existing,directory);
    }
  }
  await vscode.workspace.fs.createDirectory(directory);
  if((await exists(vscode.Uri.joinPath(directory,marker)))?.type&vscode.FileType.SymbolicLink)throw new Error('题单目录标记不能是符号链接。');
  let sourceFiles={};try{const saved=JSON.parse(Buffer.from(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(directory,marker))).toString('utf8'));if(saved.group===group)sourceFiles=validFiles(saved.files);}catch{}
  await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(directory,marker),Buffer.from(JSON.stringify({version:1,group,title:title||'',files:sourceFiles},null,2)+'\n'));
  await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(directory,'build'));
  if((await vscode.workspace.fs.stat(vscode.Uri.joinPath(directory,'build'))).type&vscode.FileType.SymbolicLink)throw new Error('build 不能是符号链接，产物未移动。');
  const ignore=vscode.Uri.joinPath(directory,'build','.gitignore');
  if(!await exists(ignore))await vscode.workspace.fs.writeFile(ignore,Buffer.from('*\n!.gitignore\n'));
  // Extensionless Linux products require both a matching source and the ELF signature.
  for(const [file,type]of await vscode.workspace.fs.readDirectory(directory)){
    if(!(type&vscode.FileType.File)||type&vscode.FileType.SymbolicLink)continue;
    const source=vscode.Uri.joinPath(directory,file),destination=vscode.Uri.joinPath(directory,'build',file);
    let artifact=/\.(?:exe|o|obj|pdb|ilk)$/i.test(file);
    if(!artifact&&directory.scheme==='vscode-remote'&&/^wsl\+/i.test(directory.authority)&&(!file.includes('.')||file.endsWith('.out'))){
      const stem=file.replace(/\.out$/,'');let paired=false;
      for(const ext of ['.cpp','.cc','.cxx','.c'])if(await exists(vscode.Uri.joinPath(directory,stem+ext))){paired=true;break;}
      if(paired&&(await vscode.workspace.fs.stat(source)).size<=20*1024*1024){const bytes=await vscode.workspace.fs.readFile(source);artifact=bytes[0]===0x7f&&bytes[1]===0x45&&bytes[2]===0x4c&&bytes[3]===0x46;}
    }
    if(!artifact)continue;
    if(await exists(destination))continue;
    checkChild(directory,source);checkChild(directory,destination);
    const edit=new vscode.WorkspaceEdit();edit.renameFile(source,destination,{overwrite:false});await vscode.workspace.applyEdit(edit);
  }
  return directory;
}
module.exports={assignmentDirectory,safeName,readSourceIndex,recordManagedSource};
