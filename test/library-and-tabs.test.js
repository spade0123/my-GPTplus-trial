import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {JSDOM} from 'jsdom';
import {readProblemLibrary,libraryProblem} from '../src/problem-library.js';
import {createVscodeService} from '../src/vscode-service.js';
import {readSubmission} from '../src/oj-submissions.js';
import {navigateProblemTab,closeAcceptedSubmitTab,matchesSubmittedSource} from '../extension/openjudge-tabs.js';
const url='http://bailian.openjudge.cn/practice/1004/',code='#include <iostream>\nusing namespace std;\nint main(){cout<<3;}',jobId='a'.repeat(64);
function mockTabs({active=false,changed=false}={}){
  const records=new Map([[1,{id:1,url,active:!active}],[2,{id:2,url:url+'submit/',active}]]),calls=[];
  const api={tabs:{get:async id=>{if(!records.has(id))throw new Error('closed');return records.get(id);},query:async()=>[...records.values()],update:async(id,fields)=>{calls.push(['update',id,fields]);const value={...records.get(id),...fields};records.set(id,value);return value;},create:async fields=>{calls.push(['create',fields]);const value={...fields,id:9};records.set(9,value);return value;},remove:async id=>{calls.push(['remove',id]);records.delete(id);}},scripting:{executeScript:async()=>[{result:!changed}]}};
  return {api,calls,records};
}
test('curated library contains exactly 237 Bailian and 100 non-1.x NOI problems with stable distinct keys',async()=>{
  const {items}=await readProblemLibrary();assert.equal(items.length,337);assert.equal(items.filter(p=>p.platform==='百练').length,237);assert.equal(new Set(items.map(p=>p.key)).size,337);assert(items.filter(p=>p.platform==='NOI').every(p=>!p.url.includes('/ch01')));
  assert.equal((await libraryProblem('bailian:1064')).id,'1064');await assert.rejects(libraryProblem('https://evil.test/'));
});
test('opening a library question requests navigation only, without reading source, saving coursework or starting models',async()=>{
  const calls=[];const service=createVscodeService({currentProblem:async()=>({connected:true,tabId:7}),browser:async(action,p)=>{calls.push({action,p});return {url:p.problemUrl,tabId:7};},launchReport:()=>{throw new Error('No report');},launchHint:()=>{throw new Error('No model');}});
  const result=await service.handle({type:'library_open',key:'bailian:1064'});assert.equal(result.url,'http://bailian.openjudge.cn/practice/1064/');assert.deepEqual(calls.map(c=>c.action),['navigate_problem']);await assert.rejects(service.handle({type:'library_open',key:'unknown'}));assert.equal(calls.length,1);
});
test('navigation reuses statement tabs and never replaces a submission form, even when the tab changed after listing',async()=>{
  const fixture=mockTabs();await navigateProblemTab(fixture.api,{problemUrl:url.replace('1004','1064'),tabId:2},[...fixture.records.values()]);assert.equal(fixture.records.get(2).url,url+'submit/');assert.equal(fixture.calls[0][0],'update');assert.equal(fixture.calls[0][1],1);
  const stale={...fixture.records.get(1),url};fixture.records.get(1).url=url+'submit/';fixture.records.get(1).active=true;await navigateProblemTab(fixture.api,{problemUrl:url,tabId:1},[stale]);assert.equal(fixture.calls.at(-1)[0],'create');
});
test('closing an AC form preserves newer source, newer submissions and unrelated pages; normal closure is idempotent',async()=>{
  const params={problemUrl:url,tabId:2,jobId,code,verdict:'AC'};
  for(const [fixture,latest,reason]of [[mockTabs({changed:true}),jobId,'source_changed'],[mockTabs(),'b'.repeat(64),'newer_submission']]){assert.equal((await closeAcceptedSubmitTab(fixture.api,params,latest)).reason,reason);assert.equal(fixture.calls.length,0);}
  const moved=mockTabs();moved.records.get(2).url=url.replace('1004','1064');assert.equal((await closeAcceptedSubmitTab(moved.api,params,jobId)).reason,'tab_changed');assert.equal(moved.calls.length,0);
  const fixture=mockTabs({active:true});const result=await closeAcceptedSubmitTab(fixture.api,params,jobId);assert.equal(result.closed,true);assert.equal(result.returnToTabId,1);assert.deepEqual(fixture.calls.map(c=>c[0]),['update','remove']);assert.equal((await closeAcceptedSubmitTab(fixture.api,params,jobId)).alreadyClosed,true);
  await assert.rejects(closeAcceptedSubmitTab(mockTabs().api,{...params,verdict:'WA'},jobId));
});
test('form source check is read-only and compares the frozen complete source',()=>{
  const dom=new JSDOM('<textarea name="source"></textarea>',{url:url+'submit/',runScripts:'outside-only'}),w=dom.window;w.document.querySelector('textarea').value=code;
  try{const read=w.eval('('+matchesSubmittedSource.toString()+')');assert.equal(read(url+'submit/',code),true);assert.equal(read(url+'submit/',code+'x'),false);assert.equal(w.document.querySelector('textarea').value,code);}finally{w.close();}
});
test('AC is saved before its corresponding form is closed, including an immediate verdict; mismatches never close',async()=>{
  for(const matching of [true,false]){
    const dir=await fs.mkdtemp(path.join(os.tmpdir(),'oj-close-')),prior=process.env.PKU_DATA_DIR;process.env.PKU_DATA_DIR=dir;let closes=0,posts=0;
    const submission={problemMatches:true,problemUrl:url,url:url.replace('/1004/','/solution/123/'),submissionId:'123',submittedCode:matching?code:code+'\nint other;',verdict:{status:'AC',text:'Accepted'},runtime:{}};
    const service=createVscodeService({currentProblem:async()=>({connected:false}),browser:async(action,p)=>{
      if(action==='capture')return {problem:{problemMatches:true,problemUrl:url,title:'自拟测试',problem:{description:'输出3',input:'无',output:'3',sampleInput:'',sampleOutput:'3'}},submission:null};
      if(action==='submit'){posts++;return {receipt:{submissionTabId:2},submission};}
      if(action==='refresh_submission')return {receipt:{submissionTabId:2},submission};
      if(action==='close_submission_tab'){closes++;assert.equal((await readSubmission(p.jobId)).submission.verdict.status,'AC');assert.equal(p.code,code);return {closed:true};}
    }});
    try{const source={uri:'file:///C:/fixture/one.cpp',name:'one.cpp',code,version:1};await service.handle({type:'context_bind',uri:source.uri,binding:{problemUrl:url,tabId:1}});const result=await service.handle({type:'oj_submit',source,problemUrl:url,language:'G++',actionId:randomUUID()});assert.equal(closes,matching?1:0);await service.handle({type:'oj_refresh',id:result.id});assert.equal(closes,matching?1:0);assert.equal(posts,1);}finally{if(prior===undefined)delete process.env.PKU_DATA_DIR;else process.env.PKU_DATA_DIR=prior;await fs.rm(dir,{recursive:true,force:true});}
  }
});
test('library previous/next respects filters, boundaries and pending navigation without browser storage',async()=>{
  const dom=new JSDOM('<h1 id="title"></h1><p id="state"></p><main id="sections"></main><button id="openProblem"></button><details id="library"><input id="librarySearch"><select id="libraryPlatform"><option value=""></option><option>NOI</option></select><select id="libraryLevel"><option value=""></option></select><select id="libraryProblem"></select><button id="previousProblem"></button><button id="nextProblem"></button><span id="libraryPosition"></span><p id="libraryState"></p></details>',{url:'https://owned.test/',runScripts:'outside-only'}),w=dom.window,messages=[];
  try{
    w.acquireVsCodeApi=()=>({postMessage:value=>messages.push(value)});for(const method of ['getItem','setItem','removeItem','clear'])w.Storage.prototype[method]=()=>{throw new Error('No storage');};
    w.eval(await fs.readFile(new URL('../vscode-extension/problem-view.js',import.meta.url),'utf8'));
    const items=(await readProblemLibrary()).items.filter(p=>['bailian:1064','bailian:1089','noi:ch0206/1759'].includes(p.key)),emit=data=>w.dispatchEvent(new w.MessageEvent('message',{data})),element=id=>w.document.getElementById(id);
    emit({type:'problem_library',items});emit({type:'problem_display',status:'loading',connected:true,url:items[0].url});assert.equal(element('previousProblem').disabled,true);
    element('nextProblem').click();assert.equal(messages.at(-1).key,items[1].key);assert.equal(element('nextProblem').disabled,true);emit({type:'library_opened',requestKey:items[1].key,url:items[1].url});
    element('previousProblem').click();assert.equal(messages.at(-1).key,items[0].key);emit({type:'library_error',requestKey:items[0].key,error:'未连接'});assert.equal(element('libraryState').textContent,'未连接');
    element('libraryPlatform').value='NOI';element('libraryPlatform').dispatchEvent(new w.Event('input'));element('nextProblem').click();assert.equal(messages.at(-1).key,'noi:ch0206/1759');emit({type:'library_opened',requestKey:'noi:ch0206/1759',url:items[2].url});assert.equal(element('nextProblem').disabled,true);assert.equal(element('previousProblem').disabled,true);
  }finally{w.close();}
});
test('conversation entry moves above hints and clicking submit puts only its status panel at the top',async()=>{
  const dom=new JSDOM('<header>教练</header><p id="saveStatus"></p><section id="hintPanel"><h2>解题方向</h2><button id="runSample"></button><button id="submitOJ"></button><details id="chatPanel"><summary>交流</summary></details><section id="samplePanel"><p id="sampleState"></p><div id="sampleResults"></div></section><section id="ojPanel"><p id="ojState"></p><div id="ojResults"></div><div id="ojLanguageRow"><select id="ojLanguage"></select></div><button id="refreshOJ"></button></section></section>',{url:'https://owned.test/',runScripts:'outside-only'}),w=dom.window,messages=[];
  try{w.chrome={runtime:{connect:()=>({postMessage:value=>messages.push(value),onMessage:{addListener(){}}})}};w.eval(await fs.readFile(new URL('../vscode-extension/judge-controls.js',import.meta.url),'utf8'));assert.equal(w.document.querySelector('#hintPanel').firstElementChild.id,'chatPanel');w.document.querySelector('#submitOJ').click();assert.equal(w.document.querySelector('header').nextElementSibling.id,'ojPanel');assert.equal(messages.at(-1).type,'oj_prepare');}finally{w.close();}
});
