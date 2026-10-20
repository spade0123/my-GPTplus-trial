import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {webcrypto} from 'node:crypto';
import {selectActionCapture,readCurrentJudgment} from '../extension/capture-actions.js';
const url='https://programming.pku.edu.cn/probset/d0ef3e0f7fa5481d896f9a07254c8ecd/f6b942b2dcd74656880a088f85f56c3f/ide.do';
test('two tabs can save concurrently through one native connection and replies stay with their requests',async()=>{
  const dom=new JSDOM('',{url,runScripts:'outside-only'});let onConnect,onNativeReply,connections=0,sequence=0;
  const posted=[];
  dom.window.crypto.randomUUID=()=>`request-${++sequence}`;
  dom.window.chrome={tabs:{get:async()=>({url})},runtime:{
    onConnect:{addListener:fn=>{onConnect=fn;}},
    connectNative:()=>{connections++;return {onMessage:{addListener:fn=>{onNativeReply=fn;}},onDisconnect:{addListener(){}},postMessage:m=>posted.push(m)};}
  }};
  let source=await fs.readFile(new URL('../extension/background.js',import.meta.url),'utf8');
  dom.window.eval(source.replace(/^import[^\n]+\n/gm,''));
  function tab(id){let receive,disconnect;const replies=[];const port={name:'pku-coach',sender:{url,tab:{id}},onMessage:{addListener:fn=>{receive=fn;}},onDisconnect:{addListener:fn=>{disconnect=fn;}},postMessage:m=>replies.push(m),disconnect(){}};onConnect(port);return {receive,disconnect,replies};}
  const one=tab(1),two=tab(2),capture={url,title:'题目',code:'int main(){}'};
  const saving=Promise.all([one.receive({type:'save',capture}),two.receive({type:'save',capture})]);await new Promise(r=>setTimeout(r,0));
  assert.equal(connections,1);assert.equal(posted.length,2);
  onNativeReply({type:'saved',id:'b'.repeat(64),requestId:posted[1].requestId});
  onNativeReply({type:'saved',id:'a'.repeat(64),requestId:posted[0].requestId});
  await saving;
  assert.equal(one.replies[0].id,'a'.repeat(64));assert.equal(two.replies[0].id,'b'.repeat(64));
  one.disconnect();
  const reading=two.receive({type:'review',id:'b'.repeat(64)});await new Promise(r=>setTimeout(r,0));
  assert.equal(connections,1);assert.equal(posted[2].type,'review');
  onNativeReply({type:'review_status',id:'b'.repeat(64),requestId:posted[2].requestId});await reading;
  dom.window.close();
});

test('direct actions capture fresh code per click and show previews before native saving can finish',async()=>{
  const dom=new JSDOM('',{url,runScripts:'outside-only'});let connect,reply,receive;
  const sent=[],native=[],calls=[];let code='int main(){return 1;}';
  const page=()=>({url,title:'测试题',problem:{description:'读取一个整数并输出其平方，数值范围为零到一百。',input:'一个整数',output:'平方',sampleInput:'2',sampleOutput:'4'},runtime:{output:'old output'},primarySource:'ace:0',candidates:[{source:'ace:0',value:code}],selectedCode:'return 1;'});
  try{
    Object.assign(dom.window,{selectActionCapture,readCurrentJudgment,TextEncoder,extractPage:function extractPage(){},installSubmissionObserver:function installSubmissionObserver(){},installIdeProtection:function installIdeProtection(){}});
    Object.defineProperty(dom.window.crypto,'subtle',{value:webcrypto.subtle});
    dom.window.chrome={tabs:{get:async()=>({url})},storage:{local:{get:async()=>({standard:'c++17'})}},scripting:{executeScript:async({func})=>{
      calls.push(func.name);return [{result:func.name==='extractPage'?page():func.name==='readCurrentJudgment'?{status:'unknown'}:undefined}];
    }},runtime:{onConnect:{addListener:fn=>connect=fn},connectNative:()=>({onMessage:{addListener:fn=>reply=fn},onDisconnect:{addListener(){}},postMessage:m=>native.push(m)})}};
    const source=await fs.readFile(new URL('../extension/background.js',import.meta.url),'utf8');dom.window.eval(source.replace(/^import[^\n]+\n/gm,''));
    connect({name:'pku-coach',sender:{url,tab:{id:1}},onMessage:{addListener:fn=>receive=fn},onDisconnect:{addListener(){}},postMessage:m=>sent.push(m)});
    const hint=receive({type:'hint',actionId:'one'});await new Promise(r=>setTimeout(r,20));
    assert.equal(sent[0].type,'hint_preview');assert.equal(sent[0].capture.code,code);assert.equal(native.length,1);
    code='int main(){return 2;}';const quick=receive({type:'quick_save',actionId:'two'});await new Promise(r=>setTimeout(r,10));
    assert.equal(native[1].capture.code,code);assert.notEqual(native[0].capture.code,native[1].capture.code);
    assert.equal(calls.filter(c=>c==='extractPage').length,2);
    reply({type:'saved',requestId:native[1].requestId,actionId:'two'});await quick;
    const discussion=receive({type:'discuss',actionId:'three',question:'第二行是什么意思？'});await new Promise(r=>setTimeout(r,10));
    assert.ok(sent.some(m=>m.type==='discussion_preview'&&m.actionId==='three'));assert.equal(native[2].question,'第二行是什么意思？');assert.equal(native[2].selectedCode,'return 1;');
    reply({type:'saved',requestId:native[2].requestId});reply({type:'saved',requestId:native[0].requestId});await Promise.all([hint,discussion]);
  }finally{dom.window.close();}
});
