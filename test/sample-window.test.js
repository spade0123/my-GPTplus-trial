import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {SampleWindow}=createRequire(import.meta.url)('../vscode-extension/sample-window.cjs');
function fixture(){
  const panels=[],received=[],collapsed=[],errors=[];
  const manager=new SampleWindow({create:()=>{
    const disposeListeners=new Set(),messageListeners=new Set();
    const event=set=>fn=>{set.add(fn);return {dispose:()=>set.delete(fn)};};
    const panel={viewColumn:2,closed:false,reveals:0,onDidDispose:event(disposeListeners),webview:{html:'',sent:[],onDidReceiveMessage:event(messageListeners),postMessage(value){this.sent.push(value);return Promise.resolve(true);}},reveal(){this.reveals++;},dispose(){if(this.closed)return;this.closed=true;for(const fn of [...disposeListeners])fn();}};
    panels.push(panel);return panel;
  },render:s=>s.session,receive:async(s,m)=>received.push({s,m}),collapse:async s=>collapsed.push(s),onError:e=>errors.push(e)});
  const open=problemUrl=>manager.open({uri:'file:///fixture/main.cpp',name:'main.cpp',problemUrl,sourceColumn:1});
  return {manager,open,panels,received,collapsed,errors};
}
test('repeated sample runs reuse exactly one panel, including a changed question in the same source file',()=>{
  const f=fixture(),first=f.open('http://bailian.openjudge.cn/practice/1001/');
  for(let i=0;i<10;i++){const current=f.open('http://noi.openjudge.cn/ch0206/'+i+'/');assert.equal(current.panel,first.panel);assert.equal(f.panels.filter(p=>!p.closed).length,1);}
  assert.equal(f.panels.length,1);assert.equal(first.disposed,true);assert.equal(f.panels[0].reveals,10);f.manager.dispose();
});
test('late older test output and old-frame submit/collapse events cannot affect the current sample window',async()=>{
  const f=fixture(),old=f.open('http://bailian.openjudge.cn/practice/1001/'),current=f.open('http://noi.openjudge.cn/ch0206/1/');
  await f.manager.handle(current.panel,{type:'sample_ready',viewSession:current.session});f.manager.show(current,{title:'本题',saved:true,result:{actual:'current'}});
  f.manager.show(old,{title:'旧题',result:{actual:'stale'}});
  for(const type of ['sample_ready','sample_collapse','oj_submit','oj_prepare','oj_refresh'])await f.manager.handle(current.panel,{type,viewSession:old.session});
  assert.equal(current.panel.webview.sent.at(-1).title,'本题');assert.equal(current.panel.title,'样例测试 · 本题');assert.equal(current.panel.closed,false);assert.equal(f.received.length,0);assert.equal(f.collapsed.length,0);
  await f.manager.handle(current.panel,{type:'oj_submit',viewSession:current.session});assert.equal(f.received[0].s.problemUrl,current.problemUrl);f.manager.dispose();
});
test('closing and reopening the sole sample panel returns to its current source without leaving listener or panel duplicates',async()=>{
  const f=fixture(),first=f.open('first'),current=f.open('second');
  await f.manager.handle(current.panel,{type:'sample_collapse',viewSession:current.session});assert.equal(f.manager.state,null);assert.equal(f.collapsed[0],current);assert.equal(first.disposed,true);
  const reopened=f.open('third');assert.notEqual(reopened.panel,first.panel);assert.equal(f.panels.filter(p=>!p.closed).length,1);f.manager.dispose();assert.equal(f.panels.filter(p=>!p.closed).length,0);assert.equal(f.errors.length,0);
});
test('samples completed before the webview becomes ready restore only the latest run and title',async()=>{
  const f=fixture(),first=f.open('first');f.manager.show(first,{title:'旧结果'});const current=f.open('second');f.manager.show(current,{title:'新结果',result:{actual:'2'}});
  assert.equal(current.panel.webview.sent.length,0);await f.manager.handle(current.panel,{type:'sample_ready',viewSession:current.session});assert.equal(current.panel.webview.sent.at(-1).title,'新结果');f.manager.dispose();
});
