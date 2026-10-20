import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {webcrypto} from 'node:crypto';
import {validIdeUrl} from '../extension/sidepanel-controller.js';

const script=(await fs.readFile(new URL('../extension/floating-worker.js',import.meta.url),'utf8')).replace(/^import[^\n]+\n/,'');
const url='https://programming.pku.edu.cn/probset/'+'a'.repeat(32)+'/'+'b'.repeat(32)+'/ide.do';
function event(){const list=[];return {addListener:fn=>list.push(fn),emit:async value=>Promise.all(list.map(fn=>fn(value)))};}
function port(name,sender){return {name,sender,onMessage:event(),onDisconnect:event(),sent:[],postMessage(msg){this.sent.push(msg);},disconnect(){this.disconnected=true;void this.onDisconnect.emit();}};}
function fixture(){
  const requests=[],bindings=[];
  const controller={bindTab:tab=>bindings.push(tab),handle:async(out,msg)=>{requests.push({out,msg});out.postMessage({type:'action_preview',actionId:msg.actionId,requestType:msg.type});}};
  const chrome={runtime:{onConnect:event(),getURL:file=>'chrome-extension://test/'+file},sidePanel:{setPanelBehavior:async()=>{}},action:{onClicked:event()}};
  new Function('chrome','createSidepanelController','validIdeUrl','crypto',script)(chrome,()=>controller,validIdeUrl,webcrypto);
  const owner=port('pku-coach-floating',{url,tab:{id:7,windowId:3},frameId:0,documentId:'own-document'});
  return {chrome,requests,bindings,owner,connect:p=>chrome.runtime.onConnect.emit(p)};
}

test('floating sessions reopen their own frame without generating a hint, and buffer accepted work until it resumes',async()=>{
  const f=fixture();await f.connect(f.owner);
  await f.owner.onMessage.emit({type:'open_hint',actionId:'first',requestedAt:'now'});
  const opened=f.owner.sent.at(-1);assert.equal(opened.type,'tool_opened');assert.equal(opened.mode,'hint');assert.equal(f.requests.length,0);
  const frame=port('pku-coach-assist',{url:opened.frameUrl,tab:{id:7,windowId:3},frameId:2});await f.connect(frame);
  assert.equal(frame.sent.length,0);
  await frame.onMessage.emit({type:'resume'});assert.deepEqual(frame.sent.map(m=>m.type),['resume_context']);
  await frame.onMessage.emit({type:'resume'});assert.equal(frame.sent.length,1);
  await frame.onMessage.emit({type:'hint_history',actionId:'restore'});assert.equal(f.requests.at(-1).msg.type,'hint_history');
  await frame.onMessage.emit({type:'hint',actionId:'explicit-refresh'});assert.equal(f.requests.at(-1).msg.type,'hint');
  // Collapse is entirely local UI state: it needs no worker message or capture.
  await f.owner.onMessage.emit({type:'open_hint',actionId:'second'});assert.equal(f.owner.sent.at(-1).frameUrl,opened.frameUrl);
  assert.equal(f.requests.length,2);assert.equal(frame.sent.at(-1).type,'resume_context');
  // Outstanding disk replies survive a temporary UI disconnect.
  await frame.onDisconnect.emit();f.requests[1].out.postMessage({type:'saved',actionId:'explicit-refresh'});
  const resumed=port('pku-coach-assist',{url:opened.frameUrl,tab:{id:7,windowId:3},frameId:3});await f.connect(resumed);await resumed.onMessage.emit({type:'resume'});
  assert.deepEqual(resumed.sent.map(m=>m.type),['resume_context','saved']);
  await resumed.onMessage.emit({type:'discuss',question:'why',actionId:'ask',windowId:999});assert.equal(f.requests.at(-1).msg.windowId,3);assert.deepEqual(f.bindings.at(-1),{id:7,windowId:3});
  await f.owner.onMessage.emit({type:'open_discussion',actionId:'chat'});const chat=f.owner.sent.at(-1);
  assert.equal(chat.mode,'discussion');assert.equal(chat.frameUrl,opened.frameUrl);assert.equal(f.requests.length,3);assert.equal(resumed.sent.at(-1).mode,'discussion');
  await f.owner.onDisconnect.emit();assert.equal(resumed.disconnected,true);
});

test('unrequested pages, top-level tabs, other source tabs, wrong tokens and duplicate frames cannot attach to a session',async()=>{
  const f=fixture();await f.connect(f.owner);await f.owner.onMessage.emit({type:'open_hint',actionId:'one'});const {frameUrl}=f.owner.sent.at(-1);
  for(const sender of [
    {url:frameUrl,tab:{id:7,windowId:3},frameId:0},
    {url:frameUrl,tab:{id:8,windowId:3},frameId:2},
    {url:frameUrl,tab:{id:7,windowId:9},frameId:2},
    {url:frameUrl.replace('session=','session=wrong'),tab:{id:7,windowId:3},frameId:2},
    {url,tab:{id:7,windowId:3},frameId:2}
  ]){const bad=port('pku-coach-assist',sender);await f.connect(bad);assert.equal(bad.disconnected,true);}
  const child=port('pku-coach-floating',{url,tab:{id:7,windowId:3},frameId:1});await f.connect(child);assert.equal(child.disconnected,true);
  const sender={url:frameUrl,tab:{id:7,windowId:3},frameId:2},good=port('pku-coach-assist',sender);await f.connect(good);assert.equal(good.disconnected,undefined);
  const duplicate=port('pku-coach-assist',{...sender,frameId:3});await f.connect(duplicate);assert.equal(duplicate.disconnected,true);
  assert.equal(f.requests.length,0);
});
