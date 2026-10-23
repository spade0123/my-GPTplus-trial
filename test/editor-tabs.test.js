import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {EventEmitter} from 'node:events';
import {createRequire} from 'node:module';
import {JSDOM} from 'jsdom';
const require=createRequire(import.meta.url),{EditorHost}=require('../vscode-extension/editor-host.cjs'),{sampleHtml}=require('../vscode-extension/sample-view.cjs');
const bridge=await fs.readFile(new URL('../vscode-extension/editor-bridge.js',import.meta.url),'utf8');
function fixture(strictDisposal=false){
  const created=[],errors=[],extensionUri={fsPath:'C:/fixture/extension'},vscode={ViewColumn:{Beside:-2},window:{createWebviewPanel(type,title,show,options){
    const events=new EventEmitter(),panel={type,title,show,options,viewColumn:show.viewColumn===-2?2:show.viewColumn,closed:false,sent:[],webview:{html:'',cspSource:'vscode-resource:',asWebviewUri:uri=>({toString:()=>uri.fsPath}),postMessage:async value=>{panel.sent.push(value);panel.deliver?.(value);return true;},onDidReceiveMessage:fn=>{events.on('message',fn);return {dispose:()=>events.off('message',fn)};}},onDidDispose:fn=>{events.on('dispose',fn);return {dispose:()=>events.off('dispose',fn)};},reveal(){},dispose(){if(this.closed)return;this.closed=true;events.emit('dispose');},emit:value=>events.emit('message',value)};
    if(strictDisposal){const webview=panel.webview,column=panel.viewColumn;let html='';const check=()=>{if(panel.closed)throw new Error('Webview is disposed');};Object.defineProperty(webview,'html',{get:()=>{check();return html;},set:value=>{check();html=value;}});Object.defineProperty(panel,'webview',{get:()=>{check();return webview;}});Object.defineProperty(panel,'viewColumn',{get:()=>{check();return column;}});}
    created.push(panel);return panel;
  }}};
  const host=new EditorHost(vscode,extensionUri,{onError:error=>errors.push(error)});
  return {host,created,errors,extensionUri,emit:(panel,message)=>created.find(p=>p.title===panel.title).emit({...message,editorSession:panel.session})};
}
test('all coach surfaces replace one editor tab, reuse its editor group, and restrict resources to the extension',async()=>{
  const f=fixture();try{
    let previous;for(const title of ['测试运行','提示','交流','测试运行','模型设置','历史版本']){const panel=await f.host.replace(title);if(previous)assert(previous.closed);assert.equal(f.created.filter(p=>!p.closed).length,1);assert.equal(f.host.current,panel);previous=panel;}
    assert.equal(f.created[0].show.viewColumn,-2);assert(f.created.slice(1).every(p=>p.show.viewColumn===2));
    for(const p of f.created){assert.equal(p.options.enableScripts,true);assert.equal(p.options.retainContextWhenHidden,true);assert.deepEqual(p.options.localResourceRoots,[f.extensionUri]);}
  }finally{f.host.dispose();}assert.equal(f.created.filter(p=>!p.closed).length,0);assert.equal(f.errors.length,0);
});
test('editor tabs flush queued results only when ready and reject messages from a previous frame',async()=>{
  const f=fixture();try{
    const panel=await f.host.replace('提示'),messages=[];panel.webview.onDidReceiveMessage(m=>messages.push(m));await panel.webview.postMessage({type:'result'});assert.equal(f.created[0].sent.length,0);
    f.emit(panel,{type:'editor_ready'});assert.equal(f.created[0].sent[0].type,'result');f.created[0].emit({type:'oj_submit',editorSession:'stale'});assert.equal(messages.length,0);
    f.emit(panel,{type:'hint'});assert.equal(messages[0].type,'hint');const current=await f.host.replace('交流');f.emit(panel,{type:'oj_submit'});assert.equal(messages.length,1);assert.equal(await panel.webview.postMessage({type:'late'}),false);panel.dispose();assert.equal(f.host.current,current);
  }finally{f.host.dispose();}
});
test('switching tabs snapshots the final draft before closing and concurrent clicks only open the newest tab',async()=>{
  const f=fixture();let saved,release;try{
    const panel=await f.host.replace('提示',async ui=>{saved=ui;await new Promise(r=>release=r);});f.emit(panel,{type:'editor_ready'});
    const next=f.host.replace('交流'),latest=f.host.replace('测试运行');await new Promise(r=>setImmediate(r));const request=f.created[0].sent.at(-1);
    f.emit(panel,{type:'editor_snapshot',id:request.id,ui:{question:'最后输入的字',chatOpen:true}});await new Promise(r=>setImmediate(r));assert.equal(saved.question,'最后输入的字');assert.equal(panel.closed,false);release();assert.equal(await next,null);assert.equal((await latest).title,'测试运行');assert.equal(f.created.filter(p=>!p.closed).length,1);
  }finally{f.host.dispose();}
});
test('closing a tab with its X saves the in-memory draft without browser storage or waiting for a typing timer',async()=>{
  const f=fixture(),saved=[];try{const panel=await f.host.replace('交流',ui=>saved.push(ui));f.emit(panel,{type:'editor_draft',ui:{question:'还未发送',chatOpen:true}});f.created[0].dispose();assert.equal(saved[0].question,'还未发送');assert.equal(panel.closed,true);assert.equal(f.host.current,null);assert.equal((await f.host.replace('提示')).viewColumn,2);}finally{f.host.dispose();}
});

