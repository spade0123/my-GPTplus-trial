import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {JSDOM} from 'jsdom';
import {readModelSettings,readModelCatalog,saveModelSettings} from '../src/model-settings.js';
import {DiscussionStream} from '../src/discussion-stream.js';
import {saveAttempt,getProblem} from '../src/problem-history.js';
import {queueHint,readHint,processHint,drainHints,queueDiscussion} from '../src/hint-review.js';
import {listVersions,readVersion} from '../src/version-history.js';
import {createVscodeService} from '../src/vscode-service.js';
import {outputDifference} from '../src/output-diff.js';
import {runSample,finishSample,saveSampleRequest,latestSample} from '../src/sample-runner.js';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{toolsHtml}=require('../vscode-extension/tools-view.cjs');
const url='http://bailian.openjudge.cn/practice/1004/',code='#include <iostream>\nusing namespace std;\nint main(){int a,b;cin>>a>>b;cout<<a+b;}';
const capture={url,title:'自拟求和',code,standard:'c++17',problem:{description:'输入两个整数并求和。',input:'两个整数',output:'和',sampleInput:'1 2',sampleOutput:'3'},runtime:{}};
const source={uri:'file:///C:/fixture/reused.cpp',name:'reused.cpp',code,version:7,selectedCode:'',diagnostics:''};
const catalog={models:[{model:'gpt-6.1-sol',name:'GPT-6.1 Sol',efforts:[{effort:'low'},{effort:'high'},{effort:'xhigh'}],defaultEffort:'high'},{model:'fixture-model',name:'Fixture',efforts:[{effort:'medium'}],defaultEffort:'medium'}],fetchedAt:new Date().toISOString(),source:'fixture'};
async function isolated(fn){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'oj-improvements-')),prior=process.env.PKU_DATA_DIR;process.env.PKU_DATA_DIR=dir;try{await fn(dir);}finally{if(prior===undefined)delete process.env.PKU_DATA_DIR;else process.env.PKU_DATA_DIR=prior;await fs.rm(dir,{recursive:true,force:true});}}
const markdown='## 解题方向\n输入后求和输出。\n\n## 对照你的代码\n已实现求和。\n\n## 下一步\n检查输入终止。\n\n## 手算验证\n1+2=3，未运行。';
const hintOptions={compile:async()=>({status:'passed'}),model:async()=>({markdown})};

test('model choices are validated against discovered capabilities, stored locally, and cached catalog failures stay explicit',()=>isolated(async()=>{
  const original=await readModelSettings();assert.equal(original.interactive.effort,'high');assert.equal(original.report.effort,'xhigh');
  const saved=await saveModelSettings({...original,interactive:{model:'fixture-model',effort:'medium'}},{catalog});
  assert.equal((await readModelSettings()).interactive.model,'fixture-model');
  await assert.rejects(saveModelSettings({...saved,interactive:{model:'fixture-model',effort:'high'}},{catalog}),/模型清单/);assert.equal((await readModelSettings()).interactive.effort,'medium');
  await readModelCatalog({query:async()=>catalog});const stale=await readModelCatalog({refresh:true,query:async()=>{throw new Error('模拟离线');}});assert.match(stale.warning,/模拟离线/);assert.equal(stale.models.length,2);
}));

test('a model switch on a warmed connection sends the selected model and effort on a fresh read-only thread',async()=>{
  const fixture=fileURLToPath(new URL('./fixtures/chat-server.mjs',import.meta.url));
  const stream=new DiscussionStream({resolveCommand:async()=>process.execPath,spawnProcess:(_command,_args,spec)=>spawn(process.execPath,[fixture],spec)});
  try{await stream.warm({model:'gpt-6.1-sol',effort:'high'});const result=await stream.run({question:'configuration',capture,modelConfig:{model:'fixture-model',effort:'medium'}});assert.deepEqual(JSON.parse(result.answer),{model:'fixture-model',effort:'medium',threadId:'t2'});assert.equal(stream.active.size,0);}
  finally{await stream.close();}
});

