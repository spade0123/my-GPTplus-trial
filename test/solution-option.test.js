import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {JSDOM} from 'jsdom';
import {saveAttempt,recordVerdict} from '../src/problem-history.js';
import {readReview,assistanceContext,reviewHistory} from '../src/browser-review.js';
import {queueHint,queueDiscussion,processHint,discussionHistory,hintHistory,hintSummary,previousSolutionContext} from '../src/hint-review.js';
import {discussionContext,SOLUTION_REQUEST} from '../src/discussion-context.js';

const url='https://programming.pku.edu.cn/probset/'+'a'.repeat(32)+'/'+'b'.repeat(32)+'/ide.do';
const code='#include <iostream>\nusing namespace std;\nint main(){int a,b;cin>>a>>b;cout<<a+b;}';
const capture={url,title:'求和',problem:{description:'给定两个整数，求它们的和。',input:'两个整数',output:'整数和',sampleInput:'1 2',sampleOutput:'3'},runtime:{text:'旧执行结果'},code,standard:'c++17'};
const answer='## 原题目\n给定两个整数求和；输入 1 2，样例输出 3。\n\n## 解题思路\n读入相加。\n\n## 对照你的代码\n你的实现已经求和。\n\n## 完整参考程序\n```cpp\n'+code+'\n```\n\n## 复杂度与验证\n时间和额外空间 O(1)。输入 1 2 预期输出 3，手算未运行。';
async function isolated(fn){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pku-solution-'));process.env.PKU_DATA_DIR=dir;try{await fn();}finally{delete process.env.PKU_DATA_DIR;await fs.rm(dir,{recursive:true,force:true});}}

test('solution generation freezes the newly captured source, is recorded for reports, and works independently of AC-only hints',()=>isolated(async()=>{
  const first=await saveAttempt({...capture,code:'int main(){return 0;}'});await queueHint(first.id);
  const submitted=await saveAttempt(capture,{kind:'submission'});
  // AC suppression is only for debug hints, not an explicit teaching request.
  const {randomUUID}=await import('node:crypto');const submissionId=randomUUID();await saveAttempt(capture,{kind:'submission',submissionId});await recordVerdict(url,submissionId,{source:'judge-dom',status:'AC'});
  assert.equal((await queueHint(submitted.id)).status,'skipped');
  const fresh=await saveAttempt(capture,{origin:'discussion'}),job=await queueDiscussion(fresh.id,{question:'给出完整解答',purpose:'solution',eventId:fresh.eventId,attemptNumber:fresh.attemptNumber});
  assert.notEqual(fresh.id,first.id);assert.equal(hintSummary(job).purpose,'solution');
  const complete=await processHint(job.id,{compile:()=>{throw new Error('Must not run/compile student code for a solution request');},discussionModel:async(evidence,options)=>{
    assert.equal(evidence.capture.code,code);assert.equal(evidence.purpose,'solution');assert.deepEqual(evidence.history,[]);assert.equal(options.timeoutMs,120000);
    const context=discussionContext(evidence);assert.equal(context.question,SOLUTION_REQUEST);assert.equal(context.purpose,'solution');assert.match(context.question,/using namespace std;/);assert.match(context.question,/原题目/);assert.match(context.question,/不回填编辑器/);
    options.onDelta('## 原题目\n给定两个整数求和。');return {answer,next_step:''};
  }});
  assert.equal(complete.analysis,answer);assert.equal((await readReview(fresh.id)).code,code);
  const assistance=await assistanceContext(fresh.id);assert(assistance.events.some(e=>e.purpose==='solution'&&e.analysis===answer));
  assert.equal((await discussionHistory(url)).entries.some(e=>e.id===job.id),false);
  assert.equal((await hintHistory(url)).solution.id,job.id);
  const history=await reviewHistory({includeSource:true});assert(history.records.some(r=>r.assistance?.events.some(e=>e.purpose==='solution')));
  await assert.rejects(queueDiscussion(fresh.id,{question:'x',purpose:'invalid'}),/无效的问答用途/);
}));

test('the solution option only requests a full answer on click, renders in its own collapsible area, and never replaces ordinary hints',async()=>{
  const html=await fs.readFile(new URL('../extension/assist-window.html',import.meta.url),'utf8'),dom=new JSDOM(html,{url:'https://own-frame.test',runScripts:'outside-only'}),w=dom.window,sent=[];let receive;
  w.chrome={runtime:{connect:()=>({onMessage:{addListener:fn=>receive=fn},onDisconnect:{addListener(){}},postMessage:msg=>sent.push(msg)})}};
  try{
    for(const name of ['vendor/marked/marked.umd.js','report-renderer.js','instant-hints.js','assist-window.js'])w.eval(await fs.readFile(new URL('../extension/'+name,import.meta.url),'utf8'));
    const $=id=>w.document.getElementById(id),hintId='c'.repeat(64),solutionId='d'.repeat(64);
    assert($('chatForm').compareDocumentPosition($('chatMessages'))&w.Node.DOCUMENT_POSITION_FOLLOWING);
    $('hint').click();const hintAction=sent.at(-1).actionId;receive({type:'action_preview',requestType:'hint',actionId:hintAction,capture,missingSections:[]});
    receive({type:'saved',actionId:hintAction,hint:{id:hintId,kind:'hint',status:'complete',analysis:'## 解题方向\n原来的方向提示'}});
    assert.equal($('solutionPanel').hidden,true);assert.equal(sent.filter(m=>m.purpose==='solution').length,0);
    $('giveSolution').click();const request=sent.at(-1);assert.equal(request.type,'discuss');assert.equal(request.purpose,'solution');assert.match(request.question,/无注释/);assert.match(request.question,/cnt\+1/);assert.equal($('solutionPanel').open,true);assert($('giveSolution').disabled);
    $('giveSolution').click();assert.equal(sent.filter(m=>m.purpose==='solution').length,1);
    receive({type:'action_preview',requestType:'discuss',actionId:request.actionId,capture,missingSections:[]});
    receive({type:'saved',actionId:request.actionId,hint:{id:solutionId,kind:'discussion',purpose:'solution',status:'running',codeHash:'a'.repeat(64)}});
    receive({type:'hint_status',id:solutionId,kind:'discussion',purpose:'solution',status:'running',partialAnalysis:'## 原题目\n两个整数求和',codeHash:'a'.repeat(64)});assert.match($('solutionAnswer').textContent,/两个整数求和/);
    receive({type:'hint_status',id:solutionId,kind:'discussion',purpose:'solution',status:'complete',analysis:answer,codeHash:'a'.repeat(64)});
    assert.equal($('giveSolution').disabled,false);assert.match($('solutionAnswer').querySelector('pre code').textContent,/using namespace std;/);assert.match($('hintAnswer').textContent,/原来的方向提示/);assert.equal($('chatMessages').textContent,'');
    $('solutionPanel').open=false;assert.match($('solutionAnswer').textContent,/完整参考程序/);
    $('refreshHint').click();assert.equal($('solutionPanel').hidden,false);
    receive({type:'hint_status',id:solutionId,kind:'discussion',purpose:'solution',status:'complete',analysis:answer});assert.equal($('solutionPanel').hidden,false);assert.match($('solutionAnswer').textContent,/完整参考程序/);
  }finally{dom.window.close();}
});

test('a new answer receives fresh runtime and the previous same-problem solution as unverified correction context',()=>isolated(async()=>{
  const first=await saveAttempt({...capture,code:'int main(){return 0;}',runtime:{text:'first output'}},{origin:'discussion'});
  const firstJob=await queueDiscussion(first.id,{question:'给出解答',purpose:'solution',eventId:first.eventId,attemptNumber:first.attemptNumber});
  await processHint(firstJob.id,{discussionModel:async()=>({answer,next_step:''})});
  const nextCapture={...capture,runtime:{text:'error: expected semicolon; newest output'}};
  const next=await saveAttempt(nextCapture,{origin:'discussion'}),job=await queueDiscussion(next.id,{question:'结合新运行信息修正解答',purpose:'solution',eventId:next.eventId,attemptNumber:next.attemptNumber});
  await processHint(job.id,{discussionModel:async evidence=>{
    assert.equal(evidence.capture.code,code);assert.equal(evidence.capture.runtime.text,nextCapture.runtime.text);assert.equal(evidence.previousSolution.jobId,firstJob.id);assert.equal(evidence.previousSolution.answer,answer);assert.equal(evidence.previousSolution.notVerifiedAnswer,true);
    const model=discussionContext(evidence);assert.equal(model.previousSolution.jobId,firstJob.id);assert.match(model.question,/不加任何/);assert.match(model.question,/cnt\+1/);assert(model.question.indexOf('完整参考程序')<model.question.indexOf('原题目'));return {answer,next_step:''};
  }});
  assert.equal(await previousSolutionContext({...nextCapture,problem:{...capture.problem,description:'题意已改，改为求积。'}},next.eventId),null);
}));
