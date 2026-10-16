import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {JSDOM} from 'jsdom';
import {installSubmissionObserver} from '../extension/submission-observer.js';
const url='https://programming.pku.edu.cn/probset/d0ef3e0f7fa5481d896f9a07254c8ecd/f6b942b2dcd74656880a088f85f56c3f/ide.do';
const pause=()=>new Promise(r=>setTimeout(r,80));
test('observer ignores fake clicks, stale AC, sample AC and execution output; ties changed verdict to submitted buffer',async()=>{
  const dom=new JSDOM('<h3>例子输出</h3><pre>AC</pre><div class="ace_editor"></div><button>提交</button><pre id="stdout"></pre><div id="judge-result">Accepted</div>',{url,runScripts:'outside-only'});
  const {document}=dom.window;let code='int main(){return 1;}',click;
  document.querySelector('.ace_editor').env={editor:{getValue:()=>code}};
  const add=document.addEventListener.bind(document);document.addEventListener=(type,listener,...rest)=>{if(type==='click')click=listener;add(type,listener,...rest);};
  const submissions=[],judged=[];document.addEventListener('pku-coach-submitted',e=>submissions.push(e.detail));document.addEventListener('pku-coach-judged',e=>judged.push(e.detail));
  dom.window.eval(`(${installSubmissionObserver.toString()})()`);
  const button=document.querySelector('button');button.click();assert.equal(submissions.length,0);
  click({isTrusted:true,target:button});assert.equal(submissions.length,1);
  code='int main(){return 99;}';document.querySelector('#stdout').textContent='AC';await pause();assert.equal(judged.length,0);
  document.querySelector('#judge-result').textContent='Judging';await pause();
  document.querySelector('#judge-result').textContent='Accepted';await pause();
  assert.equal(judged.length,1);assert.equal(judged[0].code,'int main(){return 1;}');assert.equal(judged[0].submissionId,submissions[0].id);assert.equal(judged[0].verdict.status,'AC');
  dom.window.close();
});
test('non-AC judge outcomes are recorded but never emitted as accepted',async()=>{
  const dom=new JSDOM('<textarea>int main(){return 0;}</textarea><button>提交评测</button><span data-verdict="Judging"></span>',{url,runScripts:'outside-only'});let click;
  const document=dom.window.document,add=document.addEventListener.bind(document);document.addEventListener=(type,fn,...args)=>{if(type==='click')click=fn;add(type,fn,...args);};
  const judged=[];document.addEventListener('pku-coach-judged',e=>judged.push(e.detail));dom.window.eval(`(${installSubmissionObserver.toString()})()`);
  click({isTrusted:true,target:document.querySelector('button')});document.querySelector('[data-verdict]').setAttribute('data-verdict','Wrong Answer');await pause();
  assert.equal(judged.length,1);assert.equal(judged[0].verdict.status,'WA');dom.window.close();
});
test('actual PKU span submit control and output title are supported, history and test execution cannot finalize a draft',async()=>{
  const dom=new JSDOM('<div class="ace_editor"></div><span id="btnSubmit">提交程序</span><span id="btnTest">测试执行</span><span id="href_history">提交记录</span><pre id="output"><span class="passed title">Accepted</span>old result</pre><div id="div_msg_text"><div class="sltn true"><div class="result">通过</div></div></div>',{url,runScripts:'outside-only'});
  const document=dom.window.document;let click,code='int main(){return 0;}';document.querySelector('.ace_editor').env={editor:{getValue:()=>code}};
  const add=document.addEventListener.bind(document);document.addEventListener=(type,fn,...args)=>{if(type==='click')click=fn;add(type,fn,...args);};
  const submitted=[],judged=[];document.addEventListener('pku-coach-submitted',e=>submitted.push(e.detail));document.addEventListener('pku-coach-judged',e=>judged.push(e.detail));dom.window.eval(`(${installSubmissionObserver.toString()})()`);
  const target=document.querySelector('#btnSubmit'),output=document.querySelector('#output');
  target.setAttribute('disabled','disabled');click({isTrusted:true,target});assert.equal(submitted.length,0);target.removeAttribute('disabled');
  click({isTrusted:true,target});output.innerHTML='<span class="processing title">Processing</span>';await pause();
  code='int main(){return 3;}';output.innerHTML='<span class="passed title">Accepted</span>new result';await pause();
  assert.equal(judged.length,1);assert.equal(judged[0].code,'int main(){return 0;}');
  click({isTrusted:true,target});click({isTrusted:true,target:document.querySelector('#href_history')});output.innerHTML='<span class="passed title">Accepted</span>history';await pause();assert.equal(judged.length,1);
  click({isTrusted:true,target:document.querySelector('#btnTest')});output.innerHTML='<span class="testing title">Testing</span>AC\nAccepted';await pause();assert.equal(judged.length,1);dom.window.close();
});
test('fast AC waits for its own submission extraction/save and archives the submitted code while drafts remain independent',async()=>{
  const dom=new JSDOM('',{url,runScripts:'outside-only'});let onConnect,onNativeReply,receive,release,started;const messages=[],session={};
  const gate=new Promise(r=>{release=r;}),ready=new Promise(r=>{started=r;});let extracts=0;
  dom.window.extractPage=()=>{};dom.window.installSubmissionObserver=()=>{};
  dom.window.chrome={tabs:{get:async()=>({url})},storage:{local:{get:async()=>({})},session:{set:async data=>Object.assign(session,data),get:async key=>({[key]:session[key]}),remove:async key=>{delete session[key];}}},
    scripting:{executeScript:async spec=>{if(spec.func===dom.window.installSubmissionObserver)return [];if(++extracts===1){started();await gate;}return [{result:{title:'测试题',problem:{description:'题面完整文字题面完整文字题面完整文字题面完整文字'},runtime:{output:'judged output'},candidates:[{value:'int main(){return 99;}'}]}}];}},
    runtime:{onConnect:{addListener:fn=>{onConnect=fn;}},connectNative:()=>({onMessage:{addListener:fn=>{onNativeReply=fn;}},onDisconnect:{addListener(){}},postMessage:m=>{messages.push(m);queueMicrotask(()=>onNativeReply({type:m.type==='verdict'?'verdict_saved':'saved',requestType:m.type,requestId:m.requestId,id:'a'.repeat(64)}));}})}};
  const source=await fs.readFile(new URL('../extension/background.js',import.meta.url),'utf8');dom.window.eval(source.replace(/^import[^\n]+\n/gm,''));
  onConnect({name:'pku-coach',sender:{url,tab:{id:1}},onMessage:{addListener:fn=>{receive=fn;}},onDisconnect:{addListener(){}},postMessage(){},disconnect(){}});
  const id=randomUUID(),code='int main(){return 0;}',receipt={id,url,code};
  const submitting=receive({type:'submission',receipt});await ready;
  const judged=receive({type:'judged',accepted:{submissionId:id,code,verdict:{source:'judge-dom',status:'AC',text:'Accepted'}}});
  await receive({type:'save',capture:{url,code:'int main(){return 2;}'}});assert.equal(messages[0].type,'save');
  release();await Promise.all([submitting,judged]);
  assert.deepEqual(messages.map(m=>m.type),['save','submission','finish']);assert.equal(messages[2].capture.code,code);assert.equal(messages[2].runtime.output,'judged output');
  dom.window.close();
});