test('changing model configuration and forcing regeneration create separate hint jobs without rewriting old replies',()=>isolated(async dir=>{
  const saved=await saveAttempt(capture,{origin:'hint_request'}),first=await queueHint(saved.id,{eventId:saved.eventId});await processHint(first.id,hintOptions);
  const original=await readHint(first.id);assert.equal(original.modelConfig.effort,'high');
  await saveModelSettings({interactive:{model:'gpt-6.1-sol',effort:'low'},report:{model:'gpt-6.1-sol',effort:'xhigh'}},{catalog});
  const next=await queueHint(saved.id);assert.notEqual(next.id,first.id);assert.equal(next.modelConfig.effort,'low');assert.equal((await readHint(first.id)).analysis,original.analysis);
  const evidence=[];await processHint(next.id,{...hintOptions,model:async e=>{evidence.push(e.modelConfig);return {markdown};}});assert.equal(evidence[0].effort,'low');
  assert.equal((await queueHint(saved.id)).id,next.id);const forced=await queueHint(saved.id,{force:true});assert.notEqual(forced.id,next.id);assert.equal(forced.snapshotId,saved.id);
  const legacy={...original};delete legacy.modelConfig;await fs.writeFile(path.join(dir,'hints',first.id+'.json'),JSON.stringify(legacy));
  await saveModelSettings({interactive:{model:'gpt-6.1-sol',effort:'high'},report:{model:'gpt-6.1-sol',effort:'xhigh'}},{catalog});assert.notEqual((await queueHint(saved.id)).id,first.id);assert.equal((await readHint(first.id)).modelConfig,undefined);
}));

test('only queued obsolete hints are superseded, newer guidance runs first, and saved snapshots and explicit discussions remain',()=>isolated(async()=>{
  const a=await saveAttempt(capture,{origin:'hint_request'}),old=await queueHint(a.id,{eventId:a.eventId});
  await new Promise(r=>setTimeout(r,5));const b=await saveAttempt({...capture,code:code+'\n'},{origin:'hint_request'});
  const changed=await saveAttempt({...capture,code:code.replace('a+b','a-b')},{origin:'hint_request'}),latest=await queueHint(changed.id,{eventId:changed.eventId});
  const chat=await queueDiscussion(a.id,{question:'为什么？'}),calls=[];
  await drainHints({kind:'hint',...hintOptions,model:async e=>{calls.push(e.capture.code);return {markdown};}});
  assert.deepEqual(calls,[code.replace('a+b','a-b')]);assert.equal((await readHint(old.id)).status,'superseded');assert.equal((await readHint(latest.id)).status,'complete');assert.equal((await readHint(chat.id)).status,'queued');
  assert.equal((await getProblem(url)).attempts.length,3);assert(b.id);
}));

test('version history preserves A to B to A, verifies full snapshots, and compares against a frozen current buffer',()=>isolated(async dir=>{
  const a=await saveAttempt(capture),a2=await saveAttempt(capture),b=await saveAttempt({...capture,code:code.replace('a+b','a-b')}),again=await saveAttempt(capture);
  const list=await listVersions(url);assert.equal(list.totalEvents,4);assert.equal(list.uniqueVersions,2);assert.equal(list.versions.length,3);assert.equal(list.versions.at(-1).occurrenceCount,2);
  const version=await readVersion(url,a.eventId,'int main(){}');assert.equal(version.code,code);assert.match(version.diff,/saved-version.cpp/);assert.equal(version.sameCode,false);
  await assert.rejects(readVersion(url,randomUUID()),/没有这个历史版本/);
  const file=path.join(dir,b.id+'.json'),record=JSON.parse(await fs.readFile(file));record.code='int main(){return 99;}';await fs.writeFile(file,JSON.stringify(record));await assert.rejects(readVersion(url,b.eventId,''),/校验失败/);assert(a2.id&&again.id);
}));

