import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {createSidepanelController} from '../extension/sidepanel-controller.js';
import {extractPage} from '../extension/extract.js';
import {readCurrentJudgment} from '../extension/capture-actions.js';
const url='https://programming.pku.edu.cn/probset/'+'a'.repeat(32)+'/'+'b'.repeat(32)+'/ide.do';
function event(){const listeners=[];return {addListener:fn=>listeners.push(fn),emit:value=>listeners.forEach(fn=>fn(value))};}
function fixture(){
  const dom=new JSDOM('<h1>只读验证题</h1><p id="problemDescription">读取两个整数并计算它们的和，输出最终的整数结果。</p><p id="aboutInput">两个整数</p><p id="aboutOutput">整数和</p><div id="sampleInput"><pre>1 2\n</pre></div><div id="sampleOutput"><pre>3\n</pre></div><div id="editor" class="ace_editor"></div><textarea id="stdin">4 5</textarea><pre id="output">执行输出 9</pre><button id="btnTest">测试</button>',{url,runScripts:'outside-only',storageQuota:1024});
  const w=dom.window;Object.defineProperty(w.HTMLElement.prototype,'innerText',{get(){return this.textContent;}});
  let code='#include <iostream>\nusing namespace std;\nint main(){int a,b; cin>>a>>b; cout<<a+b;}';
  const no=()=>{throw new Error('Website write/run forbidden');};
  const editor={getValue:()=>code,getSelectedText:()=> 'cout<<a+b;',setValue:no,on:no,resize:no};
  w.document.getElementById('editor').env={editor};
  w.runCode=no;w.submitCode=no;w.backupSourceCodeForRecovery=no;w.document.getElementById('btnTest').onclick=no;
  w.localStorage.setItem('_backup_existing','retained original');w.localStorage.setItem('padding','x'.repeat(1024-16-17-7));
  const originalStorage={...w.localStorage};let originalHTML=w.document.documentElement.outerHTML;
  const functions=[w.runCode,w.submitCode,w.backupSourceCodeForRecovery,w.document.getElementById('btnTest').onclick];
  let storageCalls=0;
  for(const name of ['getItem','setItem','removeItem','clear'])w.Storage.prototype[name]=()=>{storageCalls++;throw new Error('Website storage access forbidden');};
  const observer=new w.MutationObserver(()=>{});observer.observe(w.document,{subtree:true,attributes:true,childList:true,characterData:true});
  const calls=[],requests=[],replies=[];
  const native={onMessage:event(),onDisconnect:event(),postMessage:msg=>{requests.push(msg);queueMicrotask(()=>native.onMessage.emit({type:'saved',requestId:msg.requestId,requestType:msg.type,actionId:msg.actionId,id:'c'.repeat(64)}));}};
  const api={runtime:{getURL:file=>'chrome-extension://test/'+file},tabs:{query:async()=>[{id:1,windowId:2,url,active:true}],get:async()=>({id:1,windowId:2,url,active:true})},scripting:{executeScript:async opts=>{
    assert([extractPage,readCurrentJudgment].includes(opts.func));assert.equal(opts.world,'MAIN');calls.push(opts.func.name);
    return [{result:w.eval(`(${opts.func.toString()})(${(opts.args||[]).map(a=>JSON.stringify(a)).join(',')})`)}];
  }}};
  const controller=createSidepanelController(api,{connectNative:()=>native});
  controller.bindTab({id:1,windowId:2});
  const port={name:'pku-coach-sidepanel',sender:{url:api.runtime.getURL('sidepanel.html')},onMessage:event(),onDisconnect:event(),postMessage:msg=>replies.push(msg),disconnect(){this.disconnected=true;}};
  return {dom,w,api,controller,port,calls,requests,replies,setCode:value=>{code=value;},setRuntime:value=>{w.document.querySelector('#output').textContent=value;originalHTML=w.document.documentElement.outerHTML;observer.takeRecords();},verify(){
    assert.equal(storageCalls,0);assert.deepEqual({...w.localStorage},originalStorage);assert.equal(w.document.documentElement.outerHTML,originalHTML);assert.equal(observer.takeRecords().length,0);
    assert.deepEqual([w.runCode,w.submitCode,w.backupSourceCodeForRecovery,w.document.getElementById('btnTest').onclick],functions);
    observer.disconnect();dom.window.close();
  }};
}
test('all three sidebar actions leave a full website storage, live DOM, editor and original test/submit handlers untouched',async()=>{
  const f=fixture();
  try{
    f.controller.connect(f.port);assert.equal(f.calls.length,0);assert.equal(f.requests.length,0);
    for(const type of ['quick_save','hint','discuss']){
      const code=`#include <iostream>\nusing namespace std;\nint main(){cout<<\"${type}\";}`;f.setCode(code);
      await f.controller.handle(f.port,{type,actionId:type,question:type==='discuss'?'为什么我的输出不对？':undefined});
      assert.equal(f.requests.at(-1).capture.code,code);
      assert.equal(f.requests.at(-1).capture.problem.sampleOutput,'3\n');
      assert.doesNotMatch(f.requests.at(-1).capture.problem.sampleOutput,/执行输出/);
    }
    assert.deepEqual(f.calls,['extractPage','extractPage','readCurrentJudgment','extractPage']);
    assert.equal(f.requests[2].question,'为什么我的输出不对？');
    assert.equal(f.requests[1].judgeEvidence.status,'unknown');
  }finally{f.verify();}
});
test('only the own sidebar can connect and forbidden legacy operations cannot reach the page or native host',async()=>{
  const f=fixture();
  try{
    const bad={...f.port,sender:{url},disconnect(){this.disconnected=true;}};f.controller.connect(bad);assert.equal(bad.disconnected,true);
    for(const type of ['clear_site_cache','auto_site_cache','draft_save','draft_restore','observe','submission','accepted','save'])await f.controller.handle(f.port,{type});
    assert.equal(f.calls.length,0);assert.equal(f.requests.length,0);assert.equal(f.replies.length,8);
  }finally{f.verify();}
});
test('explicit full solutions use the same read-only capture boundary and reject invalid purposes before reading',async()=>{
  const f=fixture();
  try{
    const current='#include <iostream>\nusing namespace std;\nint main(){cout<<42;}';f.setCode(current);
    await f.controller.handle(f.port,{type:'discuss',purpose:'solution',question:'请给出完整参考解答。',actionId:'solution'});
    assert.equal(f.requests.length,1);assert.equal(f.requests[0].capture.code,current);assert.equal(f.requests[0].purpose,'solution');assert.equal(f.requests[0].type,'discuss');
    const reads=f.calls.length;
    await f.controller.handle(f.port,{type:'discuss',purpose:'execute',question:'invalid'});assert.match(f.replies.at(-1).error,/无效的问答用途/);assert.equal(f.calls.length,reads);assert.equal(f.requests.length,1);
  }finally{f.verify();}
});
test('hint, answer, chat send and every history reopen re-read runtime without website mutations or extra saves',async()=>{
  const f=fixture();
  try{
    let n=0;
    for(const [type,purpose]of [['hint'],['discuss','solution'],['discuss'],['discussion_history'],['discussion_history'],['hint_history'],['hint_history'],['assist_history'],['assist_history']]){
      const text='new runtime error '+(++n);f.setRuntime(text);
      await f.controller.handle(f.port,{type,purpose,question:'请结合运行错误回答',actionId:'runtime-'+n});
      const preview=f.replies.find(r=>r.actionId==='runtime-'+n&&['action_preview','discussion_context','hint_context','assist_context'].includes(r.type));assert(preview);assert.match(preview.capture.runtime.text,new RegExp(text));
      if(!type.endsWith('_history'))assert.match(f.requests.at(-1).capture.runtime.text,new RegExp(text));
      else{assert.equal(f.requests.at(-1).type,type);assert.equal(f.requests.at(-1).url,url);assert.equal(f.requests.at(-1).capture,undefined);}
    }
  }finally{f.verify();}
});
test('missing activeTab access, non-IDE tabs and navigation races fail without saving another problem or patching the page',async()=>{
  const f=fixture();
  try{
    const original=f.api.scripting.executeScript;
    f.api.scripting.executeScript=async()=>{throw new Error('Cannot access contents');};
    await f.controller.handle(f.port,{type:'quick_save'});assert.match(f.replies.at(-1).error,/读取权限/);assert.equal(f.requests.length,0);
    f.api.scripting.executeScript=original;f.api.tabs.query=async()=>[{id:1,url:'https://example.com',active:true}];
    f.api.tabs.get=async()=>({id:1,windowId:2,url:'https://example.com',active:true});
    await f.controller.handle(f.port,{type:'hint'});assert.equal(f.calls.length,0);
    f.api.tabs.query=async()=>[{id:1,url,active:true}];let gets=0;f.api.tabs.get=async()=>({id:1,url:++gets===1?url:url.replace('b'.repeat(32),'d'.repeat(32)),active:true});
    await f.controller.handle(f.port,{type:'discuss',question:'循环为什么不对？'});assert.match(f.replies.at(-1).error,/切换题目/);assert.equal(f.requests.length,0);
  }finally{f.verify();}
});

