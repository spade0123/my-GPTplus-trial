import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {JSDOM} from 'jsdom';
import {openJudgeUrl,sameProblem} from '../src/openjudge-url.js';
import {readOpenJudgePage} from '../extension/openjudge-extract.js';
import {createVscodeService} from '../src/vscode-service.js';
import {getProblem,timeline} from '../src/problem-history.js';
import {readReview,captureFromRecord} from '../src/browser-review.js';
import {hintAnswerContext} from '../src/hint-context.js';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{RpcClient}=require('../vscode-extension/rpc-client.cjs');
const url='http://bailian.openjudge.cn/practice/1001/',other='http://noi.openjudge.cn/ch0101/10/';
const code='#include <iostream>\nusing namespace std;\nint main(){int a,b;cin>>a>>b;cout<<a+b;}';
const problem={description:'读入两个整数，计算并输出它们的和。',input:'两个整数',output:'整数和',sampleInput:'1 2',sampleOutput:'3'};
const source={uri:'file:///C:/fixture/problem.cpp',name:'problem.cpp',code,version:1,selectedCode:'cout<<a+b;',diagnostics:''};
async function isolated(fn){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'oj-vscode-'));const prior=process.env.PKU_DATA_DIR;process.env.PKU_DATA_DIR=dir;try{await fn(dir);}finally{if(prior===undefined)delete process.env.PKU_DATA_DIR;else process.env.PKU_DATA_DIR=prior;await fs.rm(dir,{recursive:true,force:true});}}
function page(problemUrl=url){return {url:problemUrl,problemUrl,problemMatches:true,title:'开发者自拟：求和',problem,missingSections:[]};}
async function parse(html,target,expected=url){
  const dom=new JSDOM(html,{url:target,runScripts:'outside-only'}),w=dom.window;
  let writes=0;for(const method of ['getItem','setItem','removeItem','clear'])w.Storage.prototype[method]=()=>{writes++;throw new Error('Site storage forbidden');};
  const original=w.document.documentElement.outerHTML;
  try{const result=await w.eval(`(${readOpenJudgePage.toString()})(${JSON.stringify(target)},${JSON.stringify(expected)})`);assert.equal(w.document.documentElement.outerHTML,original);assert.equal(writes,0);return result;}finally{w.close();}
}
test('only exact selected OpenJudge problem/solution URLs are allowed, and hosts/groups remain independent',()=>{
  assert.equal(openJudgeUrl(url,{kind:'problem'}).problemId,'1001');assert.equal(openJudgeUrl(other,{kind:'problem'}).group,'ch0101');assert.equal(openJudgeUrl(url+'submit/'),null);
  for(const value of ['http://bailian.openjudge.cn.evil.test/practice/1001/','https://user:pass@noi.openjudge.cn/ch0101/10/','http://noi.openjudge.cn:8080/ch0101/10/','http://noi.openjudge.cn/ch0101/10/?act=submit','file:///practice/1001/','http://noi.openjudge.cn/accounts/login/'])assert.equal(openJudgeUrl(value),null);
  assert(sameProblem(url,url.replace('http:','https:')));assert(!sameProblem(url,other));
});
test('real OJ dt/dd layout keeps five statement sections, preserves sample indentation, never treats samples as runtime or AC',async()=>{
  const result=await parse('<title>OpenJudge - 1001:自拟题</title><dl class="problem-content"><dt>描述</dt><dd>输出指定图案。</dd><dt>输入</dt><dd>无。</dd><dt>输出</dt><dd>按样例。</dd><dt>样例输入</dt><dd><pre>（无）</pre></dd><dt>样例输出</dt><dd><pre>  ##\n #  #\nAccepted</pre></dd><dt>提示</dt><dd>行首空格保留。</dd></dl>',url);
  assert.equal(result.problem.sampleOutput,'  ##\n #  #\nAccepted');assert.equal(result.runtime.output,'');assert.equal(result.verdict.status,'unknown');assert.match(result.problem.description,/题目提示/);assert.equal(result.missingSections.length,0);
});
test('solution status needs matching problem identity; source is taken only from a dedicated source container',async()=>{
  const href='<a href="/practice/1001/">自拟题</a>',text=code.replace(/&/g,'&amp;').replace(/</g,'&lt;');
  const result=await parse('<title>提交详情</title>'+href+'<table><tr><th>结果</th><td>Accepted</td></tr></table><pre class="source-code">'+text+'</pre><pre class="compile-error">旧编译提示</pre>',url.replace('/1001/','/solution/53535882/'));
  assert.equal(result.verdict.status,'AC');assert.equal(result.submissionId,'53535882');assert.equal(result.submittedCode,code);assert.equal(result.runtime.error,'旧编译提示');
  const absent=await parse(href+'<div class="result">Accepted</div><pre>this is an execution output</pre>',url.replace('/1001/','/solution/53535882/'));assert.equal(absent.submittedCode,null);
  await assert.rejects(parse('<a href="/practice/1002/">另一题</a><span class="result">Accepted</span>',url.replace('/1001/','/solution/53535882/')),/无法将/);
  await assert.rejects(parse(href+'<a href="/practice/1002/">另一题</a><span class="result">Accepted</span>',url.replace('/1001/','/solution/53535882/')),/无法将/);
});
test('solution details preserve official memory, time, language, submitter and timestamp in supported basic-info layouts',async()=>{
  const fields=[['提交人','fixture-user'],['内存','272kB'],['时间','991ms'],['语言','G++'],['提交时间','2026-10-21 08:10:00']];
  for(const markup of ['<dl>'+fields.map(([k,v])=>'<dt>'+k+'：</dt><dd>'+v+'</dd>').join('')+'</dl>','<ul>'+fields.map(([k,v])=>'<li>'+k+'：'+v+'</li>').join('')+'</ul>','<table>'+fields.map(([k,v])=>'<tr><th>'+k+'</th><td>'+v+'</td></tr>').join('')+'</table>']){
    const result=await parse('<a href="/practice/1001/">1001</a><div class="result">Accepted</div>'+markup,url.replace('/1001/','/solution/123/'));
    assert.equal(result.details.problemId,'1001');assert.equal(result.details.submitter,'fixture-user');assert.equal(result.details.memory,'272kB');assert.equal(result.details.time,'991ms');assert.equal(result.details.language,'G++');assert.equal(result.details.submittedAt,'2026-10-21 08:10:00');
  }
});
test('missing or conflicting OJ metrics remain missing and neither statement nor source code can supply fake metadata',async()=>{
  const result=await parse('<a href="/practice/1001/">1001</a><dl><dt>内存</dt><dd>1kB</dd><dt>内存</dt><dd>2kB</dd></dl><pre class="source-code">语言：fake\n提交时间：fake</pre><dl class="problem-content"><dt>时间</dt><dd>999ms</dd></dl>',url.replace('/1001/','/solution/123/'));
  assert.equal(result.details.memory,null);assert.equal(result.details.time,null);assert.equal(result.details.language,null);assert.equal(result.details.submittedAt,null);assert.equal((await parse('<dl><dt>内存</dt><dd>fake</dd></dl>',url)).details,null);
});
test('VS Code snapshots use click-time full source, isolate problems, deduplicate content, and never accept unmatched AC',()=>isolated(async()=>{
  let submitted=code,currentUrl=url,offline=false;const launches=[];
  const service=createVscodeService({browser:async(type,b)=>{
    if(offline)throw new Error('Chrome 尚未连接');if(type==='tabs')return [];
    return {problem:page(currentUrl),submission:{problemUrl:currentUrl,problemMatches:true,submissionId:'53535882',url:currentUrl.replace(/\d+\/$/,'solution/53535882/'),submittedCode:submitted,sourceTruncated:false,verdict:{status:'AC',text:'Accepted'},runtime:{},observedAt:new Date().toISOString()}};
  },launchReport:async()=>launches.push('report'),launchHint:async kind=>launches.push(kind)});
  await service.handle({type:'context_bind',uri:source.uri,binding:{problemUrl:url,tabId:1}});
  const changed={...source,code:code.replace('a+b','a-b'),version:2};
  const hint=await service.handle({type:'hint',source:changed,actionId:randomUUID()});
  assert.equal(hint.hint.status,'queued');assert.equal(hint.context.judgment.status,'unknown');assert.equal(hint.context.capture.runtime.status,'unknown');assert.match(hint.context.capture.runtime.text,/尚未与本次/);assert.equal((await getProblem(url)).finalizations.length,0);
  assert.equal((await readReview(hint.id)).code,changed.code);assert.equal((await captureFromRecord(await readReview(hint.id))).runtime.output,'');
  const accepted=await service.handle({type:'quick_save',source,actionId:randomUUID()});assert.equal(accepted.context.judgment.status,'AC');assert.equal((await getProblem(url)).finalizations.length,1);
  assert.equal((await hintAnswerContext(accepted.context.capture)).reference.code,code);
  const again=await service.handle({type:'quick_save',source,actionId:randomUUID()});assert.equal(again.id,accepted.id);assert.equal((await getProblem(url)).finalizations.length,1);
  currentUrl=other;await assert.rejects(service.handle({type:'quick_save',source,actionId:randomUUID()}),/绑定不一致/);
  const second={...source,uri:'file:///C:/fixture/other.cpp',name:'other.cpp'};await service.handle({type:'context_bind',uri:second.uri,binding:{problemUrl:other,tabId:2}});
  const saved=await service.handle({type:'quick_save',source:second,actionId:randomUUID()});assert.notEqual(saved.id,accepted.id);assert.equal((await getProblem(other)).finalizations.length,1);
  currentUrl=url;offline=true;const fallback=await service.handle({type:'quick_save',source:changed,actionId:randomUUID()});assert.match(fallback.warning,/未读到最新/);assert.equal(fallback.context.judgment.status,'unknown');
  await assert.rejects(service.handle({type:'hint',source:changed,actionId:randomUUID()}),/Chrome 尚未连接/);
  const history=await timeline(url);assert(history.rawAttemptCount>=4);assert(launches.includes('hint'));
}));
test('local drafts persist per source file and another problem cannot inherit them',()=>isolated(async()=>{
  const service=createVscodeService();await service.handle({type:'ui_save',uri:source.uri,ui:{question:'还没发送的问题',chatOpen:true}});
  assert.equal((await service.handle({type:'context_get',uri:source.uri})).ui.question,'还没发送的问题');assert.equal((await service.handle({type:'context_get',uri:'file:///C:/fixture/other.cpp'})).ui,undefined);
}));

