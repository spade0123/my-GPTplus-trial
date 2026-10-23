import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {JSDOM} from 'jsdom';
import {DiscussionStream} from '../src/discussion-stream.js';
import {HINT_STREAM_GUIDE,hintModelContext,formatStreamHint,HINT_REVISION} from '../src/hint-format.js';
import {saveAttempt} from '../src/problem-history.js';
import {queueHint,readHint,processHint} from '../src/hint-review.js';

const url='https://programming.pku.edu.cn/probset/'+'a'.repeat(32)+'/'+'b'.repeat(32)+'/ide.do';
const capture={url,title:'两数求和',problem:{description:'读入两个整数，输出它们的和。',input:'两个整数',output:'和',sampleInput:'1 2',sampleOutput:'3'},statement:'重复题面',code:'#include <iostream>\nusing namespace std;\nint main(){return 0;}',runtime:{text:'旧运行结果'},standard:'c++17'};
const markdown='## 解题方向\n读入两个整数，再计算并输出它们的和，时间和额外空间均为 O(1)。\n\n## 对照你的代码\n第 3 行 main 直接返回，尚未读取两个整数或计算其和。\n\n## 下一步\n在第 3 行 return 前声明 a、b，使用 cin >> a >> b 读入，再输出 a+b。\n\n## 手算验证\n输入 1 2，预期输出 3；1+2=3，这是手算推导，未实际运行。';
async function isolated(fn){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pku-hint-direction-'));process.env.PKU_DATA_DIR=dir;try{await fn(dir);}finally{delete process.env.PKU_DATA_DIR;await fs.rm(dir,{recursive:true,force:true});}}
const compile=async()=>({status:'passed',ranProgram:false});

test('direction prompts keep the complete current source/statement evidence and exclude recursive review trees',()=>{
  const context=hintModelContext({capture,diagnostics:{status:'diagnostics',ranProgram:false,output:'error'},answerContext:{basis:'saved-ac',reference:{code:'reference'}},debugHistory:{analysis:'old giant review'},risks:{generic:'risk'}});
  assert.equal(context.capture.code,capture.code);assert.deepEqual(context.capture.problem,capture.problem);assert.equal(context.capture.runtime.text,'旧运行结果');assert.equal(context.capture.statement,undefined);
  assert.equal(context.debugHistory,undefined);assert.equal(context.risks,undefined);assert.equal(context.answerContext.reference.code,'reference');
  assert.equal(hintModelContext({capture:{code:capture.code,statement:'只有旧式题面',problem:{description:''}}}).capture.statement,'只有旧式题面');
  assert.match(HINT_STREAM_GUIDE,/关键比较与状态更新/);assert.match(formatStreamHint({markdown}).markdown,/^## 解题方向/);
  assert.throws(()=>formatStreamHint({markdown:'这是泛泛的检查清单。请检查输入并多做测试，没有具体解题方向。'}),/解题方向结构/);
});

test('direction mode streams through an isolated stdio connection using its own guide and context',async()=>{
  const fixture=fileURLToPath(new URL('./fixtures/chat-server.mjs',import.meta.url)),updates=[];
  const stream=new DiscussionStream({resolveCommand:async()=>process.execPath,spawnProcess:(_command,_args,spec)=>spawn(process.execPath,[fixture],spec),guide:HINT_STREAM_GUIDE,context:hintModelContext,label:'提示'});
  try{const answer=await stream.run({capture},{onDelta:text=>updates.push(text)});assert.match(updates[0],/^## 解题方向/);assert.match(answer.answer,/对照你的代码/);assert.equal(formatStreamHint({markdown:answer.answer}).report.format,'direction-markdown');}
  finally{await stream.close();}
});

test('a hint saves partial algorithm guidance before completion and allows independent saves',()=>isolated(async()=>{
  const saved=await saveAttempt(capture);await queueHint(saved.id);let release,started;
  const gate=new Promise(r=>release=r),ready=new Promise(r=>started=r);
  const running=processHint(saved.id,{compile,model:async(evidence,{onDelta})=>{assert.equal(evidence.capture.code,capture.code);onDelta('## 解题方向\n读入两个整数后相加。');started();await gate;return {markdown};}});
  try{
    await ready;let during;
    for(let i=0;i<80;i++){during=await readHint(saved.id);if(during.partialAnalysis)break;await new Promise(r=>setTimeout(r,5));}
    assert.equal(during.status,'running');assert.match(during.partialAnalysis,/读入两个整数后相加/);assert.ok(during.firstTokenAt);
    const other=await saveAttempt({...capture,code:capture.code.replace('return 0','return 1')});assert.notEqual(other.id,saved.id);
  }finally{release();}
  const done=await running;assert.equal(done.status,'complete');assert.equal(done.hintRevision,HINT_REVISION);assert.equal(done.analysis,markdown);
}));

test('failed directions retain partial text and retry clears stale answers while retaining failure history',()=>isolated(async dir=>{
  const saved=await saveAttempt(capture);await queueHint(saved.id);
  await assert.rejects(processHint(saved.id,{compile,model:async(_evidence,{onDelta})=>{onDelta('## 解题方向\n先读入两个整数。');throw new Error('模拟连接中断');}}),/模拟连接中断/);
  const failed=await readHint(saved.id);assert.equal(failed.status,'failed');assert.match(failed.partialAnalysis,/先读入两个整数/);
  await fs.writeFile(path.join(dir,'hints',saved.id+'.json'),JSON.stringify({...failed,analysis:'不应盖住新方向的旧答案'}));
  const retried=await queueHint(saved.id);assert.equal(retried.partialAnalysis,undefined);assert.equal(retried.analysis,undefined);assert.match(retried.previousRuns.at(-1).error,/模拟连接中断/);
  await processHint(saved.id,{compile,model:async()=>({markdown})});assert.equal((await readHint(saved.id)).analysis,markdown);
}));

test('the production hint frame shows algorithm streaming first, puts local checks in collapsed details, and exposes failures with retry',async()=>{
  const html=await fs.readFile(new URL('../extension/assist-window.html',import.meta.url),'utf8');
  const dom=new JSDOM(html,{url:'https://own-frame.test',runScripts:'outside-only'}),w=dom.window,sent=[];let receive;
  w.chrome={runtime:{connect:()=>({onMessage:{addListener:fn=>receive=fn},onDisconnect:{addListener(){}},postMessage:msg=>sent.push(msg)})}};
  try{
    for(const name of ['vendor/marked/marked.umd.js','report-renderer.js','instant-hints.js','assist-window.js'])w.eval(await fs.readFile(new URL('../extension/'+name,import.meta.url),'utf8'));
    const $=id=>w.document.getElementById(id);$('hint').click();const actionId=sent.at(-1).actionId;
    receive({type:'action_preview',requestType:'hint',actionId,capture,missingSections:[]});
    assert.equal($('hintLocal').open,false);assert.match($('hintLocalAnswer').textContent,/本题要求的结果/);assert.doesNotMatch($('hintAnswer').textContent,/核对输入与边界/);
    const id='c'.repeat(64);receive({type:'saved',actionId,hint:{id,kind:'hint',status:'queued',instantAnalysis:'仅本地检查'}});
    receive({type:'hint_status',id,kind:'hint',status:'running',partialAnalysis:'## 解题方向\n具体相加。',instantAnalysis:'仅本地检查'});
    assert.equal($('hintAnswer').querySelector('h2').textContent,'解题方向');assert.match($('hintAnswer').textContent,/具体相加/);
    receive({type:'hint_status',id,kind:'hint',status:'failed',partialAnalysis:'## 解题方向\n具体相加。',error:'模拟网络中断'});assert.match($('hintState').textContent,/模拟网络中断/);assert.match($('hintAnswer').textContent,/具体相加/);
    $('refreshHint').click();assert.equal(sent.at(-1).type,'hint');assert($('refreshHint').disabled);
  }finally{dom.window.close();}
});