test('custom tests keep original problem samples separate, save before execution failure and never label unchecked output as correct',()=>isolated(async()=>{
  let options,shouldFail=false;
  const service=createVscodeService({currentProblem:async()=>({connected:false}),browser:async()=>({problem:{problemMatches:true,problemUrl:url,title:capture.title,problem:capture.problem}}),sampleRunner:async(_capture,spec)=>{options=spec;if(shouldFail)throw new Error('模拟运行器失败');return {status:'executed',testKind:'custom',expectedProvided:false,input:spec.input,expected:'',actual:'15',compiler:'',stderr:'',durationMs:1};}});
  await service.handle({type:'context_bind',uri:source.uri,binding:{problemUrl:url,tabId:1}});
  const result=await service.handle({type:'run_sample',source,problemUrl:url,actionId:randomUUID(),testSpec:{input:'7 8',runTimeout:400,memoryLimitMiB:64}});
  assert.equal(options.expected,null);assert.equal(options.testKind,'custom');assert.equal(result.result.status,'executed');assert.equal(result.snapshot.documentVersion,7);assert.equal(await latestSample(url,code),null);
  const history=await getProblem(url),snapshot=await readVersion(url,history.attempts[0].id,code);assert.equal(snapshot.code,code);
  const count=history.attempts.length;shouldFail=true;await assert.rejects(service.handle({type:'run_sample',source,problemUrl:url,actionId:randomUUID(),testSpec:{input:'2 2',expected:'4'}}),/模拟运行器失败/);assert.equal((await getProblem(url)).attempts.length,count+1);
  await assert.rejects(service.handle({type:'run_sample',source,problemUrl:url,actionId:randomUUID(),testSpec:{input:'',runTimeout:999999}}));assert.equal(capture.problem.sampleInput,'1 2');
}));

test('real custom execution uses chosen input, optional expected output and local limits without altering the original samples',async t=>{
  const config=await fs.readFile(new URL('../native/paths.json',import.meta.url),'utf8').then(JSON.parse).catch(()=>null);if(!config){t.skip('Configure the compiler first.');return;}
  const result=await runSample(capture,{compiler:config.compiler,input:'10 20',expected:null,testKind:'custom',runTimeout:500,memoryLimitMiB:64});assert.equal(result.actual,'30');assert.equal(result.status,'executed');assert.equal(result.expectedProvided,false);assert.equal(result.limits.timeMs,500);assert.equal(capture.problem.sampleInput,'1 2');
});

test('output differences count Unicode characters and expose spaces, tabs, line breaks and output endings',()=>{
  assert.equal(outputDifference('相同','相同'),null);const diff=outputDifference('中😀 x\n','中😀\tx\n');assert.equal(diff.column,3);assert.match(diff.actual,/␠/);assert.match(diff.expected,/⇥/);assert.match(outputDifference('a','ab').actual,/∎/);
});

test('custom test form distinguishes empty expected output from no expectation and never uses browser storage',async()=>{
  const dom=new JSDOM('<section id="samplePanel"></section>',{url:'https://coach.local/',runScripts:'outside-only'}),w=dom.window,messages=[];
  try{w.Storage.prototype.setItem=()=>{throw new Error('Storage forbidden');};w.chrome={runtime:{connect:()=>({postMessage:m=>messages.push(m),onMessage:{addListener(){}}})}};w.eval(await fs.readFile(new URL('../vscode-extension/test-controls.js',import.meta.url),'utf8'));const form=w.document.querySelector('form');form.elements.input.value=' 1 2\n';form.dispatchEvent(new w.Event('submit',{cancelable:true}));assert.equal(messages[0].testSpec.input,' 1 2\n');assert.equal(messages[0].testSpec.expected,undefined);form.elements.compare.checked=true;form.dispatchEvent(new w.Event('submit',{cancelable:true}));assert.equal(messages[1].testSpec.expected,'');}
  finally{w.close();}
});

test('version banners mark changed buffers and model pickers preserve advertised effort order',async()=>{
  const dom=new JSDOM('<header></header>',{url:'https://coach.local/',runScripts:'outside-only'}),w=dom.window;let receive;
  try{w.chrome={runtime:{connect:()=>({postMessage(){},onMessage:{addListener:f=>receive=f}})}};w.eval(await fs.readFile(new URL('../vscode-extension/context-controls.js',import.meta.url),'utf8'));receive({snapshot:{title:'题',problemUrl:url,sourceName:'main.cpp',documentVersion:2,codeHash:'a'.repeat(64),savedAt:new Date().toISOString()}});receive({type:'source_changed',version:3});assert.match(w.document.querySelector('.coach-snapshot-meta').textContent,/已修改/);assert.equal(w.document.querySelectorAll('.coach-utility-actions button').length,2);}
  finally{w.close();}
});

