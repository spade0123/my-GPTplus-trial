import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {DiscussionStream} from '../src/discussion-stream.js';
import {discussionContext} from '../src/discussion-context.js';
import {saveAttempt} from '../src/problem-history.js';
import {queueDiscussion,queueHint,processHint,readHint,drainHints} from '../src/hint-review.js';
const fixture=fileURLToPath(new URL('./fixtures/chat-server.mjs',import.meta.url));
const capture={url:'https://programming.pku.edu.cn/probset/d0ef3e0f7fa5481d896f9a07254c8ecd/b672274bc30a4243af36f8968e8371b4/ide.do',title:'测试题',problem:{description:'输入两个整数，计算并输出它们的和。',input:'两个整数',output:'和',sampleInput:'1 2',sampleOutput:'3'},code:'int main(){return 0;}',standard:'c++17'};
const evidence=question=>({question,capture,history:[]});
function client(options={}){let launches=0;const stream=new DiscussionStream({resolveCommand:async()=>process.execPath,spawnProcess:(_command,args,spec)=>{launches++;assert.ok(args.includes('shell_tool'));assert.ok(args.includes('model_reasoning_effort="high"'));return spawn(process.execPath,[fixture],spec);},...options});return {stream,get launches(){return launches;}};}
async function isolated(fn){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pku-chat-speed-'));process.env.PKU_DATA_DIR=dir;try{await fn(dir);}finally{delete process.env.PKU_DATA_DIR;await fs.rm(dir,{recursive:true,force:true});}}
test('a real stdio client exposes partial replies before completion and reuses its private process',async()=>{
 const c=client(),updates=[];let completed=false;
 try{
  await c.stream.warm();assert.equal(c.stream.active.size,0);assert.ok(c.stream.prepared);
  const pending=c.stream.run(evidence('tool'),{onDelta:text=>{updates.push(text);assert.equal(completed,false);}}).then(answer=>{completed=true;return answer;});
  const answer=await pending;assert.equal(updates[0],'先检查边界。');assert.equal(answer.answer,'先检查边界。然后手算两轮。');
  await c.stream.run(evidence('again'));assert.equal(c.launches,1);
 }finally{await c.stream.close();}
});
test('failed/timeout/disconnected turns do not become completed replies, and partial text survives',async()=>{
 for(const question of ['fail','timeout','disconnect']){
  const c=client({timeoutMs:250}),parts=[];
  try{await assert.rejects(c.stream.run(evidence(question),{onDelta:text=>parts.push(text)}));if(question!=='disconnect')assert.equal(parts[0],'先检查边界。');}
  finally{await c.stream.close();}
 }
});
test('unsafe server sessions are rejected before any source is sent',async()=>{
 const c=client({spawnProcess:(_command,_args,spec)=>spawn(process.execPath,[fixture,'--unsafe'],spec)});
 try{await assert.rejects(c.stream.run(evidence('test')),/临时只读/);}finally{await c.stream.close();}
});
test('interactive context keeps source/runtime while removing recursive review and duplicated hint trees',()=>{
 const result=discussionContext({...evidence('问题'),debugHistory:{previous:{code:'old source'},assistance:'large tree'},risks:'not requested',history:[{question:'上次问题',status:'complete',analysis:'上次回答',instantAnalysis:'repeated large text',compiler:{text:'noise'}}]});
 assert.equal(result.capture,capture);assert.equal(result.debugHistory,undefined);assert.deepEqual(result.history,[{question:'上次问题',status:'complete',answer:'上次回答'}]);
});
test('streamed text is saved while running and on failure without starting a compiler for discussion',()=>isolated(async()=>{
 const saved=await saveAttempt(capture,{origin:'discussion'}),job=await queueDiscussion(saved.id,{question:'这段代码什么意思？',eventId:saved.eventId,attemptNumber:saved.attemptNumber});
 let release,started;const gate=new Promise(r=>release=r),ready=new Promise(r=>started=r);
 const running=processHint(job.id,{compile:()=>{throw new Error('discussion must not start compiler');},discussionModel:async(_evidence,{onDelta})=>{onDelta('第一句回答。');started();await gate;throw new Error('模拟连接中断');}});
 await ready;
 let during;for(let i=0;i<50;i++){during=await readHint(job.id);if(during.partialAnalysis)break;await new Promise(r=>setTimeout(r,5));}
 assert.equal(during.status,'running');assert.equal(during.partialAnalysis,'第一句回答。');assert.ok(during.firstTokenAt);
 release();await assert.rejects(running,/模拟连接中断/);assert.equal((await readHint(job.id)).partialAnalysis,'第一句回答。');assert.equal((await readHint(job.id)).status,'failed');
}));
test('a stalled ordinary hint never occupies the separate discussion lane',()=>isolated(async()=>{
 const saved=await saveAttempt(capture,{origin:'discussion'});await queueHint(saved.id);
 const chat=await queueDiscussion(saved.id,{question:'什么意思？',eventId:saved.eventId,attemptNumber:saved.attemptNumber});
 let release,start;const ready=new Promise(r=>start=r),gate=new Promise(r=>release=r);
 const ordinary=drainHints({kind:'hint',compile:async()=>({status:'passed'}),model:async()=>{start();await gate;throw new Error('模拟长提示');}});
 try{await ready;await drainHints({kind:'discussion',discussionModel:async()=>({answer:'当前代码直接结束程序。',next_step:''})});assert.equal((await readHint(chat.id)).status,'complete');}
 finally{release();await ordinary;}
}));
