import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {sourceEnvironment,captureDiagnostics} from '../src/source-environment.js';
import {Capture,fingerprint,saveCapture,captureFromRecord} from '../src/browser-review.js';
import {createVscodeService} from '../src/vscode-service.js';
const require=createRequire(import.meta.url),repo=new URL('../',import.meta.url);
const group='a'.repeat(32),id='b'.repeat(32),other='c'.repeat(32),url=`https://programming.pku.edu.cn/probset/${group}/${id}/ide.do`,next=url.replace(id,other);
const MAP='gridCoach.problemFiles.v1',CREATED='gridCoach.createdProblemFiles.v1';
class Uri{
  constructor(scheme,authority,pathname,query='',fragment=''){Object.assign(this,{scheme,authority,path:pathname,query,fragment});}
  static parse(value){const m=String(value).match(/^([\w-]+):\/\/([^/]*)([^?#]*)(?:\?([^#]*))?(?:#(.*))?$/);if(!m)throw new Error('bad fixture URI');return new Uri(m[1],m[2],decodeURIComponent(m[3]),m[4]||'',m[5]||'');}
  static file(value){return new Uri('file','',value.replaceAll('\\','/'));}
  static joinPath(uri,...parts){return uri.with({path:path.posix.join(uri.path,...parts)});}
  with(change){return Object.assign(new Uri(this.scheme,this.authority,this.path,this.query,this.fragment),change);}
  toString(){return `${this.scheme}://${this.authority}${this.path.split('/').map(encodeURIComponent).join('/')}${this.query?'?'+this.query:''}${this.fragment?'#'+this.fragment:''}`;}
  get fsPath(){if(this.scheme==='vscode-remote')throw new Error('Remote fsPath was incorrectly used on Windows');return this.path;}
}
const remote=p=>new Uri('vscode-remote','wsl+Ubuntu-24.04',p);
function fixture(){
  const files=new Map(),docs=[],state=new Map(),settings=new Map(),shown=[],folder={name:'WSL coursework',uri:remote('/home/student/课程 项目')};
  const missing=()=>Object.assign(new Error('missing fixture file'),{code:'FileNotFound'});
  const mkdir=uri=>{if(uri.path!=='/')mkdir(uri.with({path:path.posix.dirname(uri.path)}));if(!files.has(uri.toString()))files.set(uri.toString(),{type:2});};
  const put=(uri,text,type=1)=>{mkdir(uri.with({path:path.posix.dirname(uri.path)}));files.set(uri.toString(),{type,data:Buffer.from(text)});};
  const get=uri=>{const item=files.get(uri.toString());if(!item)throw missing();return item;};
  const workspace={workspaceFolders:[folder],textDocuments:docs,
    getWorkspaceFolder:uri=>uri.scheme===folder.uri.scheme&&uri.authority===folder.uri.authority&&(uri.path===folder.uri.path||uri.path.startsWith(folder.uri.path+'/'))?folder:undefined,
    getConfiguration:()=>({get:(key,fallback)=>settings.has(key)?settings.get(key):fallback,update:async(key,value)=>settings.set(key,value)}),
    fs:{stat:async uri=>{const item=get(uri);return {type:item.type,size:item.data?.length||0,mtime:1};},createDirectory:async uri=>mkdir(uri),readFile:async uri=>get(uri).data,writeFile:async(uri,data)=>put(uri,data),readDirectory:async uri=>[...files].filter(([key])=>{const item=Uri.parse(key);return item.scheme===uri.scheme&&item.authority===uri.authority&&path.posix.dirname(item.path)===uri.path&&item.path!==uri.path;}).map(([key,item])=>[path.posix.basename(Uri.parse(key).path),item.type])},
    openTextDocument:async uri=>{
      const existing=docs.find(doc=>doc.uri.toString()===uri.toString());if(existing)return existing;
      const item=get(uri),doc={uri,fileName:uri.path,languageId:uri.path.endsWith('.cpp')?'cpp':'jsonc',isClosed:false,isDirty:false,text:item.data?.toString()||'',version:1,
        getText(){return this.text;},positionAt:offset=>offset,async save(){put(this.uri,this.text);this.isDirty=false;return true;}};
      docs.push(doc);return doc;
    },
    applyEdit:async edit=>{
      for(const item of edit.items){
        if(item.kind==='rename'){
          const from=item.from.toString(),to=item.to.toString();if(files.has(to))throw new Error('fixture refuses overwrite');
          for(const [key,value]of [...files])if(key===from||key.startsWith(from+'/')){files.delete(key);files.set(to+key.slice(from.length),value);}
          for(const doc of docs){const key=doc.uri.toString();if(key===from||key.startsWith(from+'/')){doc.uri=Uri.parse(to+key.slice(from.length));doc.fileName=doc.uri.path;}}
        }else if(item.kind==='create')put(item.uri,'');
        else{
          const doc=await workspace.openTextDocument(item.uri);doc.text=item.text;doc.isDirty=true;
        }
      }
      return true;
    }
  };
  class Edit{items=[];renameFile(from,to){this.items.push({kind:'rename',from,to});}createFile(uri){this.items.push({kind:'create',uri});}insert(uri,position,text){this.items.push({kind:'insert',uri,text});}replace(uri,range,text){this.items.push({kind:'replace',uri,text});}}
  const vscode={Uri,workspace,FileType:{File:1,Directory:2,SymbolicLink:64},WorkspaceEdit:Edit,Position:class{},Range:class{},ViewColumn:{One:1},ConfigurationTarget:{Global:1},
    window:{showTextDocument:async doc=>{shown.push(doc);return {document:doc};},showQuickPick:async choices=>choices[0],setStatusBarMessage(){}}};
  const context={extensionPath:path.resolve(new URL('../vscode-extension',import.meta.url).pathname.replace(/^\/(\w:)/,'$1')),extension:{packageJSON:{version:'fixture'}},globalStorageUri:Uri.file('/local/storage'),workspaceState:{get:(key,fallback)=>state.get(key)??fallback,update:async(key,value)=>state.set(key,value)}};
  const cache=new Map();
  function load(name){
    if(cache.has(name))return cache.get(name).exports;
    const module={exports:{}};cache.set(name,module);
    const filename=path.resolve(context.extensionPath,name);
    const localRequire=request=>request==='vscode'?vscode:request==='./template-settings.cjs'&&name==='problem-navigation.cjs'?{sourceTemplate:async()=> 'int main(){return 0;}\n'}:request.startsWith('./')&&!request.startsWith('./vendor/')?load(request.slice(2)):createRequire(filename)(request);
    vm.runInNewContext(require('node:fs').readFileSync(filename,'utf8'),{require:localRequire,module,Buffer,TextDecoder,process,URL,console,setTimeout,clearTimeout},{filename});return module.exports;
  }
  const contexts=new Map(),calls=[];let display={url,tabId:8,status:'ready',connected:true,page:{title:'日期'}};
  const client={request:async message=>{calls.push(message);if(message.type==='context_lookup')return contexts.get(message.uri)||{};
    if(message.type==='context_relocate'){for(const item of message.entries)if(contexts.has(item.from))contexts.set(item.to,structuredClone(contexts.get(item.from)));return {};}
    if(message.type==='context_bind'){contexts.set(message.uri,{binding:message.binding});return {};}
    if(message.type==='list_problems')return {assignmentName:'练习（4）',problems:[]};
    if(message.type==='activate_problem'){display={...display,url:message.targetUrl};return {url:display.url,tabId:8,page:{title:'第二题'}};}
    throw new Error('Unexpected fixture request '+message.type);
  }};
  mkdir(folder.uri);
  return {vscode,context,load,files,put,get,docs,state,settings,folder,shown,client,contexts,calls,display:()=>display,setDisplay:value=>display=value};
}

test('URI relocation preserves WSL authority, Chinese/percent paths and open panel keys',()=>{
  const f=fixture(),{relocateUri,relocatePanels}=f.load('source-links.cjs');
  const old=remote('/home/student/旧目录'),to=remote('/home/student/新目录'),uri=Uri.joinPath(old,'题目 100%.cpp').toString();
  const moved=relocateUri(uri,[{oldUri:old,newUri:to}]);assert.equal(Uri.parse(moved).path,'/home/student/新目录/题目 100%.cpp');
  assert.equal(relocateUri(uri,[{oldUri:old.with({authority:'wsl+Other'}),newUri:to}]),uri);
  assert.equal(relocateUri(uri,[{oldUri:remote('/home/student/旧目'),newUri:to}]),uri);
  const state={uri},panels=new Map([[uri,state]]);relocatePanels(panels,[{oldUri:old,newUri:to}]);assert.equal(panels.get(moved),state);assert.equal(state.uri,moved);
});

test('WSL assignment rename keeps dirty source, migrates bindings/panels, and reuses the source',async()=>{
  const f=fixture(),{ProblemNavigation}=f.load('problem-navigation.cjs'),{relocatePanels}=f.load('source-links.cjs');
  const old=Uri.joinPath(f.folder.uri,'编程网格',group),source=Uri.joinPath(old,'日期 100%.cpp');f.put(source,'int main(){return 0;}');
  const doc=await f.vscode.workspace.openTextDocument(source);doc.text='// unsaved\nint main(){return 2;}';doc.isDirty=true;
  f.state.set(MAP,{[group+'/'+id]:source.toString()});f.state.set(CREATED,{[group+'/'+id]:source.toString()});f.contexts.set(source.toString(),{binding:{problemUrl:url,tabId:8}});
  const panels=new Map([[source.toString(),{uri:source.toString()}]]);
  const nav=new ProblemNavigation({context:f.context,backend:async()=>f.client,currentEditor:()=>({document:doc,viewColumn:1}),display:f.display,knownSourceUris:()=>[...panels.keys()],onSourcesRelocated:files=>relocatePanels(panels,files)});
  const recovered=await nav.documentFor(f.client,url,{title:'日期'});
  assert.equal(recovered,doc);assert.equal(doc.isDirty,true);assert.match(doc.getText(),/unsaved/);assert.match(doc.uri.path,/练习（4）/);
  assert.equal(f.state.get(MAP)[group+'/'+id],doc.uri.toString());assert.equal(f.contexts.get(doc.uri.toString()).binding.problemUrl,url);assert(panels.has(doc.uri.toString()));
  await nav.relocateFiles([{oldUri:source,newUri:doc.uri}]);assert.equal(f.state.get(MAP)[group+'/'+id],doc.uri.toString());
});

test('single-file date/Explorer rename updates both maps and backend bindings without changing problem identity',async()=>{
  const f=fixture(),{ProblemNavigation}=f.load('problem-navigation.cjs'),source=Uri.joinPath(f.folder.uri,'a.cpp'),to=Uri.joinPath(f.folder.uri,'按日期整理','2026-10-23','a.cpp');
  f.state.set(MAP,{[group+'/'+id]:source.toString()});f.state.set(CREATED,{[group+'/'+id]:source.toString()});f.contexts.set(source.toString(),{binding:{problemUrl:url,tabId:8}});
  const nav=new ProblemNavigation({context:f.context,backend:async()=>f.client,currentEditor:()=>null,display:f.display});await nav.relocateFiles([{oldUri:source,newUri:to}]);
  assert.equal(f.state.get(MAP)[group+'/'+id],to.toString());assert.equal(f.state.get(CREATED)[group+'/'+id],to.toString());assert.equal(f.contexts.get(to.toString()).binding.problemUrl,url);
});

test('browser follow opens bound WSL source without navigation or requiring assignment metadata',async()=>{
  const f=fixture(),{ProblemNavigation}=f.load('problem-navigation.cjs'),source=Uri.joinPath(f.folder.uri,'已有课程.cpp');f.put(source,'int main(){return 0;}');
  f.state.set(MAP,{[group+'/'+id]:source.toString()});f.contexts.set(source.toString(),{binding:{problemUrl:url,tabId:8}});let configured=0;
  const nav=new ProblemNavigation({context:f.context,backend:async()=>f.client,currentEditor:()=>null,display:f.display,configureBuild:async()=>configured++});
  assert.equal((await nav.followDisplay(f.display())).opened,true);assert.equal(f.shown.at(-1).uri.toString(),source.toString());assert.equal(configured,1);
  assert(!f.calls.some(call=>['list_problems','activate_problem'].includes(call.type)));assert.equal(await nav.followDisplay(f.display()),undefined);
});

test('rapid browser change while binding never opens the stale source',async()=>{
  const f=fixture(),{ProblemNavigation}=f.load('problem-navigation.cjs'),source=Uri.joinPath(f.folder.uri,'已有.cpp');f.put(source,'int main(){return 0;}');
  f.state.set(MAP,{[group+'/'+id]:source.toString()});f.contexts.set(source.toString(),{binding:{problemUrl:url,tabId:8}});
  const original=f.client.request;f.client.request=async message=>{const value=await original(message);if(message.type==='context_bind')f.setDisplay({...f.display(),url:next});return value;};
  const nav=new ProblemNavigation({context:f.context,backend:async()=>f.client,currentEditor:()=>null,display:f.display});await nav.followDisplay(f.display());assert.equal(f.shown.length,0);
});

test('explicit previous/next navigation creates a WSL source and binds it only after website activation',async()=>{
  const f=fixture(),{ProblemNavigation}=f.load('problem-navigation.cjs'),source=Uri.joinPath(f.folder.uri,'当前.cpp');f.put(source,'int main(){return 0;}');
  const document=await f.vscode.workspace.openTextDocument(source);document.isDirty=true;document.text='// keep my work\nint main(){return 1;}';
  f.contexts.set(source.toString(),{binding:{problemUrl:url,tabId:8}});let builds=0;
  const nav=new ProblemNavigation({context:f.context,backend:async()=>f.client,currentEditor:()=>({document,viewColumn:1}),display:f.display,configureBuild:async()=>builds++});
  const result=await nav.activate(url,next,{title:'计算鞍点',number:2});assert.equal(result.url,next);assert.equal(document.isDirty,true);assert.match(document.text,/keep my work/);
  const opened=f.shown.at(-1);assert.equal(opened.uri.scheme,'vscode-remote');assert.match(opened.uri.path,/编程网格\/练习（4）\//);assert.equal(f.contexts.get(opened.uri.toString()).binding.problemUrl,next);assert.equal(builds,1);
  assert(f.calls.findIndex(item=>item.type==='activate_problem')<f.calls.findIndex(item=>item.type==='context_bind'));assert.equal(nav.blocked,false);
});

test('same-named assignments never merge their folders or overwrite existing sources',async()=>{
  const f=fixture(),{assignmentDirectory}=f.load('assignment-files.cjs'),first=Uri.joinPath(f.folder.uri,'编程网格','练习');
  f.put(Uri.joinPath(first,'.grid-assignment.json'),JSON.stringify({group:'d'.repeat(32),title:'练习'}));f.put(Uri.joinPath(first,'keep.cpp'),'keep');
  const chosen=await assignmentDirectory(f.folder,group,'练习');assert.equal(chosen.path,path.posix.join(f.folder.uri.path,'编程网格','练习（2）'));assert.equal(f.get(Uri.joinPath(first,'keep.cpp')).data.toString(),'keep');
});

test('managed source index recovers files when WSL workspace state is recreated and ignores path traversal entries',async()=>{
  const f=fixture(),{ProblemNavigation}=f.load('problem-navigation.cjs'),{assignmentDirectory,recordManagedSource}=f.load('assignment-files.cjs');
  const directory=await assignmentDirectory(f.folder,group,'练习（4）'),source=Uri.joinPath(directory,'existing.cpp');f.put(source,'// keep\nint main(){return 0;}');await recordManagedSource(source,group,id);
  const nav=new ProblemNavigation({context:f.context,backend:async()=>f.client,currentEditor:()=>null,display:f.display});const document=await nav.documentFor(f.client,url,{title:'原题'});
  assert.equal(document.uri.toString(),source.toString());assert.match(document.getText(),/keep/);
  const marker=Uri.joinPath(directory,'.grid-assignment.json'),data=JSON.parse(f.get(marker).data.toString());data.files[other]='../escape.cpp';f.put(marker,JSON.stringify(data));
  assert.equal(await f.load('assignment-files.cjs').readSourceIndex(directory,group,other),undefined);
});

test('WSL build task uses Linux process paths, preserves JSONC/other tasks and upgrades old Windows task',async()=>{
  const f=fixture(),{configureBuildTask}=f.load('build-task.cjs'),source=Uri.joinPath(f.folder.uri,'题目 空格.cpp'),tasksUri=Uri.joinPath(f.folder.uri,'.vscode','tasks.json');
  f.put(tasksUri,'{\n// keep my task\n"version":"2.0.0","tasks":[{"label":"original","group":{"kind":"build","isDefault":true},"command":"g++"}]}');
  f.settings.set('build.arguments',['-std=c++20','-DNAME=hello world']);let backendCalls=0;
  await configureBuildTask(f.context,async()=>{backendCalls++;throw new Error('Windows backend must not be used');},{uri:source});
  const text=f.get(tasksUri).data.toString(),config=require('jsonc-parser').parse(text),task=config.tasks.at(-1);
  assert(text.includes('// keep my task'));assert.equal(config.tasks[0].group.isDefault,false);assert.equal(task.command,'/bin/sh');assert.equal(task.args[0],f.folder.uri.path+'/.vscode/grid-build.sh');assert.equal(task.args[1],'${file}');assert.equal(task.args[2],'g++');assert.equal(task.args[4],'-DNAME=hello world');assert.equal(backendCalls,0);
  assert(!f.get(Uri.joinPath(f.folder.uri,'.vscode','grid-build.sh')).data.includes(13));
  const doc=await f.vscode.workspace.openTextDocument(tasksUri);config.tasks[1].command='C:\\node.exe';config.tasks[1].args=['C:\\extension\\local-compile.cjs','C:\\g++.exe','${file}','[]'];doc.text=JSON.stringify(config);await doc.save();
  await configureBuildTask(f.context,async()=>{throw new Error('not local');},{uri:source});const upgraded=JSON.parse(f.get(tasksUri).data.toString()).tasks[1];assert.equal(upgraded.command,'/bin/sh');assert(!upgraded.args.some(arg=>/C:\\/.test(arg)));
});

test('remote template paths use WSL URI, never Windows fsPath',()=>{
  const f=fixture(),{configuredFile}=f.load('template-settings.cjs');f.settings.set('source.templateFile','/home/student/模板 100%.cpp');
  assert.equal(configuredFile().scheme,'vscode-remote');assert.equal(configuredFile().authority,f.folder.uri.authority);assert.equal(configuredFile().path,'/home/student/模板 100%.cpp');
  f.settings.set('source.templateFile',remote('/opt/template.cpp').toString());assert.equal(configuredFile().path,'/opt/template.cpp');
});

test('history exports default to the WSL workspace instead of a Windows relative file',async()=>{
  const f=fixture();let receive,defaultUri;
  f.context.extensionUri=Uri.file(f.context.extensionPath);f.context.subscriptions=[];
  f.vscode.window.createWebviewPanel=()=>({webview:{cspSource:'fixture',asWebviewUri:uri=>uri,onDidReceiveMessage:callback=>{receive=callback;return {dispose(){}};},postMessage:async()=>{}},onDidDispose(){}});
  f.vscode.window.showSaveDialog=async options=>{defaultUri=options.defaultUri;return defaultUri;};
  f.load('history-view.cjs').openHistory({context:f.context,backend:async()=>{throw new Error('export should not call AI');}});
  await receive({type:'export',text:'fixture history'});assert.equal(defaultUri.scheme,'vscode-remote');assert.equal(defaultUri.authority,f.folder.uri.authority);assert.equal(f.get(defaultUri).data.toString(),'fixture history');
});

test('remote captures preserve environment and skip Windows diagnostics; local snapshots remain distinct',async()=>{
  assert.equal(sourceEnvironment(remote('/home/a.cpp').toString()),'wsl');assert.equal(sourceEnvironment('file:///C:/a.cpp'),undefined);let calls=0;
  const input={url,title:'开发者自拟题',problem:{description:'开发者自拟：输出整数，作为隔离验证使用。',input:'无',output:'整数',sampleInput:'',sampleOutput:'1'},code:'int main(){return 0;}',runtime:{}};
  const local=Capture.parse(input),wsl=Capture.parse({...input,sourceEnvironment:'wsl'});assert.notEqual(fingerprint(local),fingerprint(wsl));
  const compile=async()=>{calls++;return {status:'passed'};};assert.equal((await captureDiagnostics(wsl,compile)).status,'not_requested');assert.equal(calls,0);await captureDiagnostics(local,compile);assert.equal(calls,1);
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'grid-wsl-record-')),prior=process.env.PKU_DATA_DIR;process.env.PKU_DATA_DIR=directory;
  try{
    const record=await saveCapture(wsl);assert.equal((await captureFromRecord(record)).sourceEnvironment,'wsl');
    const page={problemMatches:true,problemUrl:url,title:input.title,problem:input.problem,missingSections:[]};
    const service=createVscodeService({currentProblem:async()=>({connected:true,url,tabId:8,status:'ready',page}),browser:async()=>({problem:page})});
    const old=remote('/home/旧/题.cpp').toString(),to=remote('/home/新/题.cpp').toString();await service.handle({type:'context_bind',uri:old,binding:{problemUrl:url,tabId:8}});
    await service.handle({type:'context_relocate',entries:[{from:old,to}]});assert.equal((await service.handle({type:'context_lookup',uri:to})).binding.problemUrl,url);assert.equal((await service.handle({type:'context_lookup',uri:old})).binding.problemUrl,url);
    await service.handle({type:'ui_save',uri:to,ui:{question:'new draft after rename',chatOpen:true}});
    await service.handle({type:'context_relocate',entries:[{from:old,to}]});assert.equal((await service.handle({type:'context_lookup',uri:to})).ui.question,'new draft after rename');
    const target2=remote('/home/conflict.cpp').toString(),clean=remote('/home/not-copied.cpp').toString(),page2={...page,problemUrl:next};
    const service2=createVscodeService({browser:async()=>({problem:page2})});await service2.handle({type:'context_bind',uri:target2,binding:{problemUrl:next,tabId:8}});
    await assert.rejects(service.handle({type:'context_relocate',entries:[{from:old,to:clean},{from:old,to:target2}]}),/其他题目关联/);assert.equal((await service.handle({type:'context_lookup',uri:clean})).binding,undefined);
    let samples=0;const remoteService=createVscodeService({currentProblem:async()=>({connected:true,url,tabId:8,status:'ready',page}),browser:async()=>({problem:page,runtime:{}}),sampleRunner:async()=>{samples++;throw new Error('wrong runtime');}});
    await assert.rejects(remoteService.handle({type:'run_sample',actionId:randomUUID(),source:{uri:to,name:'题.cpp',code:input.code,version:1}}),/不会交给 Windows/);assert.equal(samples,0);
  }finally{if(prior===undefined)delete process.env.PKU_DATA_DIR;else process.env.PKU_DATA_DIR=prior;assert(path.basename(directory).startsWith('grid-wsl-record-'));await fs.rm(directory,{recursive:true,force:true});}
});