test('realistic disposal guards prevent late HTML and metadata access after the tab has closed',async()=>{
 const f=fixture(true);try{const panel=await f.host.replace('提示'),native=f.created[0];panel.webview.html='initial';assert.doesNotThrow(()=>native.dispose());assert(panel.closed);assert.equal(panel.webview.html,'initial');assert.doesNotThrow(()=>{panel.webview.html='late';panel.title='late title';panel.reveal();panel.webview.asWebviewUri(f.extensionUri);});assert.equal(panel.webview.html,'initial');assert.equal(panel.title,'提示');assert.equal(panel.viewColumn,2);assert.equal(await panel.webview.postMessage({type:'late'}),false);assert.equal(f.host.current,null);assert.equal((await f.host.replace('交流')).title,'交流');assert.equal(f.errors.length,0);}finally{f.host.dispose();}
});

test('a message rejected during closure is discarded while real errors in a live tab remain visible',async()=>{
 const f=fixture(true);try{const panel=await f.host.replace('提示'),native=f.created[0],webview=native.webview;f.emit(panel,{type:'editor_ready'});let reject;webview.postMessage=()=>new Promise((_resolve,no)=>reject=no);const pending=panel.webview.postMessage({type:'reply'});native.dispose();reject(new Error('Webview is disposed'));assert.equal(await pending,false);const next=await f.host.replace('交流'),current=f.created.at(-1);f.emit(next,{type:'editor_ready'});current.webview.postMessage=async()=>{throw new Error('real failure');};await assert.rejects(next.webview.postMessage({type:'reply'}),/real failure/);}finally{f.host.dispose();}
});
test('editor bridge acquires VS Code once, preserves test session routing and renders/copies results without browser storage',async()=>{
  const f=fixture(),panel=await f.host.replace('测试运行'),html=sampleHtml({}, {session:'sample-session',nonce:'safe',cspSource:'vscode-resource:',uri:x=>'https://owned.test/'+x}),dom=new JSDOM(html.replace('<body ','<body data-editor-session="'+panel.session+'" '),{url:'https://owned.test',runScripts:'outside-only'}),w=dom.window,messages=[];let acquisitions=0;
  try{
    w.acquireVsCodeApi=()=>{if(++acquisitions>1)throw new Error('API acquired twice');return {postMessage:value=>{messages.push(value);f.created[0].emit(value);}};};
    for(const name of ['setItem','getItem','removeItem','clear'])w.Storage.prototype[name]=()=>{throw new Error('Browser storage forbidden');};
    const scripts=await Promise.all(['sample-controls.js','execution-view.js','judge-controls.js','context-controls.js','test-controls.js'].map(file=>fs.readFile(new URL('../vscode-extension/'+file,import.meta.url),'utf8')));
    w.eval(bridge);for(const script of scripts)w.eval(script);w.dispatchEvent(new w.Event('DOMContentLoaded'));
    await new Promise(r=>setImmediate(r));assert.equal(acquisitions,1);assert.equal(panel.ready,true);assert(messages.some(m=>m.type==='sample_ready'&&m.viewSession==='sample-session'));assert(messages.every(m=>m.editorSession===panel.session));assert.equal(messages.some(m=>['run_sample','oj_submit'].includes(m.type)),false);
    f.created[0].deliver=value=>w.dispatchEvent(new w.MessageEvent('message',{data:value}));await panel.webview.postMessage({type:'sample_view',saved:true,result:{status:'wrong_answer',ranProgram:true,input:'1 2\n',expected:'3\n',actual:'4\n',durationMs:5}});assert.equal(w.document.querySelector('.judge-badge').textContent,'Wrong Answer');assert.equal(w.document.querySelectorAll('.result-pane').length,3);
    w.document.querySelector('[data-kind=actual] button:last-child').click();const copy=messages.at(-1);assert.equal(copy.text,'4\n');assert.equal(copy.viewSession,'sample-session');await panel.webview.postMessage({type:'copy_reply',id:copy.id});await new Promise(r=>setImmediate(r));assert.equal(w.document.querySelector('[data-kind=actual] button:last-child').textContent,'已复制');
    w.document.getElementById('closeCoach').click();assert.equal(messages.at(-1).type,'sample_collapse');
  }finally{w.close();f.host.dispose();}
});
test('editor bridge preserves unsent hint drafts, reads snapshots and routes official links without navigating the coach tab',async()=>{
  const dom=new JSDOM('<body data-editor-session="frame"><button id="closeCoach"></button><button id="bindProblem"></button><button id="bindSubmission"></button><button id="showRecords"></button><textarea id="question"></textarea><details id="chatPanel"></details><a href="http://bailian.openjudge.cn/practice/1001/">题目</a></body>',{url:'https://owned.test',runScripts:'outside-only'}),w=dom.window,messages=[];let acquired=0;
  try{
    w.acquireVsCodeApi=()=>{assert.equal(++acquired,1);return {postMessage:m=>messages.push(m)};};for(const name of ['getItem','setItem','removeItem','clear'])w.Storage.prototype[name]=()=>{throw new Error('Browser storage forbidden');};w.eval(bridge);w.eval(await fs.readFile(new URL('../vscode-extension/webview-adapter.js',import.meta.url),'utf8'));
    const q=w.document.getElementById('question');q.value='本题为何越界？';q.dispatchEvent(new w.Event('input',{bubbles:true}));assert.equal(messages.at(-1).type,'editor_draft');assert.equal(messages.at(-1).ui.question,q.value);
    w.dispatchEvent(new w.MessageEvent('message',{data:{type:'editor_snapshot_request',id:'snapshot'}}));assert.equal(messages.at(-1).type,'editor_snapshot');assert.equal(messages.at(-1).id,'snapshot');assert.equal(messages.at(-1).ui.question,q.value);
    w.document.querySelector('a').click();assert.equal(messages.at(-1).type,'open_link');assert.equal(w.location.href,'https://owned.test/');w.document.getElementById('closeCoach').click();assert.equal(messages.at(-1).type,'collapse');assert.equal(messages.at(-1).ui.question,q.value);
  }finally{w.close();}
});
