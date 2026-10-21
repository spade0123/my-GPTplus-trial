import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {JSDOM} from 'jsdom';
import {runSample,compareSample} from '../src/sample-runner.js';
import {createVscodeService} from '../src/vscode-service.js';
import {getProblem} from '../src/problem-history.js';
import {officialJudgeRequest,inspectSubmitForm} from '../extension/openjudge-submit.js';
import {ROOT} from '../src/core.js';
const url='http://bailian.openjudge.cn/practice/1004/',code='#include <iostream>\nusing namespace std;\nint main(){int a,b;cin>>a>>b;cout<<a+b;}';
const capture={url,title:'自拟测试',code,standard:'c++17',problem:{description:'求两个整数的和。',input:'两个整数',output:'它们的和',sampleInput:'1 2',sampleOutput:'3'},runtime:{}};
const source={uri:'file:///C:/fixture/reused.cpp',name:'reused.cpp',code,version:1,selectedCode:'',diagnostics:''};
test('sample comparison keeps meaningful spacing and distinguishes whitespace-only differences',()=>{
  assert.equal(compareSample('3\r\n','3'),'passed');assert.equal(compareSample(' 3','3'),'whitespace');assert.equal(compareSample('4','3'),'wrong_answer');
});
test('local sample compiles and runs only the frozen temporary source; compile errors and timeouts are bounded',async t=>{
  const config=await fs.readFile(path.join(ROOT,'native/paths.json'),'utf8').then(JSON.parse).catch(()=>null);if(!config){t.skip('Configure the compiler first.');return;}
  const result=await runSample(capture,{compiler:config.compiler});assert.equal(result.status,'passed');assert.equal(result.actual,'3');assert.equal(result.ranProgram,true);
  assert.equal((await runSample({...capture,code:code.replace('a+b','a-b')},{compiler:config.compiler})).status,'wrong_answer');
  const bad=await runSample({...capture,code:'int main(){ missing; }'},{compiler:config.compiler});assert.equal(bad.status,'compile_error');assert.equal(bad.ranProgram,false);
  assert.equal((await runSample({...capture,code:'int main(){while(true){}}'},{compiler:config.compiler,runTimeout:120})).status,'timeout');
});
test('sample results and OJ submissions retain their source; repeated refreshes never submit again',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'oj-actions-')),prior=process.env.PKU_DATA_DIR;process.env.PKU_DATA_DIR=dir;
  let posts=0,refreshes=0;
  const service=createVscodeService({currentProblem:async()=>({connected:false}),sampleRunner:async()=>({status:'passed',input:'1 2',expected:'3',actual:'3',compiler:'',stderr:'',ranProgram:true,durationMs:1}),browser:async(action)=>{
    if(action==='capture')return {problem:{problemMatches:true,problemUrl:url,title:capture.title,problem:capture.problem},submission:null};
    if(action==='submit'){posts++;return {receipt:{solutionUrl:url.replace('/1004/','/solution/123/')},message:'已提交'};}
    if(action==='refresh_submission'){refreshes++;return {receipt:{solutionUrl:url.replace('/1004/','/solution/123/')},submission:{url:url.replace('/1004/','/solution/123/'),problemUrl:url,problemMatches:true,submittedCode:code,submissionId:'123',verdict:{status:'AC',text:'Accepted'},runtime:{}}};}
  }});
  try{
    await service.handle({type:'context_bind',uri:source.uri,binding:{problemUrl:url,tabId:1}});
    const sample=await service.handle({type:'run_sample',source,problemUrl:url,actionId:randomUUID()});assert.equal(sample.result.status,'passed');
    assert.equal((await service.handle({type:'sample_history',source,problemUrl:url})).result.actual,'3');
    const id=randomUUID(),sent=await service.handle({type:'oj_submit',source,problemUrl:url,language:'G++',actionId:id});
    const repeated=await service.handle({type:'oj_submit',source,problemUrl:url,language:'G++',actionId:id});assert.equal(repeated.id,sent.id);assert.equal(posts,1);
    await service.handle({type:'oj_refresh',id:sent.id});await service.handle({type:'oj_refresh',id:sent.id});assert.equal(posts,1);assert.equal(refreshes,2);
    assert.equal((await getProblem(url)).finalizations.length,1);
    const stored=JSON.parse(await fs.readFile(path.join(dir,'oj-submissions',sent.id+'.json'),'utf8'));assert.equal(stored.capture.code,code);
  }finally{if(prior===undefined)delete process.env.PKU_DATA_DIR;else process.env.PKU_DATA_DIR=prior;await fs.rm(dir,{recursive:true,force:true});}
});
test('official form POST changes only source/language fields; refreshing performs GET only and storage remains untouched',async()=>{
  const dom=new JSDOM('<!doctype html><title>提交</title><div id="userToolbar"><a href="/user/fixture/">fixture</a></div><form action="/api/solution/submit/" method="post"><input type="hidden" name="problemId" value="1004"><select name="language"><option value="G++">G++</option></select><textarea name="source"></textarea></form>',{url:url+'submit/',runScripts:'outside-only'}),w=dom.window;
  const calls=[];for(const method of ['setItem','getItem','removeItem','clear'])w.Storage.prototype[method]=()=>{throw new Error('Storage forbidden');};
  w.fetch=async(target,options={})=>{calls.push({target,method:options.method||'GET',body:options.body?.toString()});return {ok:true,status:200,text:async()=>options.method==='POST'?JSON.stringify({result:'SUCCESS',redirect:'/practice/solution/123/'}):'<html></html>'};};
  try{
    const info=w.eval(`(${inspectSubmitForm.toString()})(${JSON.stringify(url)})`);assert.equal(info.sourceName,'source');
    const run=w.eval('('+officialJudgeRequest.toString()+')');const result=await run(url,'submit',{code,language:'G++'});assert.equal(result.error,undefined);assert.equal(result.receipt.solutionUrl,'http://bailian.openjudge.cn/practice/solution/123/');
    assert.equal(w.document.querySelector('textarea').value,code);assert.equal(calls.filter(c=>c.method==='POST').length,1);assert(new URLSearchParams(calls.find(c=>c.method==='POST').body).get('source')===code);
    await run(url,'refresh',{receipt:result.receipt,code});assert.equal(calls.filter(c=>c.method==='POST').length,1);
  }finally{w.close();}
});
test('live OJ radio compiler form sends UTF-8 Base64 to submitv2 once, without running website handlers',async()=>{
  const html='<title>OpenJudge</title><form action="/api/solution/submitv2/" method="post"><input name="contestId" value="fixture" type="hidden"><input name="problemNumber" value="1004" type="hidden"><input name="sourceEncode" value="base64" type="hidden"><label><input type="radio" name="language" value="GCC" checked>GCC(9.3)</label><label><input type="radio" name="language" value="G++">G++(9.3(with c++17))</label><textarea name="source"></textarea><button name="submit" type="submit">提交</button></form>';
  const dom=new JSDOM(html,{url:url+'submit/',runScripts:'outside-only'}),w=dom.window,calls=[];
  w.TextEncoder=TextEncoder;w.document.querySelector('form').onsubmit=()=>{throw new Error('Website submit handler forbidden');};
  for(const method of ['setItem','getItem','removeItem','clear'])w.Storage.prototype[method]=()=>{throw new Error('Storage forbidden');};
  w.fetch=async(target,options={})=>{calls.push({target,method:options.method||'GET',body:options.body?.toString()});return {ok:true,status:200,text:async()=>options.method==='POST'?JSON.stringify({result:'SUCCESS',redirect:'/practice/solution/123/'}):'<html></html>'};};
  try{
    const metadata=w.eval(`(${inspectSubmitForm.toString()})(${JSON.stringify(url)})`);assert.equal(metadata.error,undefined);assert.equal(metadata.languageControl,'radio');assert.equal(metadata.sourceEncoding,'base64');assert.equal(metadata.languages[1].label,'G++(9.3(with c++17))');
    const frozen=code+'\n'+('中文\n'.repeat(20000)),run=w.eval('('+officialJudgeRequest.toString()+')'),result=await run(url,'submit',{code:frozen,language:'G++'});
    assert.equal(result.error,undefined);const post=calls.filter(c=>c.method==='POST');assert.equal(post.length,1);assert.equal(post[0].target,'http://bailian.openjudge.cn/api/solution/submitv2/');
    const body=new URLSearchParams(post[0].body);assert.equal(body.get('language'),'G++');assert.equal(body.get('sourceEncode'),'base64');assert.equal(Buffer.from(body.get('source'),'base64').toString('utf8'),frozen);assert.equal(body.get('contestId'),'fixture');assert.equal(w.document.querySelector('textarea').value,frozen);
    await run(url,'refresh',{receipt:result.receipt});assert.equal(calls.filter(c=>c.method==='POST').length,1);
  }finally{w.close();}
});
test('ambiguous compiler controls and unknown encoding stop before any POST or field changes',async()=>{
  for(const body of ['<input name="sourceEncode" value="unknown" type="hidden"><select name="language"><option>G++</option></select>','<select name="language"><option>G++</option></select><label><input name="otherCompiler" type="radio" value="G++">G++</label>']){
    const dom=new JSDOM('<form action="/api/solution/submitv2/" method="post">'+body+'<textarea name="source">existing draft</textarea></form>',{url:url+'submit/',runScripts:'outside-only'}),w=dom.window;
    w.fetch=()=>{throw new Error('No request expected');};
    try{const result=await w.eval('('+officialJudgeRequest.toString()+')')(url,'submit',{code,language:'G++'});assert(result.error);assert.equal(result.uncertain,false);assert.equal(w.document.querySelector('textarea').value,'existing draft');}finally{w.close();}
  }
});