test('one reused source file follows the browser question while snapshots and conversation drafts remain per problem',()=>isolated(async()=>{
  let current=url,revision=1;const launches=[];
  const currentProblem=async()=>({type:'problem_display',status:'ready',connected:true,revision:String(revision),url:current,tabId:revision,page:page(current)});
  const service=createVscodeService({currentProblem,browser:async(_type,b)=>({problem:page(b.problemUrl),submission:null}),launchReport:async()=>launches.push('report'),launchHint:async()=>launches.push('hint')});
  const a=await service.handle({type:'context_get',uri:source.uri});assert.equal(a.binding.problemUrl,url);assert.equal(launches.length,0);
  await service.handle({type:'ui_save',uri:source.uri,problemUrl:url,ui:{question:'A 题的未发送问题',chatOpen:true}});
  const first=await service.handle({type:'quick_save',source,problemUrl:url,actionId:randomUUID()});
  current=other;revision++;
  const b=await service.handle({type:'context_get',uri:source.uri});assert.equal(b.binding.problemUrl,other);assert.equal(b.ui,undefined);
  const changed={...source,code:code.replace('a+b','a-b'),version:3};
  const second=await service.handle({type:'discuss',source:changed,problemUrl:other,question:'B 题怎么写？',actionId:randomUUID()});assert.notEqual(first.id,second.id);
  assert.equal((await getProblem(url)).attempts.length,1);assert.equal((await getProblem(other)).attempts.length,1);assert.equal((await readReview(first.id)).code,code);
  await assert.rejects(service.handle({type:'hint',source:changed,problemUrl:url,actionId:randomUUID()}),/浏览器已切换题目/);
  await service.handle({type:'ui_save',uri:source.uri,problemUrl:other,ui:{question:'B 题草稿',chatOpen:false}});
  // A late UI save from the old window must not change the current B binding.
  await service.handle({type:'ui_save',uri:source.uri,problemUrl:url,ui:{question:'A 题补存草稿',chatOpen:true}});
  assert.equal((await service.handle({type:'context_get',uri:source.uri})).binding.problemUrl,other);
  current=url;revision++;const restored=await service.handle({type:'context_get',uri:source.uri});assert.equal(restored.ui.question,'A 题补存草稿');
  current=other;revision++;assert.equal((await service.handle({type:'context_get',uri:source.uri})).ui.question,'B 题草稿');
}));
test('real stdio transport preserves job id independently from request id',()=>isolated(async dir=>{
  const id='a'.repeat(64);await fs.mkdir(path.join(dir,'hints'),{recursive:true});await fs.writeFile(path.join(dir,'hints',id+'.json'),JSON.stringify({id,kind:'discussion',purpose:'discussion',status:'complete',analysis:'已保存的真实回复',sourceUrl:url}));
  const client=new RpcClient(process.execPath,path.resolve(import.meta.dirname,'..'));
  try{const status=await client.request({type:'status'});assert.equal(status.platform,'openjudge-vscode');const result=await client.request({type:'hint_status',id});assert.equal(result.id,id);assert.equal(result.analysis,'已保存的真实回复');}finally{client.dispose();}
}));

