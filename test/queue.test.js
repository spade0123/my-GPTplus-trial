import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {saveCapture,readReview,writeRecord} from '../src/browser-review.js';
import {drainQueue,retryReview} from '../src/review-queue.js';
const capture={url:'https://programming.pku.edu.cn/probset/d0ef3e0f7fa5481d896f9a07254c8ecd/f6b942b2dcd74656880a088f85f56c3f/ide.do',title:'队列测试题',statement:'输入两个整数，输出它们的和，取值范围为零到一百。',code:'int main(){return 0;}',standard:'c++17'};
const report={markdown:'测试报告：这是隔离目录中的模拟模型输出，不是用户真实作业的结论。',topics:['testing'],evidence:'测试证据',next_step:'测试练习'};
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function until(predicate){for(let i=0;i<500;i++){if(await predicate())return;await pause(20);}throw new Error('等待后台测试超时');}
test('saving another version never waits for a stalled report, queue runs one model at a time',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pku-queue-'));process.env.PKU_DATA_DIR=dir;
  let release,started;const gate=new Promise(r=>{release=r;}),ready=new Promise(r=>{started=r;});let calls=0,active=0,maxActive=0;
  try{
    const first=await saveCapture(capture);assert.equal(first.status,'queued');
    const running=drainQueue({compile:async()=>({}),model:async()=>{calls++;active++;maxActive=Math.max(active,maxActive);if(calls===1){started();await gate;}active--;return report;}});
    await ready;
    const second=await saveCapture({...capture,code:'int main(){return 1;}'});
    assert.equal(second.status,'queued');assert.equal(calls,1);assert.equal((await readReview(first.id)).status,'running');
    assert.equal((await drainQueue()).busy,true);
    release();await running;
    assert.equal((await readReview(first.id)).status,'complete');assert.equal((await readReview(second.id)).status,'complete');assert.equal(maxActive,1);assert.equal(calls,2);
    assert.equal((await saveCapture(capture)).cached,true);
  }finally{release?.();delete process.env.PKU_DATA_DIR;await fs.rm(dir,{recursive:true,force:true});}
});
test('failed report keeps its sources, does not block the next job, and can be retried',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pku-queue-fail-'));process.env.PKU_DATA_DIR=dir;
  try{
    const first=await saveCapture(capture),second=await saveCapture({...capture,code:'int main(){return 2;}'});let calls=0;
    await drainQueue({compile:async()=>({}),model:async()=>{if(++calls===1)throw new Error('模拟额度错误');return report;}});
    const failed=await readReview(first.id);assert.equal(failed.status,'failed');assert.equal(failed.code,capture.code);
    assert.equal((await readReview(second.id)).status,'complete');
    assert.equal((await retryReview(first.id)).status,'queued');
    await drainQueue({compile:async()=>({}),model:async()=>report});assert.equal((await readReview(first.id)).status,'complete');
  }finally{delete process.env.PKU_DATA_DIR;await fs.rm(dir,{recursive:true,force:true});}
});
test('dead worker and per-job locks are recovered on the next queue run',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pku-queue-recover-'));process.env.PKU_DATA_DIR=dir;
  try{
    const saved=await saveCapture(capture),deadPid=2147483000;
    await writeRecord(path.join(dir,`${saved.id}.json`),{...saved,status:'running',workerPid:deadPid});
    await fs.writeFile(path.join(dir,'queue-worker.lock'),JSON.stringify({pid:deadPid}));
    await fs.writeFile(path.join(dir,`${saved.id}.json.lock`),JSON.stringify({pid:deadPid}));
    await drainQueue({compile:async()=>({}),model:async()=>report});assert.equal((await readReview(saved.id)).status,'complete');
  }finally{delete process.env.PKU_DATA_DIR;await fs.rm(dir,{recursive:true,force:true});}
});
test('detached worker finishes queued reports after its save client has exited',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pku-detached-'));process.env.PKU_DATA_DIR=dir;
  try{
    const input=path.join(dir,'test-input.json');await fs.writeFile(input,JSON.stringify(capture));
    const client=fileURLToPath(new URL('./fixtures/save-client.js',import.meta.url));
    const firstId=await new Promise((resolve,reject)=>{
      const child=spawn(process.execPath,[client,input],{env:{...process.env},windowsHide:true});let text='',err='';
      child.stdout.on('data',b=>text+=b);child.stderr.on('data',b=>err+=b);child.on('error',reject);child.on('close',code=>code===0?resolve(text.trim()):reject(new Error(err)));
    });
    await until(()=>fs.access(path.join(dir,'model-started')).then(()=>true).catch(()=>false));
    const second=await saveCapture({...capture,code:'int main(){return 3;}'});
    assert.equal((await readReview(firstId)).status,'running');assert.equal(second.status,'queued');
    await fs.writeFile(path.join(dir,'release-model'),'yes');
    await until(async()=> (await readReview(firstId)).status==='complete'&&(await readReview(second.id)).status==='complete');
    await until(()=>fs.access(path.join(dir,'queue-worker.lock')).then(()=>false).catch(()=>true));
  }finally{await fs.writeFile(path.join(dir,'release-model'),'yes').catch(()=>{});delete process.env.PKU_DATA_DIR;await fs.rm(dir,{recursive:true,force:true});}
});
