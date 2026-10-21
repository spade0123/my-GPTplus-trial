import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {JSDOM} from 'jsdom';
import {gridJudgeRequest} from '../extension/grid-submit.js';
import {createVscodeService} from '../src/vscode-service.js';

const url='https://programming.pku.edu.cn/probset/'+ 'a'.repeat(32)+'/'+ 'b'.repeat(32)+'/ide.do';
const code='int main(){return 0;}';
const response=(url,value,html=false)=>({ok:true,url,headers:new Headers({'content-type':html?'text/html':'application/json'}),text:async()=>html?value:JSON.stringify(value)});

test('Grid detail page replaces pending API status and preserves case feedback',async()=>{
  const dom=new JSDOM('',{url,runScripts:'outside-only'}),w=dom.window;
  const hint='Case  0 :  Time:  6 ms,  Memory:  356 kB,  Diff: 0\n';
  w.AbortSignal=AbortSignal;
  w.fetch=async target=>target.endsWith('status.do')
    ?response(target,{status:'OK',type:'solution',solution:{id:42,result:'Processing',hint:''}})
    :response(target,'<h1>Accepted</h1><h2>提示信息</h2><pre>'+hint+'</pre>',true);
  try{
    const result=await w.eval(`(${gridJudgeRequest.toString()})`)(url,'refresh',{receipt:{solutionId:'42'},code});
    assert.equal(result.submission.verdict.status,'AC');
    assert.equal(result.submission.runtime.text,hint);
    assert.equal(result.submission.detailLoaded,true);
    assert.match(result.submission.websiteReplyRaw,/Processing/);
  }finally{w.close();}
});

test('Chrome worker returns website rejection raw even when no receipt exists',async()=>{
  let clicked,receive;const sent=[];
  const port={postMessage:value=>sent.push(value),onDisconnect:{addListener(){}},onMessage:{addListener:fn=>receive=fn}};
  const chrome={
    tabs:{query:async()=>[{id:7,url}],get:async()=>({id:7,url}),onUpdated:{addListener(){}},onActivated:{addListener(){}}},
    scripting:{executeScript:async request=>[{result:request.func.name==='gridJudgeRequest'?{error:'本题暂未开放',websiteReplyRaw:'{"status":"ERROR","text":"本题暂未开放"}'}:true}]},
    runtime:{connectNative:()=>port,onStartup:{addListener(){}},onInstalled:{addListener(){}}},
    action:{onClicked:{addListener:fn=>clicked=fn},setBadgeText:async()=>{}}
  };
  const script=(await fs.readFile(new URL('../extension/grid-worker.js',import.meta.url),'utf8')).replace(/^import .*;\r?\n/gm,'');
  vm.runInNewContext(script,{chrome,URL,setTimeout,clearTimeout,extractPage(){},readCurrentJudgment(){},gridJudgeRequest(){}});
  clicked();
  await receive({type:'browser_request',id:'fixture-request',action:'test',params:{problemUrl:url,jobId:'c'.repeat(64),code,input:'',language:'C++'}});
  const reply=sent.find(value=>value.type==='browser_reply');
  assert.equal(reply.error,undefined);
  assert.equal(reply.value.error,'本题暂未开放');
  assert.match(reply.value.websiteReplyRaw,/本题暂未开放/);
  assert(sent.some(value=>value.type==='browser_progress'&&value.stage==='网站接口已返回'));
});

test('finished Grid detail feedback does not wait for a stalled status endpoint',async()=>{
  const dom=new JSDOM('',{url,runScripts:'outside-only'}),w=dom.window;let timer;
  w.AbortSignal=AbortSignal;
  w.fetch=async target=>target.endsWith('status.do')?new Promise(()=>{}):response(target,'<h1>Accepted</h1><h2>提示信息</h2><pre>Case 0: Diff: 0</pre>',true);
  try{
    const result=await Promise.race([
      w.eval(`(${gridJudgeRequest.toString()})`)(url,'refresh',{receipt:{solutionId:'42'},code}),
      new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('detail reply was blocked by status endpoint')),1000);})
    ]);
    assert.equal(result.submission.verdict.status,'AC');
    assert.equal(result.submission.runtime.text,'Case 0: Diff: 0');
  }finally{clearTimeout(timer);w.close();}
});

test('Grid test keeps querying a pending detail page until the final website reply',async()=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'grid-feedback-')),prior=process.env.PKU_DATA_DIR;
  process.env.PKU_DATA_DIR=directory;let refreshes=0;
  const problem={description:'这是用于核对编程网格回传流程的自拟题目，输出一个整数。',input:'无',output:'一个整数',sampleInput:'',sampleOutput:'0'};
  const submission=status=>({receipt:{solutionId:'42'},submission:{submissionId:'42',platformResult:status==='pending'?'Processing':'Passed',verdict:{status},detailLoaded:true,detailChecked:true,runtime:{text:status==='pending'?'':'Case 0: Diff: 0'}}});
  const service=createVscodeService({currentProblem:async()=>({connected:false}),browser:async action=>{
    if(action==='capture')return {problem:{problemMatches:true,problemUrl:url,title:'自拟题目',problem}};
    if(action==='refresh_test'){refreshes++;return submission('AC');}
    return submission('pending');
  }});
  const source={uri:'file:///C:/fixture/grid.cpp',name:'grid.cpp',code,version:1};
  const until=async predicate=>{for(let i=0;i<100;i++){const value=await predicate();if(value)return value;await new Promise(resolve=>setTimeout(resolve,20));}throw new Error('local result timeout');};
  try{
    await service.handle({type:'context_bind',uri:source.uri,binding:{problemUrl:url,tabId:7}});
    const queued=await service.handle({type:'grid_test',source,input:'',actionId:randomUUID()});
    await until(async()=>{const result=await service.handle({type:'grid_test_status',id:queued.id});return result.status==='pending'&&result;});
    const result=await service.handle({type:'grid_test_refresh',id:queued.id});
    assert.equal(refreshes,1);
    assert.equal(result.submission.verdict.status,'AC');
    assert.equal(result.submission.runtime.text,'Case 0: Diff: 0');
    await until(async()=>(await service.handle({type:'grid_test_status',id:queued.id})).status==='complete');
  }finally{
    if(prior===undefined)delete process.env.PKU_DATA_DIR;else process.env.PKU_DATA_DIR=prior;
    await fs.rm(directory,{recursive:true,force:true,maxRetries:5,retryDelay:50});
  }
});