test('model selection renders only advertised efforts and saves both profiles through the plugin bridge',async()=>{
  const dom=new JSDOM(toolsHtml('models',{nonce:'x',cspSource:'https://coach.local',uri:s=>'https://coach.local/'+s}),{url:'https://coach.local/',runScripts:'outside-only'}),w=dom.window,messages=[];
  try{w.acquireVsCodeApi=()=>({postMessage:m=>messages.push(m)});w.Storage.prototype.setItem=()=>{throw new Error('Browser persistence forbidden');};w.eval(await fs.readFile(new URL('../vscode-extension/coach-tools.js',import.meta.url),'utf8'));assert.equal(messages[0].type,'model_settings_get');w.dispatchEvent(new w.MessageEvent('message',{data:{type:'model_settings',settings:{interactive:{model:'gpt-6.1-sol',effort:'high'},report:{model:'gpt-6.1-sol',effort:'xhigh'}},catalog}}));
    const select=w.document.getElementById('interactiveModel');select.value='fixture-model';select.dispatchEvent(new w.Event('change'));assert.deepEqual([...w.document.getElementById('interactiveEffort').options].map(x=>x.value),['medium']);
    w.document.getElementById('modelsForm').dispatchEvent(new w.Event('submit',{cancelable:true}));assert.equal(messages.at(-1).settings.interactive.model,'fixture-model');assert.equal(messages.at(-1).settings.interactive.effort,'medium');assert.equal(messages.at(-1).settings.report.effort,'xhigh');
  }finally{w.close();}
});

test('history preview ignores old selections, renders source safely and copies the exact saved code only after confirmation',async()=>{
  const dom=new JSDOM(toolsHtml('versions',{nonce:'x',cspSource:'https://coach.local',uri:s=>'https://coach.local/'+s}),{url:'https://coach.local/',runScripts:'outside-only'}),w=dom.window,messages=[];
  try{
    w.acquireVsCodeApi=()=>({postMessage:m=>messages.push(m)});
    for(const file of ['vendor/marked/marked.umd.js','report-renderer.js'])w.eval(await fs.readFile(new URL('../extension/'+file,import.meta.url),'utf8'));
    w.eval(await fs.readFile(new URL('../vscode-extension/coach-tools.js',import.meta.url),'utf8'));
    const emit=data=>w.dispatchEvent(new w.MessageEvent('message',{data}));emit({type:'versions_list',title:'测试题',totalEvents:2,uniqueVersions:2,versions:[{eventId:'new',firstNumber:2,lastNumber:2,savedAt:new Date().toISOString(),codeHash:'b'.repeat(64),occurrenceCount:1},{eventId:'old',firstNumber:1,lastNumber:1,savedAt:new Date().toISOString(),codeHash:'a'.repeat(64),occurrenceCount:1}]});
    const earlier=messages.at(-1).selection;w.document.getElementById('versions').value='old';w.document.getElementById('versions').dispatchEvent(new w.Event('change'));const latest=messages.at(-1).selection;
    const sourceCode='int main(){return 0;}\n// <img src=x onerror=alert(1)>\n';const entry={type:'version_read',title:'测试题',savedAt:new Date().toISOString(),codeHash:'a'.repeat(64),code:sourceCode,diff:'-a\n+b'};
    emit({...entry,selection:earlier,code:'过期'});assert.equal(w.document.getElementById('versionCode').textContent,'');emit({...entry,selection:latest});assert.equal(w.document.querySelectorAll('img').length,0);assert(w.document.querySelectorAll('.syntax-keyword').length>0);
    w.document.getElementById('copyVersion').click();const copy=messages.at(-1);assert.equal(copy.text,sourceCode);assert.equal(copy.type,'copy_code');emit({type:'copy_reply',id:copy.id});await new Promise(r=>setImmediate(r));assert.match(w.document.getElementById('toolsStatus').textContent,/已复制/);
  }finally{w.close();}
});
