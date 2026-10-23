import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {JSDOM} from 'jsdom';
import {createVscodeService} from '../src/vscode-service.js';
import {problemId} from '../src/problem-history.js';

test('statement AC status requires a matched official submission, keeps historical AC after editing and performs no browser/model action',async()=>{
 const folder=await fs.mkdtemp(path.join(os.tmpdir(),'oj-completion-')),previous=process.env.PKU_DATA_DIR;process.env.PKU_DATA_DIR=folder;
 try{const url='http://bailian.openjudge.cn/practice/1001/',hash='a'.repeat(64),verdict={source:'judge-dom',status:'AC',sourceUrl:'http://bailian.openjudge.cn/practice/solution/123/'},submit={id:'submission',kind:'submission',submissionId:'test',codeHash:hash,verdict},ac={id:'ac',kind:'ac',submissionId:'test',codeHash:hash,verdict},service=createVscodeService({browser:async()=>{throw new Error('Browser must not be used');},launchReport:async()=>{throw new Error('Model must not be used');}});
  await fs.mkdir(path.join(folder,'problems'));const write=attempts=>fs.writeFile(path.join(folder,'problems',problemId(url)+'.json'),JSON.stringify({id:problemId(url),url,attempts,finalizations:[]}));
  for(const attempts of [[],[ac],[submit,{...ac,codeHash:'b'.repeat(64)}],[{...submit,verdict:{status:'AC'}},ac]]){await write(attempts);assert.equal((await service.handle({type:'problem_completion',url})).accepted,false);}
  await write([submit,ac]);let result=await service.handle({type:'problem_completion',url});assert.equal(result.accepted,true);assert.equal(result.verified,true);assert.equal(result.latestSavedVersionAccepted,true);
  await write([submit,ac,{id:'new',kind:'draft',codeHash:'b'.repeat(64)}]);result=await service.handle({type:'problem_completion',url});assert.equal(result.accepted,true);assert.equal(result.latestSavedVersionAccepted,false);assert.equal((await service.handle({type:'problem_completion',url:url.replace('/1001/','/1002/')})).accepted,false);await assert.rejects(service.handle({type:'problem_completion',url:'https://evil.test/'}),/地址无效/);
 }finally{if(previous===undefined)delete process.env.PKU_DATA_DIR;else process.env.PKU_DATA_DIR=previous;await fs.rm(folder,{recursive:true,force:true});}
});

test('AC badge sits in the statement, clears on a new problem and ignores delayed status from the previous problem',async()=>{
 const dom=new JSDOM('<h1 id="title"></h1><div id="completion" hidden><strong id="completionBadge"></strong><span id="completionNote"></span></div><p id="state"></p><button id="openProblem"></button><main id="sections"></main>',{url:'https://owned.test',runScripts:'outside-only'}),w=dom.window,url='http://bailian.openjudge.cn/practice/1001/',other=url.replace('/1001/','/1002/'),emit=m=>w.dispatchEvent(new w.MessageEvent('message',{data:m}));
 try{w.acquireVsCodeApi=()=>({postMessage(){}});w.PkuReportRenderer={render:(e,text)=>e.textContent=text};for(const name of ['getItem','setItem','removeItem','clear'])w.Storage.prototype[name]=()=>{throw new Error('Browser storage forbidden');};w.eval(await fs.readFile(new URL('../vscode-extension/problem-view.js',import.meta.url),'utf8'));
  const show=url=>emit({type:'problem_display',url,status:'ready',connected:true,page:{title:'Original title',problem:{}}});show(url);emit({type:'problem_completion',problemUrl:url,accepted:true,verified:true,latestSavedVersionAccepted:true});assert.equal(w.document.getElementById('completion').hidden,false);assert.match(w.document.getElementById('completionBadge').textContent,/已 AC/);
  emit({type:'problem_completion',problemUrl:url,accepted:true,verified:true,latestSavedVersionAccepted:false});assert.match(w.document.getElementById('completionNote').textContent,/历史版本/);show(other);assert.equal(w.document.getElementById('completion').hidden,true);emit({type:'problem_completion',problemUrl:url,accepted:true,verified:true});assert.equal(w.document.getElementById('completion').hidden,true);emit({type:'problem_completion',problemUrl:other,accepted:false});assert.equal(w.document.getElementById('completionBadge').textContent,'暂无 AC 记录');assert.equal(w.document.getElementById('title').textContent,'Original title');
 }finally{w.close();}
});
