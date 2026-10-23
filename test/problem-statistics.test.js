import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {parseProblemStatistics,readProblemStatistics} from '../src/problem-statistics.js';
import {createVscodeService} from '../src/vscode-service.js';
const url='http://bailian.openjudge.cn/practice/1004/';
const html=`<a href="${url}">1004</a><div id="side"><table><tbody><tr><td class="result">Accepted</td><td class="count">1,200</td></tr><tr><td class="result">Wrong Answer</td><td class="count">800</td></tr></tbody></table></div>`;
test('official submission statistics are distinct from people ratio, reject wrong identity, and handle zero or missing data',()=>{
 const s=parseProblemStatistics(html,url);assert.equal(s.rate,60);assert.equal(s.total,2000);assert.equal(s.metric,'accepted-submissions/total-submissions');
 assert.throws(()=>parseProblemStatistics(html,url.replace('1004','1005')),/题号/);
 assert.throws(()=>parseProblemStatistics('<a href="'+url+'">1004</a>',url),/暂不可用/);
 assert.equal(parseProblemStatistics(html.replace('1,200','0').replace('800','0'),url).rate,null);
});
test('rate fetch uses one bounded cookie-free GET, forbids redirects and external URLs, and never touches source or browser state',async()=>{
 let calls=0;const result=await readProblemStatistics(url,{request:async(u,options)=>{calls++;assert.equal(u,url+'statistics/');assert.equal(options.method,'GET');assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');return new Response(html);}});assert.equal(result.rate,60);assert.equal(calls,1);
 await assert.rejects(readProblemStatistics('http://127.0.0.1/',{request:()=>{throw Error('Unexpected network');}}),/仅支持/);
 const service=createVscodeService({statisticsReader:async u=>{assert.equal(u,url);return result;},browser:()=>{throw Error('No browser action');},currentProblem:()=>{throw Error('No source context');}});
 assert.equal((await service.handle({type:'problem_statistics',url})).rate,60);
});
test('rate stays hidden without a click, can collapse/refresh, and stale replies never leak across A-B-A switching',async()=>{
 const dom=new JSDOM('<h1 id="title"></h1><p id="state"></p><main id="sections"></main><button id="openProblem"></button><button id="showRate" hidden>查看通过率</button><div id="ratePanel" hidden><p id="rateState"></p><p id="rateBasis"></p><p id="rateChecked"></p><button id="refreshRate"></button><button id="openStatistics"></button></div>',{url:'https://owned.test',runScripts:'outside-only'}),w=dom.window,messages=[],$=id=>w.document.getElementById(id),emit=data=>w.dispatchEvent(new w.MessageEvent('message',{data}));
 try{
  w.acquireVsCodeApi=()=>({postMessage:m=>messages.push(m)});for(const key of ['getItem','setItem','removeItem','clear'])w.Storage.prototype[key]=()=>{throw Error('No browser storage');};w.PkuReportRenderer={render:()=>{}};
  w.eval(await fs.readFile(new URL('../vscode-extension/problem-view.js',import.meta.url),'utf8'));
  const show=u=>emit({type:'problem_display',url:u,status:'ready',connected:true,page:{title:'原文',problem:{}}});show(url);assert.equal($('ratePanel').hidden,true);assert.equal(messages.filter(m=>m.type==='problem_statistics').length,0);
  $('showRate').click();const old=messages.at(-1);assert.equal(old.type,'problem_statistics');assert.equal($('ratePanel').hidden,false);
  show(url.replace('1004','1005'));show(url);assert.equal($('ratePanel').hidden,true);$('showRate').click();const current=messages.at(-1);
  emit({type:'problem_statistics',problemUrl:url,requestId:old.requestId,rate:99,total:100,accepted:99,checkedAt:new Date().toISOString()});assert(!$('rateState').textContent.includes('99'));
  emit({type:'problem_statistics',problemUrl:url,requestId:current.requestId,rate:60,total:2000,accepted:1200,checkedAt:new Date().toISOString()});assert($('rateState').textContent.includes('60.00%'));assert($('rateBasis').textContent.includes('不是通过人数'));
  $('showRate').click();assert.equal($('ratePanel').hidden,true);assert.equal($('rateState').textContent,'');$('showRate').click();$('refreshRate').click();assert(messages.at(-1).requestId>current.requestId);
 }finally{w.close();}
});
