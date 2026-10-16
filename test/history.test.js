import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {saveAttempt,timeline,getProblem,recordVerdict,debugContext,problemSummary,updateProblem} from '../src/problem-history.js';
import {processReview,readReview} from '../src/browser-review.js';
import {processArchives,readBundle,retryArchive} from '../src/final-archive.js';
const url='https://programming.pku.edu.cn/probset/d0ef3e0f7fa5481d896f9a07254c8ecd/f6b942b2dcd74656880a088f85f56c3f/ide.do';
const capture={url,title:'隔离测试题',statement:'输入一个整数，输出对应的整数，输入范围为零到一百。',code:'int main(){return 0;}'};
const report={markdown:'隔离测试模型报告，不是用户作业的实际结论。检查边界条件并解释改动。',topics:['testing'],evidence:'模拟分析证据',next_step:'补充边界测试'};
const options={compile:async()=>({status:'passed',ranProgram:false}),model:async()=>report};
const ac={source:'judge-dom',status:'AC',text:'Accepted',observedAt:new Date().toISOString()};
async function isolated(work){const root=await fs.mkdtemp(path.join(os.tmpdir(),'pku-history-'));process.env.PKU_DATA_DIR=path.join(root,'data');try{await work(root);}finally{delete process.env.PKU_DATA_DIR;await fs.rm(root,{recursive:true,force:true});}}
test('version events retain A -> B -> A, notes and real diff even when identical snapshots are reused',()=>isolated(async()=>{
  const a=await saveAttempt(capture,{note:'初稿'}),b=await saveAttempt({...capture,code:'int main(){return 1;}'},{note:'修正边界'});
  const same=await saveAttempt(capture),eventId=randomUUID();
  const repeated=await saveAttempt(capture,{eventId});await saveAttempt(capture,{eventId});
  const t=await timeline(url);assert.equal(t.attempts.length,3);assert.equal(t.rawAttemptCount,4);assert.equal(t.attempts[0].number,1);
  assert.equal(t.attempts[2].occurrenceCount,2);assert.deepEqual(t.attempts[2].numbers,[3,4]);
  assert.equal(same.id,a.id);assert.equal(repeated.attemptNumber,4);assert.equal(t.attempts[1].note,'修正边界');
  const diff=await debugContext(url,b.id);assert.match(diff.diff,/-int main\(\)\{return 0;/);assert.match(diff.diff,/\+int main\(\)\{return 1;/);
  let evidence;await processReview(b.id,{...options,model:async e=>{evidence=e;return report;}});assert.equal(evidence.debugHistory.previous.code,capture.code);
  await assert.rejects(saveAttempt({...capture,code:'int main(){return 3;}'},{eventId}),/其他版本/);
}));

test('only identical full content merges, retries do not add occurrences, and A -> B -> A retains its original positions',()=>isolated(async()=>{
  const eventId=randomUUID();
  await saveAttempt(capture);await saveAttempt(capture,{eventId});await saveAttempt(capture,{eventId});
  const other={...capture,code:'int main(){return 1;}'};
  await saveAttempt(other);await saveAttempt(capture);
  await saveAttempt(capture,{note:'增加了新的 debug 解释'});
  await saveAttempt({...capture,runtime:{output:'different output'}});
  await saveAttempt({...capture,title:'新的题名'});
  await saveAttempt({...capture,standard:'c++20'});
  await saveAttempt({...capture,statement:capture.statement+' 新补充的输入约束。'});
  const p=await problemSummary(url),t=await timeline(url,{mergeDuplicates:false});
  assert.equal(p.rawAttemptCount,9);assert.equal(p.mergedAttemptCount,7);
  assert.equal(p.attempts[0].occurrenceCount,3);assert.deepEqual(p.attempts[0].numbers,[1,2,4]);
  assert.deepEqual(t.attempts.slice(0,4).map(a=>a.record.code),[capture.code,capture.code,other.code,capture.code]);
  await assert.rejects(saveAttempt(capture,{eventId,note:'同一事件ID不能改备注'}),/其他版本或内容/);
  // Existing journals receive the same merged view without deleting or rewriting their receipt IDs.
  await updateProblem(url,p=>{for(const a of p.attempts){delete a.contentKey;delete a.resultFingerprint;if(a.number<=4)delete a.title;}});
  const legacy=await problemSummary(url);
  assert.deepEqual(legacy.attempts[0].numbers,[1,2,4]);assert.equal((await getProblem(url)).attempts.length,9);
}));

test('identical platform submissions merge but different verdicts or runtime evidence split and AC keeps its receipt',()=>isolated(async()=>{
  const first=randomUUID(),second=randomUUID();
  await saveAttempt(capture,{kind:'submission',eventId:first,submissionId:first});
  await saveAttempt(capture,{kind:'submission',eventId:second,submissionId:second});
  let p=await problemSummary(url);assert.equal(p.attempts.length,1);
  assert.deepEqual(p.attempts[0].occurrences.map(a=>a.submissionId),[first,second]);
  const wa={...ac,status:'WA',text:'Wrong Answer'};
  await recordVerdict(url,first,wa,{output:'wrong'});
  await recordVerdict(url,second,{...wa,observedAt:new Date(Date.now()+1000).toISOString(),identity:'other-receipt'},{output:'wrong'});
  assert.equal((await problemSummary(url)).attempts.length,1);
  await recordVerdict(url,second,ac,{output:'correct'});
  p=await problemSummary(url);assert.equal(p.attempts.length,2);
  const finished=await saveAttempt(capture,{kind:'ac',submissionId:second,verdict:ac});
  const raw=await getProblem(url);assert.equal(raw.finalizations[0].submissionId,second);assert.equal(raw.finalizations[0].id,finished.finalizationId);
  const t=await timeline(url);assert.equal(t.attempts.find(a=>a.submissionId===first).runtime.output,'wrong');
}));

test('final retrospective merges repeated content and also supplies chronological code transitions',()=>isolated(async root=>{
  const first=await saveAttempt(capture);await saveAttempt(capture);
  const b=await saveAttempt({...capture,code:'int main(){return 1;}'});await saveAttempt(capture);
  const id=randomUUID();await saveAttempt(capture,{kind:'submission',eventId:id,submissionId:id});
  await recordVerdict(url,id,ac);await saveAttempt(capture,{kind:'ac',submissionId:id,verdict:ac});
  await processReview(first.id,options);await processReview(b.id,options);
  let seen;await processArchives({archiveRoot:path.join(root,'archives'),model:async data=>{seen=data;return report;}});
  assert.equal(seen.debugHistory.totalAttempts,6);assert.equal(seen.debugHistory.mergedAttemptCount,4);
  assert.deepEqual(seen.debugHistory.attempts[0].numbers,[1,2,4]);
  assert.deepEqual(seen.debugHistory.transitions.map(a=>[a.from,a.to]),[[2,3],[3,4]]);
  const final=(await getProblem(url)).finalizations[0];
  assert.match(await fs.readFile(path.join(final.localDirectory,'DEBUG.md'),'utf8'),/相同内容合并 3 次/);
}));
test('AC requires a matching saved submission, never an unrelated current editor or stdout AC',()=>isolated(async()=>{
  const id=randomUUID();await saveAttempt(capture,{kind:'submission',eventId:id,submissionId:id});
  await assert.rejects(saveAttempt({...capture,code:'int main(){return 8;}'},{kind:'ac',submissionId:id,verdict:ac}),/匹配/);
  await assert.rejects(saveAttempt(capture,{kind:'ac',submissionId:id,verdict:{...ac,source:'stdout'}}),/匹配/);
  assert.equal((await getProblem(url)).finalizations.length,0);
  await recordVerdict(url,id,ac,{output:'actual result',hints:'judge completed'});
  const finished=await saveAttempt(capture,{kind:'ac',submissionId:id,verdict:ac});
  await saveAttempt(capture,{kind:'ac',submissionId:id,verdict:ac});
  const t=await timeline(url);assert.equal(t.finalizations.length,1);assert.equal(t.attempts.at(-1).runtime.hints,'judge completed');assert.equal(finished.finalizationId,t.finalizations[0].id);
}));
test('a stalled final README does not block drafts; final bundle is frozen at AC and contains no draft source files',()=>isolated(async root=>{
  const first=await saveAttempt({...capture,code:'int main(){return 10;}'},{note:'初稿还未修复'});await processReview(first.id,options);
  const id=randomUUID(),submitted=await saveAttempt(capture,{kind:'submission',eventId:id,submissionId:id});
  await processReview(submitted.id,options);await recordVerdict(url,id,ac,{output:'0'});
  const finished=await saveAttempt(capture,{kind:'ac',submissionId:id,verdict:ac});
  let release,started;const gate=new Promise(r=>{release=r;}),ready=new Promise(r=>{started=r;});let seen;
  const running=processArchives({archiveRoot:path.join(root,'archives'),model:async e=>{seen=e;started();await gate;return report;}});
  await ready;
  const next=await saveAttempt({...capture,code:'int main(){return 99;}'},{note:'AC 后另试一种写法'});
  assert.equal(next.status,'queued');assert.equal((await getProblem(url)).finalizations[0].status,'building');
  release();await running;
  const f=(await getProblem(url)).finalizations[0];assert.equal(f.status,'complete');assert.equal(f.id,finished.finalizationId);
  assert.deepEqual((await fs.readdir(f.localDirectory)).sort(),['.pku-coach.json','DEBUG.md','README.md','solution.cpp']);
  assert.equal((await fs.readFile(path.join(f.localDirectory,'solution.cpp'),'utf8')).trim(),capture.code);
  assert.equal(seen.debugHistory.totalAttempts,3);assert.equal(seen.capture.code,capture.code);
  assert.doesNotMatch(await fs.readFile(path.join(f.localDirectory,'DEBUG.md'),'utf8'),/return 10|return 99/);
  assert.equal(f.repository,undefined);assert.equal(f.githubUrl,undefined);
  assert.equal((await readBundle(f.localDirectory)).files.length,4);
  await fs.appendFile(path.join(f.localDirectory,'solution.cpp'),'changed');await assert.rejects(readBundle(f.localDirectory),/改变/);
}));
test('archive model failure preserves all local attempts and retry reuses the same finalization',()=>isolated(async root=>{
  const id=randomUUID(),saved=await saveAttempt(capture,{kind:'submission',eventId:id,submissionId:id});await processReview(saved.id,options);
  const f=await saveAttempt(capture,{kind:'ac',submissionId:id,verdict:ac});
  const archiveRoot=path.join(root,'archives');await processArchives({archiveRoot,model:async()=>{throw new Error('模拟失败');}});
  assert.equal((await getProblem(url)).finalizations[0].status,'failed');assert.equal((await readReview(saved.id)).code,capture.code);
  await saveAttempt({...capture,code:'int main(){return 12;}'});await retryArchive(url,f.finalizationId);
  let calls=0;await processArchives({archiveRoot,model:async()=>{calls++;return report;}});assert.equal(calls,1);
  await retryArchive(url,f.finalizationId);await processArchives({archiveRoot,model:async()=>{throw new Error('不得重复生成');}});
  assert.equal((await getProblem(url)).finalizations[0].status,'complete');
}));
