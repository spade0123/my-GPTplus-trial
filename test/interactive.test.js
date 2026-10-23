import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {JSDOM} from 'jsdom';
import {saveAttempt,recordVerdict,timeline} from '../src/problem-history.js';
import {readReview,reviewHistory,assistanceContext} from '../src/browser-review.js';
import {queueHint,queueDiscussion,discussionHistory,processHint,drainHints,readHint} from '../src/hint-review.js';
import {drainQueue} from '../src/review-queue.js';
import {selectActionCapture,readCurrentJudgment} from '../extension/capture-actions.js';
import {hintAnswerContext} from '../src/hint-context.js';

const url='https://programming.pku.edu.cn/probset/d0ef3e0f7fa5481d896f9a07254c8ecd/f6b942b2dcd74656880a088f85f56c3f/ide.do';
const capture={url,title:'交互功能测试',problem:{description:'输入两个整数并输出它们的和，范围为零到一百。',input:'两个整数',output:'整数和',sampleInput:'1 2',sampleOutput:'3'},runtime:{text:'先前执行输出 AC'},code:'int main(){int a[2]; for(int i=0;i<=2;i++)a[i]=i;}',standard:'c++17'};
const hint={summary:'目前没有读取输入或输出两数之和，且有数组越界风险。',solution:{goal:'读取两个整数并输出它们的和。',approach:'依次读取两个整数，计算相加的结果并输出。',gap:'当前代码只给数组赋值，尚未读取题目输入或计算、输出和。'},issues:[{lines:'1',certainty:'待验证',reason:'终止下标需要核对。',hint:'长度为 2 时最后有效下标是多少？',correction:'核对是否应该使用 i < 2。',check:'手算 i=2 时访问；未实际运行。'}],next_step:'先补全读取和输出，再用 1 2 验证预期输出 3。'};
const compile=async()=>({status:'passed',ranProgram:false});
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function isolated(fn){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pku-interactive-'));process.env.PKU_DATA_DIR=dir;try{await fn(dir);}finally{delete process.env.PKU_DATA_DIR;await fs.rm(dir,{recursive:true,force:true});}}

test('current AC requires exact code and problem association, never stdout or a changed buffer',()=>{
  const dom=new JSDOM('<pre id="output"><span class="title">Accepted</span></pre>',{url,runScripts:'outside-only'});
  try{
    const code='int main(){return 0;}';
    const read=()=>dom.window.eval(`(${readCurrentJudgment.toString()})(${JSON.stringify(code)})`);
    assert.equal(read().status,'unknown');
    dom.window.solution={problemId:url.split('/')[5],sourceCode:code,result:'Passed'};
    assert.equal(read().status,'AC');
    dom.window.solution.sourceCode='int main(){return 1;}';assert.equal(read().status,'unknown');
    dom.window.solution.sourceCode=code;dom.window.solution.problemId='other';assert.equal(read().status,'unknown');
    dom.window.__pkuCoachSubmissionObserver={lastJudgment:{url,code,verdict:{status:'WA'}}};assert.equal(read().status,'WA');
  }finally{dom.window.close();}
});

test('direct actions prefer the actual PKU editor and refuse ambiguous or navigated captures',()=>{
  const page={...capture,candidates:[{source:'ace:0',value:'primary code'},{source:'textarea:0',value:'other code'}],primarySource:'ace:0'};
  assert.equal(selectActionCapture(page,url,{preferredSource:'textarea:0'}).capture.code,'primary code');
  assert.throws(()=>selectActionCapture({...page,primarySource:''},url),/多个编辑器/);
  assert.throws(()=>selectActionCapture({...page,url:url.replace('ide.do','other.do')},url),/页面已改变/);
});

test('hint captures and questions remain attached to their frozen versions and are exposed to reports',()=>isolated(async()=>{
  const first=await saveAttempt(capture,{origin:'hint_request'});
  await queueHint(first.id,{eventId:first.eventId,attemptNumber:first.attemptNumber,requestedAt:'2026-10-18T08:00:00.000Z'});
  const second=await saveAttempt({...capture,code:'int main(){return 0;}'},{origin:'quick_save'});
  await processHint(first.id,{compile,model:async evidence=>{assert.equal(evidence.capture.code,capture.code);assert.equal(evidence.capture.runtime.text,capture.runtime.text);assert.equal(evidence.answerContext.basis,'problem-inference');assert.equal(evidence.answerContext.reference,null);return hint;}});
  assert.equal((await readReview(first.id)).code,capture.code);assert.notEqual(first.id,second.id);
  const context=await assistanceContext(first.id);assert.equal(context.events[0].requestedAt,'2026-10-18T08:00:00.000Z');assert.match(context.events[0].analysis,/改正方法/);
  const history=await reviewHistory({includeSource:true});assert.ok(history.records.some(r=>r.assistance?.events.length===1));
  const time=await timeline(url);assert.equal(time.attempts[0].assistance.events[0].jobId,first.id);
  assert.match((await readHint(first.id)).analysis,/本题目标与解题方向/);assert.match((await readHint(first.id)).analysis,/与当前代码的差距/);
}));

test('hint references use only saved judge-linked AC code for the same unchanged problem, never generated answers',()=>isolated(async dir=>{
  const good={...capture,code:'#include <iostream>\nusing namespace std;\nint main(){int a,b;cin>>a>>b;cout<<a+b;}',runtime:{}};
  const other={...good,url:url.replace('f6b942b2dcd74656880a088f85f56c3f','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')};
  const wrongId=randomUUID();await saveAttempt(other,{kind:'submission',submissionId:wrongId});await recordVerdict(other.url,wrongId,{source:'judge-dom',status:'AC'});
  assert.equal((await hintAnswerContext(capture)).reference,null);
  const draft=await saveAttempt(capture);const draftRecord=await readReview(draft.id);draftRecord.analysis='假设这是模型生成的标准答案。';await fs.writeFile(path.join(dir,draft.id+'.json'),JSON.stringify(draftRecord));
  assert.equal((await hintAnswerContext(capture)).reference,null);
  const submissionId=randomUUID(),accepted=await saveAttempt(good,{kind:'submission',submissionId});await recordVerdict(url,submissionId,{source:'judge-dom',status:'AC'});
  const reference=await hintAnswerContext(capture);assert.equal(reference.basis,'saved-ac');assert.equal(reference.reference.code,good.code);assert.equal(reference.reference.submissionId,submissionId);
  assert.equal((await hintAnswerContext({...capture,problem:{...capture.problem,description:'题意已改为求两个整数的乘积，不再求和。'}})).reference,null);
  await queueHint(draft.id);const completed=await processHint(draft.id,{compile,model:async evidence=>{assert.equal(evidence.answerContext.reference.code,good.code);return hint;}});
  assert.match(completed.analysis,/同题 AC 代码/);
  const corrupted=await readReview(accepted.id);corrupted.code='int main(){return 99;}';await fs.writeFile(path.join(dir,accepted.id+'.json'),JSON.stringify(corrupted));
  assert.equal((await hintAnswerContext(capture)).reference,null);
}));

test('requesting an old hint upgrades its guidance once and preserves the original response',()=>isolated(async dir=>{
  const saved=await saveAttempt(capture);await queueHint(saved.id);const completed=await processHint(saved.id,{compile,model:async()=>hint});
  assert.equal((await queueHint(saved.id)).status,'complete');
  const old={...completed,analysis:'旧的通用提示'};delete old.hintRevision;
  await fs.writeFile(path.join(dir,'hints',saved.id+'.json'),JSON.stringify(old));
  const upgraded=await queueHint(saved.id);assert.equal(upgraded.status,'queued');assert.equal(upgraded.previousReports[0].analysis,'旧的通用提示');
  const fresh=await processHint(saved.id,{compile,model:async()=>hint});assert.match(fresh.analysis,/解题方向/);assert.equal(fresh.previousReports[0].analysis,'旧的通用提示');assert.equal((await queueHint(saved.id)).status,'complete');
}));

test('hint queue is independent of a stalled full report and does not block another save',()=>isolated(async()=>{
  const first=await saveAttempt(capture);await queueHint(first.id);
  let start,release;const ready=new Promise(r=>start=r),gate=new Promise(r=>release=r);
  const reportRunning=drainQueue({compile,model:async()=>{start();await gate;return {markdown:'这是模拟完整报告，不是实际作业分析结论。',topics:[],evidence:'',next_step:''};}});
  try{
    await ready;let hintCalls=0;
    await drainHints({compile,model:async()=>{hintCalls++;return hint;}});assert.equal(hintCalls,1);assert.equal((await readHint(first.id)).status,'complete');
    const saved=await saveAttempt({...capture,code:'int main(){return 2;}'});assert.equal(saved.status,'queued');
  }finally{release();await reportRunning;}
}));

test('known AC suppresses hints, changed code still gets hints, and late AC wins over a running hint',()=>isolated(async()=>{
  const submission=randomUUID(),saved=await saveAttempt(capture,{kind:'submission',submissionId:submission});
  await recordVerdict(url,submission,{source:'judge-dom',status:'AC',text:'Accepted'});
  assert.equal((await queueHint(saved.id)).status,'skipped');
  const changed=await saveAttempt({...capture,code:'int main(){return 4;}'});await queueHint(changed.id);assert.equal((await readHint(changed.id)).status,'queued');
  const nextSubmission=randomUUID();await saveAttempt({...capture,code:'int main(){return 4;}'},{kind:'submission',submissionId:nextSubmission});
  let start,release;const ready=new Promise(r=>start=r),gate=new Promise(r=>release=r);
  const running=processHint(changed.id,{compile,model:async()=>{start();await gate;return hint;}});
  await ready;await recordVerdict(url,nextSubmission,{source:'judge-dom',status:'AC',text:'Accepted'});release();await running;
  assert.equal((await readHint(changed.id)).status,'skipped');
}));

test('discussion saves every question with code, reuses history, works after AC, and keeps failure evidence',()=>isolated(async()=>{
  const first=await saveAttempt(capture,{origin:'discussion'});
  const submission=randomUUID();await saveAttempt(capture,{kind:'submission',submissionId:submission});
  await recordVerdict(url,submission,{source:'judge-dom',status:'AC',text:'Accepted'});
  const job=await queueDiscussion(first.id,{question:'第1行的循环边界为什么有风险？',eventId:first.eventId,attemptNumber:first.attemptNumber});
  await processHint(job.id,{compile,discussionModel:async evidence=>{assert.equal(evidence.question,'第1行的循环边界为什么有风险？');return {answer:'数组长度为 2，通常最后合法下标是 1。',next_step:'检查 i=2 的迭代。'};}});
  const second=await saveAttempt({...capture,code:'int main(){return 0;}'},{origin:'discussion'});
  const next=await queueDiscussion(second.id,{question:'我现在这样改可以吗？',eventId:second.eventId,attemptNumber:second.attemptNumber});
  await processHint(next.id,{compile,discussionModel:async evidence=>{assert.equal(evidence.history.length,1);assert.match(evidence.history[0].analysis,/数组长度/);throw new Error('模拟网络失败');}}).catch(()=>{});
  const history=await discussionHistory(url);assert.equal(history.entries.length,2);assert.equal(history.entries[1].status,'failed');
  assert.equal((await readReview(first.id)).code,capture.code);
  assert.equal((await assistanceContext(second.id)).events[0].question,'我现在这样改可以吗？');
  const retried=await queueDiscussion(second.id,{question:next.question,eventId:next.eventId});assert.equal(retried.id,next.id);assert.equal(retried.status,'queued');
  const otherUrl=url.replace('f6b942b2dcd74656880a088f85f56c3f','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  const other=await saveAttempt({...capture,url:otherUrl},{origin:'discussion'});
  await queueDiscussion(other.id,{question:'另一道题的独立问题',eventId:other.eventId,attemptNumber:other.attemptNumber});
  assert.equal((await discussionHistory(url)).entries.length,2);
  assert.equal((await discussionHistory(otherUrl)).entries[0].question,'另一道题的独立问题');
}));

test('interrupted interactive jobs recover without duplicating saved questions',()=>isolated(async dir=>{
  const saved=await saveAttempt(capture,{origin:'discussion'});
  const job=await queueDiscussion(saved.id,{question:'这个循环如何理解？',eventId:saved.eventId,attemptNumber:saved.attemptNumber});
  const file=path.join(dir,'hints',job.id+'.json');
  await fs.writeFile(file,JSON.stringify({...job,status:'running',workerPid:2147483647}));
  const result=await drainHints({compile,discussionModel:async()=>({answer:'先检查初值，再检查循环条件和每轮更新。',next_step:'手算前两轮。'})});
  assert.deepEqual(result.attempted,[job.id]);assert.equal((await readHint(job.id)).status,'complete');
  assert.equal((await assistanceContext(saved.id)).events.length,1);
}));

test('instant feedback is code-aware, ignores quoted code, and handles long incomplete source promptly',async()=>{
  const dom=new JSDOM('',{runScripts:'outside-only'});
  try{
    dom.window.eval(await fs.readFile(new URL('../extension/instant-hints.js',import.meta.url),'utf8'));
    const local=dom.window.PkuInstantHints;
    assert.match(local.generate(capture).markdown,/终止边界/);
    assert.equal(local.generate({...capture,code:'int main(){ const char* s="if(x=1)"; }'}).findings,0);
    const reply=local.discuss({...capture,code:'string s; auto p=s.find("x");'},'find 是做什么的？');assert.equal(reply.targeted,true);assert.match(reply.markdown,/npos/);
    const t=performance.now();local.generate({...capture,code:'/*'.repeat(50000)});assert.ok(performance.now()-t<500);
    assert.equal(local.generate(capture,{status:'AC'}).accepted,true);
  }finally{dom.window.close();}
});

test('quick save never opens details; first hints/chat appear without waiting for native/model completion',async()=>{
  const dom=new JSDOM('',{url,runScripts:'outside-only'});let receive,ui;const sent=[];
  try{
    const attach=dom.window.HTMLElement.prototype.attachShadow;dom.window.HTMLElement.prototype.attachShadow=function(opts){ui=attach.call(this,{...opts,mode:'open'});return ui;};
    dom.window.chrome={runtime:{getURL:()=>'',connect:()=>({onDisconnect:{addListener(){}},onMessage:{addListener:fn=>receive=fn},postMessage:m=>sent.push(m)})},storage:{local:{get:async()=>({}),set:async()=>{}}}};
    for(const name of ['vendor/marked/marked.umd.js','report-renderer.js','instant-hints.js','content.js'])dom.window.eval(await fs.readFile(new URL('../extension/'+name,import.meta.url),'utf8'));
    await receive({type:'auto_site_cache_status',status:'cleaned',cleared:2,estimatedBytes:5120});
    assert.match(ui.getElementById('cacheStatus').textContent,/已自动备份并清理 2 条/);assert.equal(ui.getElementById('toast').hidden,true);
    ui.getElementById('launch').click();const quick=sent.find(m=>m.type==='quick_save');assert.ok(quick);assert.equal(ui.getElementById('panel').hidden,true);
    ui.getElementById('hintLaunch').click();const request=sent.find(m=>m.type==='hint');
    const start=performance.now();await receive({type:'hint_preview',actionId:request.actionId,capture,judgment:{status:'unknown'}});
    assert.equal(ui.getElementById('hintReport').hidden,false);assert.match(ui.getElementById('hintReport').textContent,/终止边界/);assert.ok(performance.now()-start<3000);
    assert.match(ui.getElementById('hintReport').textContent,/本题要求的结果/);assert.match(ui.getElementById('hintReport').textContent,/整数和/);
    assert.equal(ui.getElementById('launch').disabled,true); // independent save still in flight
    await receive({type:'saved',requestType:'quick_save',actionId:quick.actionId,id:'a'.repeat(64),status:'queued'});assert.equal(ui.getElementById('launch').disabled,false);assert.equal(ui.getElementById('panel').hidden,true);
    ui.getElementById('chatLaunch').click();ui.getElementById('chatQuestion').value='find 是什么意思？';ui.getElementById('chatSend').click();const chat=sent.find(m=>m.type==='discuss');
    await receive({type:'discussion_preview',actionId:chat.actionId,question:chat.question,capture:{...capture,code:'string s; auto p=s.find("x");'}});
    assert.match(ui.getElementById('chatMessages').textContent,/npos/);assert.equal(ui.getElementById('chatSend').disabled,false);
  }finally{dom.window.close();}
});
