const vscode=require('vscode'),path=require('node:path');
const templateDocuments=new WeakSet();
const {cppTemplate,templateText,DEFAULT_TEMPLATE}=require('./source-template.cjs');
function configuredFile(){
  const value=vscode.workspace.getConfiguration('gridCoach').get('source.templateFile','');
  if(typeof value!=='string')throw new Error('源码模板文件路径应为文本。');
  const file=value.trim();
  if(file&&!path.isAbsolute(file))throw new Error('源码模板文件须为绝对路径。请在插件设置中指定本机 .cpp 或文本文件。');
  return file?vscode.Uri.file(file):null;
}
async function rawTemplate(){
  const uri=configuredFile();
  if(!uri)return templateText(vscode.workspace.getConfiguration('gridCoach').get('source.template',DEFAULT_TEMPLATE));
  try{
    const stat=await vscode.workspace.fs.stat(uri);if(stat.size>360000)throw new Error('模板文件过大（最多 90000 字符）。');
    const value=new TextDecoder('utf-8',{fatal:true}).decode(await vscode.workspace.fs.readFile(uri)).replace(/^\uFEFF/,'');
    if(!value.trim()||value.length>90000||value.includes('\0'))throw new Error('模板必须是非空 UTF-8 文本，最多 90000 字符。');return value;
  }catch(error){throw new Error('读取源码模板失败：'+error.message+' 可清空 gridCoach.source.templateFile 改用设置中的文本行模板。');}
}
async function sourceTemplate(context,values){return cppTemplate(context.extension.packageJSON.version,{...values,text:await rawTemplate()});}
async function editTemplate(context){
  let uri=configuredFile();
  if(!uri){
    const raw=await rawTemplate();await vscode.workspace.fs.createDirectory(context.globalStorageUri);uri=vscode.Uri.joinPath(context.globalStorageUri,'source-template.cpp');
    let exists=false;try{await vscode.workspace.fs.stat(uri);exists=true;}catch(error){if(!['FileNotFound','ENOENT'].includes(error.code))throw error;}
    if(!exists)await vscode.workspace.fs.writeFile(uri,Buffer.from(raw+'\n','utf8'));
    await vscode.workspace.getConfiguration('gridCoach').update('source.templateFile',uri.fsPath,vscode.ConfigurationTarget.Global);
  }
  const document=await vscode.workspace.openTextDocument(uri);templateDocuments.add(document);await vscode.window.showTextDocument(document,{preview:false});
  vscode.window.setStatusBarMessage('修改模板后 Ctrl+S 保存；仅对以后创建的新题源码生效。支持 ${problemTitle}、${date} 等占位符。',8000);
}
async function previewTemplate(context,values){
  const content=await sourceTemplate(context,{fileName:'preview.cpp',...values});
  const document=await vscode.workspace.openTextDocument({language:'cpp',content});templateDocuments.add(document);await vscode.window.showTextDocument(document,{preview:false});
}
function isTemplateDocument(document){if(!document)return false;if(templateDocuments.has(document))return true;try{return document.uri.toString()===configuredFile()?.toString();}catch{return false;}}
module.exports={sourceTemplate,editTemplate,previewTemplate,isTemplateDocument};
