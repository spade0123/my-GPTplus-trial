import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {frame,decoder} from '../src/native-protocol.js';
import {Capture,reviewCapture,reviewHistory,fingerprint} from '../src/browser-review.js';
const capture={url:'https://programming.pku.edu.cn/probset/d0ef3e0f7fa5481d896f9a07254c8ecd/f6b942b2dcd74656880a088f85f56c3f/ide.do',title:'测试题',statement:'输入两个整数，输出它们的和。输入范围为零到一百。',code:'int main(){return 0;}',standard:'c++17'};
const report={markdown:'这是模拟报告，仅用于测试保存行为，并非模型分析结论。',topics:['testing'],evidence:'测试证据',next_step:'测试练习'};
test('Native Messaging UTF-8 fragmented/coalesced packets and input size limit',()=>{
  const values=[],errors=[];const read=decoder(v=>values.push(v),e=>errors.push(e));
  const first=frame({text:'中文\n测试'}),both=Buffer.concat([first,frame({type:'status'})]);
  read(both.subarray(0,2));read(both.subarray(2,9));read(both.subarray(9));
  assert.deepEqual(values,[{text:'中文\n测试'},{type:'status'}]);assert.equal(errors.length,0);
  const huge=Buffer.alloc(4);huge.writeUInt32LE(300001);read(huge);assert.equal(errors.length,1);
});
test('capture schema rejects other sites and strips no unknown data silently',()=>{
  assert.throws(()=>Capture.parse({...capture,url:'https://evil.example/ide.do'}));
  assert.throws(()=>Capture.parse({...capture,command:'anything'}));
  assert.throws(()=>Capture.parse({...capture,statement:''}));
  assert.notEqual(fingerprint(capture),fingerprint({...capture,code:'int main(){return 1;}'}));
  assert.notEqual(fingerprint(capture),fingerprint({...capture,runtime:{output:'new actual output'}}));
});
test('structured problem and runtime have separate storage and preserve sample whitespace',async()=>{
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'pku-sections-'));process.env.PKU_DATA_DIR=temp;
  const problem={description:'读取字符串并保留空格，用于验证多行样例保存。',input:'输入一行字符串',output:'原样输出',sampleInput:'  a b\n\n',sampleOutput:'  a b\n\n'};
  const runtime={input:'real input',output:'actual output',hints:'compiler hint',error:'',status:'退出码 0',text:'运行界面内容'};
  try {
    const input={url:capture.url,title:capture.title,problem,runtime,code:capture.code,standard:capture.standard};let received;
    const saved=await reviewCapture(input,{compile:async()=>({}),model:async evidence=>{received=evidence;return report;}});
    assert.equal(saved.problem.sampleInput,problem.sampleInput);assert.match(saved.statement,/关于输入/);assert.doesNotMatch(saved.statement,/actual output/);
    assert.equal(received.capture.runtime.output,'actual output');
    const disk=JSON.parse(await fs.readFile(path.join(temp,`${saved.id}.json`),'utf8'));
    assert.equal(disk.runtime,undefined);assert.equal(disk.runtimeFile,`run-snapshots/${saved.id}.json`);
    const run=JSON.parse(await fs.readFile(path.join(temp,disk.runtimeFile),'utf8'));
    assert.equal(run.input,'real input');assert.equal(run.output,'actual output');assert.equal(run.hints,'compiler hint');assert.equal(run.reviewId,saved.id);assert.equal(run.codeHash,saved.codeHash);
    const history=await reviewHistory({includeSource:true});assert.equal(history.records[0].runtime.output,'actual output');
    assert.equal((await reviewHistory()).records[0].problem,undefined);
  }finally{delete process.env.PKU_DATA_DIR;await fs.rm(temp,{recursive:true,force:true});}
});
test('browser reviews persist sources, deduplicate, recover failed jobs and filter history',async()=>{
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'pku-browser-test-'));process.env.PKU_DATA_DIR=temp;
  const compile=async()=>({status:'passed',ranProgram:false});let calls=0;
  const model=async()=>{calls++;return report;};
  try {
    const first=await reviewCapture(capture,{model,compile});
    assert.equal(first.status,'complete');assert.equal(first.code,capture.code);assert.equal(first.cached,false);
    assert.equal((await reviewCapture(capture,{model,compile})).cached,true);assert.equal(calls,1);
    const changed={...capture,code:'int main(){return 1;}'};
    await assert.rejects(reviewCapture(changed,{compile,model:async()=>{throw new Error('模拟网络失败');}}),/模拟网络失败/);
    let history=await reviewHistory();assert.equal(history.total,2);assert.ok(history.records.some(r=>r.status==='failed'));assert.equal(history.records[0].code,undefined);
    await reviewCapture(changed,{model,compile});assert.equal(calls,2);
    assert.equal((await reviewHistory({since:'2099-01-01T00:00:00+08:00'})).total,0);
    history=await reviewHistory({includeSource:true});assert.ok(history.records.every(r=>r.code));
    assert.equal((await fs.readdir(temp)).filter(n=>n.endsWith('.lock')).length,0);
  }finally{delete process.env.PKU_DATA_DIR;await fs.rm(temp,{recursive:true,force:true});}
});
test('concurrent identical review does not invoke the model twice',async()=>{
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'pku-browser-race-'));process.env.PKU_DATA_DIR=temp;
  let release,started;const gate=new Promise(r=>{release=r;});const ready=new Promise(r=>{started=r;});
  try {
    const pending=reviewCapture(capture,{compile:async()=>({}),model:async()=>{started();await gate;return report;}});
    await ready;
    await assert.rejects(reviewCapture(capture,{model:async()=>report,compile:async()=>({})}),/正在分析/);
    release();await pending;
  }finally{delete process.env.PKU_DATA_DIR;await fs.rm(temp,{recursive:true,force:true});}
});