test('late older UI saves cannot overwrite the final collapse draft',()=>isolated(async()=>{
  const service=createVscodeService(),session=randomUUID(),ui={question:'收起时的最终草稿',chatOpen:true};
  await service.handle({type:'ui_save',uri:source.uri,problemUrl:url,ui,uiStamp:{session,startedAt:1000,revision:2}});
  await service.handle({type:'ui_save',uri:source.uri,problemUrl:url,ui:{question:'旧草稿',chatOpen:false},uiStamp:{session,startedAt:1000,revision:1}});
  assert.equal((await service.handle({type:'context_get',uri:source.uri})).ui.question,ui.question);
}));
test('each hint opening saves the click-time source even when earlier conversations exist, without starting a hint job',()=>isolated(async()=>{
  const launches=[];const service=createVscodeService({currentProblem:async()=>({connected:false}),browser:async()=>({problem:page(),submission:null}),launchReport:async()=>launches.push('report'),launchHint:async()=>launches.push('hint')});
  await service.handle({type:'context_bind',uri:source.uri,binding:{problemUrl:url,tabId:1}});
  await service.handle({type:'ui_save',uri:source.uri,problemUrl:url,ui:{question:'保留上次对话草稿',chatOpen:true}});
  const first=await service.handle({type:'hint_open',source,problemUrl:url,actionId:randomUUID()});
  const changed={...source,code:code.replace('a+b','a-b'),version:2};const second=await service.handle({type:'hint_open',source:changed,problemUrl:url,actionId:randomUUID()});
  assert.notEqual(first.id,second.id);assert.equal((await readReview(second.id)).code,changed.code);assert.deepEqual(launches,['report','report']);
  assert.equal((await service.handle({type:'context_get',uri:source.uri,problemUrl:url})).ui.question,'保留上次对话草稿');assert.equal((await getProblem(url)).attempts.length,2);
}));
