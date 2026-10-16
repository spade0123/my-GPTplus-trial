import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {JSDOM} from 'jsdom';
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