test('toolbar bindings use their own browser window, refuse unbound panels, and reject a switched tab without page reads',async()=>{
  const f=fixture();
  try{
    const unbound=createSidepanelController(f.api,{connectNative:()=>{throw new Error('must not connect');}});
    await unbound.handle(f.port,{type:'quick_save',windowId:2});assert.match(f.replies.at(-1).error,/完成本页授权/);assert.equal(f.calls.length,0);
    f.controller.bindTab({id:3,windowId:4});
    let query;
    f.api.tabs.query=async options=>{query=options;return [{id:1,windowId:2,url,active:true}];};
    await f.controller.handle(f.port,{type:'quick_save',windowId:2});assert.deepEqual(query,{active:true,windowId:2});assert.equal(f.requests.length,1);
    const reads=f.calls.length;
    await f.controller.handle(f.port,{type:'quick_save'});assert.match(f.replies.at(-1).error,/完成本页授权/);assert.equal(f.calls.length,reads);
    f.api.tabs.query=async()=>[{id:99,windowId:2,active:true}];
    await f.controller.handle(f.port,{type:'quick_save',windowId:2});assert.match(f.replies.at(-1).error,/切换题目标签/);assert.equal(f.calls.length,reads);
  }finally{f.verify();}
});
test('sidebar jobs do not block quick save and model Markdown renders only in the sidebar',async()=>{
  const html=await fs.readFile(new URL('../extension/sidepanel.html',import.meta.url),'utf8');
  const dom=new JSDOM(html,{url:'https://sidebar-fixture.test',runScripts:'outside-only'}),w=dom.window;
  const sent=[];let receive;
  w.chrome={runtime:{connect:()=>({onMessage:{addListener:fn=>{receive=fn;}},onDisconnect:{addListener(){}},postMessage:msg=>sent.push(msg)})}};
  for(const file of ['vendor/marked/marked.umd.js','report-renderer.js','instant-hints.js','sidepanel.js'])w.eval(await fs.readFile(new URL('../extension/'+file,import.meta.url),'utf8'));
  try{
    const $=id=>w.document.getElementById(id);$('hint').click();const hint=sent.at(-1);
    const capture={url,title:'测试题',code:'int main(){int a; cin>>a; cout<<a;}',problem:{description:'读入一个整数并输出两倍的值。',input:'整数',output:'两倍',sampleInput:'2',sampleOutput:'4'},runtime:{}};
    receive({type:'action_preview',requestType:'hint',actionId:hint.actionId,capture,missingSections:[]});
    receive({type:'saved',requestType:'hint',actionId:hint.actionId,title:'测试题',hint:{id:'a'.repeat(64),kind:'hint',status:'running',instantAnalysis:'检查 `cout<<a` 的输出。'}});
    assert.equal($('quickSave').disabled,false);$('quickSave').click();assert.equal(sent.at(-1).type,'quick_save');
    const save=sent.at(-1);receive({type:'saved',requestType:'quick_save',actionId:save.actionId,title:'另一个题目'});assert.equal($('quickSave').disabled,false);
    receive({type:'hint_status',id:'a'.repeat(64),kind:'hint',status:'complete',analysis:'## 代码修改\n\n输出应为 **两倍**。\n\n<script>window.evil=1</script>\n\n![x](https://example.com/track)'});
    assert.equal($('hintAnswer').querySelector('h2').textContent,'代码修改');assert.equal($('hintAnswer').querySelector('script,img'),null);assert.equal(w.evil,undefined);
    $('discussion').click();receive({type:'discussion_history',url,entries:[],total:0});$('question').value='我的 cout 那一行有什么问题？';
    $('chatForm').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));assert.equal(sent.at(-1).type,'discuss');assert.equal(sent.at(-1).question,'我的 cout 那一行有什么问题？');
    assert.equal($('quickSave').disabled,false);
  }finally{dom.window.close();}
});
test('production reachable modules contain no legacy write hooks, website storage operations or automatic page reads',async()=>{
  const worker=await fs.readFile(new URL('../extension/sidepanel-worker.js',import.meta.url),'utf8');
  assert.match(worker,/createSidepanelController/);assert.doesNotMatch(worker,/onUpdated|onActivated|executeScript|setInterval|connectNative/);
  assert.match(worker,/openPanelOnActionClick:false/);assert.match(worker,/action\.onClicked\.addListener/);assert.match(worker,/controller\.bindTab\(tab\)/);
  const controller=await fs.readFile(new URL('../extension/sidepanel-controller.js',import.meta.url),'utf8');
  assert.deepEqual([...controller.matchAll(/func:\s*(\w+)/g)].map(m=>m[1]),['extractPage','readCurrentJudgment']);
  for(const file of ['sidepanel.js','sidepanel-worker.js','sidepanel-controller.js']){
    const source=await fs.readFile(new URL('../extension/'+file,import.meta.url),'utf8');
    assert.doesNotMatch(source,/chrome\.storage|\blocalStorage\b|\bsessionStorage\b|\bindexedDB\b|\.insertCSS\s*\(|\bfetch\s*\(|\beval\s*\(|installIdeProtection|installSubmissionObserver|maintainCache|restoreEditorDraft/);
    assert.doesNotMatch(source,/from ['"].*(?:background|site-cache|draft-store|ide-protection|submission-observer|content)\.js/);
  }
});
