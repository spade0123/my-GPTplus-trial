const path=require('node:path');

const dateFolder=milliseconds=>{
  const date=new Date(milliseconds);
  if(Number.isNaN(date.getTime()))throw new Error('文件日期无效，已停止整理。');
  return [date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-');
};

async function planDateOrganization(vscode,root,{extensions,dateField='mtime',recursive=false}){
  const targetRoot=vscode.Uri.joinPath(root,'按日期整理'),moves=[],reserved=new Set();
  const ignored=new Set(['.git','.vscode','.codex','node_modules','dist','按日期整理']);
  async function exists(uri){
    try{await vscode.workspace.fs.stat(uri);return true;}
    catch(error){if(error.code==='FileNotFound')return false;throw error;}
  }
  async function scan(folder){
    for(const [name,type] of await vscode.workspace.fs.readDirectory(folder)){
      if(type&vscode.FileType.SymbolicLink)continue;
      const uri=vscode.Uri.joinPath(folder,name);
      if(type&vscode.FileType.Directory){if(recursive&&!ignored.has(name))await scan(uri);continue;}
      if(!(type&vscode.FileType.File)||name.startsWith('.')||extensions&&!extensions.has(path.extname(name).toLowerCase()))continue;
      const metadata=await vscode.workspace.fs.stat(uri),day=dateFolder(metadata[dateField]);
      const destinationFolder=vscode.Uri.joinPath(targetRoot,day),ext=path.extname(name),stem=ext?name.slice(0,-ext.length):name;
      let destination,index=1;
      do{
        destination=vscode.Uri.joinPath(destinationFolder,index===1?name:`${stem}-${index}${ext}`);
        index++;
      }while(reserved.has(destination.toString())||await exists(destination));
      reserved.add(destination.toString());moves.push({source:uri,destination,destinationFolder,day});
    }
  }
  await scan(root);
  return moves.sort((a,b)=>a.source.path.localeCompare(b.source.path));
}

async function applyDateOrganization(vscode,moves){
  const folders=new Map(moves.map(move=>[move.destinationFolder.toString(),move.destinationFolder]));
  for(const folder of folders.values())await vscode.workspace.fs.createDirectory(folder);
  const edit=new vscode.WorkspaceEdit();
  for(const move of moves)edit.renameFile(move.source,move.destination,{overwrite:false});
  if(!await vscode.workspace.applyEdit(edit))throw new Error('VS Code 未能完成文件移动，请在项目区核对后重试。');
}

module.exports={planDateOrganization,applyDateOrganization};
