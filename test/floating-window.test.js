import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {EventEmitter} from 'node:events';
import {createRequire} from 'node:module';
import {JSDOM} from 'jsdom';
const require=createRequire(import.meta.url),{FloatingHost}=require('../vscode-extension/floating-host.cjs'),{SubmissionMonitor}=require('../vscode-extension/submission-monitor.cjs'),{rateDifficulty}=require('../vscode-extension/rate-difficulty.cjs');
function hostFixture(){const commands=[],host=new FloatingHost(process.cwd()),child={killed:false,stdin:{write:s=>commands.push(JSON.parse(s)),end(){}}};host.child=child;return {host,commands};}
test('floating windows share one native host, close the previous surface and reject stale page messages',async()=>{
 const {host,commands}=hostFixture();try{
  const a=await host.replace('A'),received=[];a.webview.onDidReceiveMessage(m=>received.push(m));await a.webview.postMessage({type:'queued'});assert.equal(commands.length,0);
  host.receive({floatingSession:a.session,message:{type:'floating_ready'}});assert.equal(commands[0].cmd,'post');assert.equal(JSON.parse(commands[0].json).message.type,'queued');
  const b=await host.replace('B');assert(a.closed);assert.equal(host.current,b);assert.equal(host.child.killed,false);
  host.receive({floatingSession:a.session,message:{type:'hint'}});assert.equal(received.length,0);assert.equal(await a.webview.postMessage({type:'late'}),false);
  a.dispose();assert.equal(host.current,b);
 }finally{host.dispose();}
});
test('switching surfaces captures unsent text before disposal and simultaneous button clicks leave only the newest surface',async()=>{
 const {host,commands}=hostFixture();let release,saved;
 try{const a=await host.replace('A',async ui=>{saved=ui;await new Promise(r=>release=r);});a.ready=true;
  const next=host.replace('B'),latest=host.replace('C');await new Promise(r=>setTimeout(r,0));const command=commands.find(c=>c.cmd==='post'),request=JSON.parse(command.json).message;
  host.receive({floatingSession:a.session,message:{type:'floating_snapshot',id:request.id,ui:{question:'最后一个字',chatOpen:false}}});await new Promise(r=>setTimeout(r,0));assert.equal(a.closed,false);assert.equal(saved.question,'最后一个字');release();
  assert.equal(await next,null);assert.equal((await latest).title,'C');assert(a.closed);
 }finally{host.dispose();}
});
test('native bridge works without Chrome storage and preserves message sessions and official links',async()=>{
 const dom=new JSDOM('<body data-floating-session="session" data-session="sample"><textarea id="question">草稿</textarea><details id="chatPanel"></details><a href="http://bailian.openjudge.cn/practice/1001/">题目</a></body>',{url:'https://coach.local/',runScripts:'outside-only'}),w=dom.window,messages=[];let nativeListener,delivered;
 try{w.chrome={webview:{postMessage:m=>messages.push(m),addEventListener:(_e,fn)=>nativeListener=fn}};w.Storage.prototype.setItem=()=>{throw new Error('No browser storage');};w.eval(await fs.readFile(new URL('../vscode-extension/floating-bridge.js',import.meta.url),'utf8'));w.addEventListener('message',e=>delivered=e.data);
 nativeListener({data:{floatingSession:'stale',message:{type:'hint'}}});assert.equal(delivered,undefined);nativeListener({data:{floatingSession:'session',message:{type:'hint'}}});assert.equal(delivered.type,'hint');
 nativeListener({data:{floatingSession:'session',message:{type:'floating_snapshot_request',id:'x'}}});assert.equal(messages.at(-1).message.ui.question,'草稿');w.document.querySelector('a').click();assert.equal(messages.at(-1).message.viewSession,'sample');assert.equal(messages.at(-1).message.type,'open_link');
 }finally{w.close();}
});
test('official polling continues after a window closes, stops on final AC and never resubmits',async()=>{
 const notices=[],calls=[],state={uri:'file:///fixture.cpp',problemUrl:'http://bailian.openjudge.cn/practice/1001/'};
 const monitor=new SubmissionMonitor({delay:5,limit:4,refresh:async id=>{calls.push(id);return {type:'oj_result',id,createdAt:'2',submission:{verdict:{status:'AC'}},submitPageClosed:true};},notify:(_s,value)=>notices.push(value)});
 try{monitor.remember(state,{type:'oj_result',id:'job',createdAt:'2',submission:{verdict:{status:'pending'}}});await new Promise(r=>setTimeout(r,30));assert.equal(calls.length,1);assert.equal(notices.at(-1).submitPageClosed,true);assert.equal(monitor.jobs.size,0);assert.equal(monitor.get(state).submission.verdict.status,'AC');monitor.remember(state,{id:'older',createdAt:'1'});assert.equal(monitor.get(state).id,'job');}finally{monitor.dispose();}
});
test('difficulty follows exact acceptance-rate boundaries and retains all curated question identities',async()=>{
 for(const [rate,level]of [[100,1],[70,1],[69.99,2],[50,2],[49.99,3],[30,3],[29.99,4],[0,4],[NaN,0],[-1,0]])assert.equal(rateDifficulty(rate).level,level);
 const library=JSON.parse(await fs.readFile(new URL('../src/problem-library.json',import.meta.url),'utf8'));assert.equal(library.items.length,337);for(const item of library.items){assert.equal(item.level,rateDifficulty(Number.parseFloat(item.rateLabel)).level);assert(item.algorithmLevel);}
});
test('three buttons use one editor tab host without starting the native floating host or modifying editor settings',async()=>{
 const source=await fs.readFile(new URL('../vscode-extension/extension.cjs',import.meta.url),'utf8');assert(!source.includes('FloatingHost'));assert(!source.includes('floating-bridge.js'));assert(!source.includes('getConfiguration('));assert(source.includes('editorTabs.replace('));
});
test('official verdicts use safe large status cards while retaining distinct submission details',async()=>{
 const dom=new JSDOM('<header></header><button id="submitOJ"></button><button id="refreshOJ"></button><div id="ojPanel"><p id="ojState"></p><div id="ojResults"></div><div id="ojLanguageRow"><select id="ojLanguage"></select></div></div>',{runScripts:'outside-only',url:'https://coach.local/'}),w=dom.window;let receive;
 try{w.chrome={runtime:{connect:()=>({postMessage(){},onMessage:{addListener:fn=>receive=fn}})}};w.eval(await fs.readFile(new URL('../vscode-extension/judge-controls.js',import.meta.url),'utf8'));
 for(const status of ['AC','WA','CE','TLE','MLE','RE','OLE']){receive({type:'oj_result',requestType:'oj_monitor',autoRefreshManaged:true,id:status,submission:{submissionId:status,verdict:{status,text:status},details:{memory:'272kB',time:'991ms'}}});assert.equal(w.document.querySelectorAll('.oj-verdict').length,1);assert.equal(w.document.querySelector('.oj-verdict-code').textContent,({"AC":"Accepted","WA":"Wrong Answer","CE":"Compile Error","TLE":"Time Out","MLE":"Memory Limit Exceeded","RE":"Runtime Error","OLE":"Output Limit Exceeded","PE":"Presentation Error"})[status]);assert.match(w.document.querySelector('.oj-details').textContent,/272kB/);}
 receive({type:'oj_result',requestType:'oj_monitor',autoRefreshManaged:true,id:'unknown',submission:{verdict:{status:'<img src=x>',text:'<script>injected</script>'}}});assert.equal(w.document.querySelectorAll('script,img').length,0);assert.equal(w.document.querySelector('.oj-verdict-code').textContent,'其他');
 }finally{w.close();}
});
