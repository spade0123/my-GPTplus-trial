import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createRequire} from 'node:module';
import {JSDOM} from 'jsdom';
const {sampleHtml}=createRequire(import.meta.url)('../vscode-extension/sample-view.cjs');
const sampleScript=await fs.readFile(new URL('../vscode-extension/sample-controls.js',import.meta.url),'utf8');
const judgeScript=await fs.readFile(new URL('../vscode-extension/judge-controls.js',import.meta.url),'utf8');
async function fixture(){
  const dom=new JSDOM(sampleHtml({}, {nonce:'testnonce',cspSource:'https://owned.test',uri:file=>'https://owned.test/'+file}),{url:'https://owned.test',runScripts:'outside-only'}),w=dom.window,messages=[],timers=[];
  w.acquireVsCodeApi=()=>({postMessage:value=>messages.push(value)});
  for(const name of ['getItem','setItem','removeItem','clear'])w.Storage.prototype[name]=()=>{throw new Error('No browser storage');};
  w.setTimeout=fn=>{timers.push(fn);return timers.length;};w.clearTimeout=()=>{};
  w.eval(sampleScript);w.eval(judgeScript);await new Promise(resolve=>setImmediate(resolve));
  return {dom,w,messages,timers,$:id=>w.document.getElementById(id),emit:value=>w.dispatchEvent(new w.MessageEvent('message',{data:value}))};
}
test('standalone sample view uses local nonce scripts and escapes all initial evidence',()=>{
  const html=sampleHtml({title:'<img src=x onerror=alert(1)>',result:{status:'compile_error',compiler:'<script>bad()</script>',input:'<1>',expected:'3',actual:'',durationMs:1}},{nonce:'safe',cspSource:'https://owned.test',uri:file=>'https://owned.test/'+file});
  const dom=new JSDOM(html);try{assert.equal(dom.window.document.querySelectorAll('img').length,0);assert.equal(dom.window.document.querySelectorAll('script').length,2);assert([...dom.window.document.querySelectorAll('script')].every(s=>s.nonce==='safe'&&s.src.startsWith('https://owned.test/')));assert(dom.window.document.querySelector('meta[http-equiv]').content.includes("connect-src 'none'"));assert.equal(dom.window.document.querySelector('#closeCoach').textContent,'收起');assert.equal(dom.window.document.querySelector('#submitOJ').textContent,'提交到 OJ');}finally{dom.window.close();}
});
test('opening standalone sample controls only reports ready; collapse does not execute code or send a submission',async()=>{
  const f=await fixture();try{assert.deepEqual(f.messages.map(m=>m.type),['sample_ready']);f.$('closeCoach').click();assert.deepEqual(f.messages.map(m=>m.type),['sample_ready','sample_collapse']);}finally{f.w.close();}
});
test('live sample updates preserve prepared compiler and active OJ job; status pins to top, refresh never resubmits',async()=>{
  const f=await fixture();try{
    f.$('submitOJ').click();f.$('submitOJ').click();assert.equal(f.messages.filter(m=>m.type==='oj_prepare').length,1);assert.equal(f.w.document.querySelector('header').nextElementSibling.id,'ojPanel');assert.equal(f.$('ojPanel').hidden,false);
    f.emit({type:'oj_prepared',languages:[{label:'G++17',value:'G++',selected:true},{label:'GCC',value:'GCC'}]});assert.equal(f.$('ojLanguage').options.length,1);
    f.emit({type:'sample_view',saved:true,title:'原文题目',message:'正在运行'});assert.equal(f.$('sampleTitle').textContent,'原文题目');assert.equal(f.$('sampleSaved').hidden,false);assert.equal(f.$('ojLanguage').value,'G++');
    f.$('submitOJ').click();const submitted=f.messages.at(-1);assert.equal(submitted.type,'oj_submit');assert.equal(submitted.language,'G++');f.$('submitOJ').click();assert.equal(f.messages.filter(m=>m.type==='oj_submit').length,1);
    f.emit({type:'sample_view',saved:true,title:'原文题目',codeHash:'a'.repeat(64),result:{status:'passed',durationMs:12,input:'1 2',expected:'3',actual:'3'}});assert(f.$('sampleState').textContent.includes('样例输出一致'));assert.equal(f.$('ojLanguage').value,'G++');assert.equal(f.$('submitOJ').disabled,true);
    const result={type:'oj_result',requestType:'oj_submit',actionId:submitted.actionId,id:'b'.repeat(64),submission:{submissionId:'123',verdict:{status:'pending',text:'Waiting'}}};
    f.emit({...result,actionId:'stale'});assert(!f.$('ojState').textContent.includes('123'));f.emit(result);assert.equal(f.timers.length,1);assert(f.$('ojState').textContent.includes('123'));
    f.$('refreshOJ').click();const refresh=f.messages.at(-1);assert.equal(refresh.type,'oj_refresh');assert.equal(refresh.id,result.id);assert.equal(f.messages.filter(m=>m.type==='oj_submit').length,1);
    f.emit({...result,requestType:'oj_refresh',actionId:refresh.actionId,submitPageClosed:true,submission:{submissionId:'123',verdict:{status:'AC',text:'Accepted'}}});assert(f.$('ojState').textContent.includes('Accepted'));assert(f.$('ojResults').textContent.includes('提交页面已关闭'));
    assert.equal(f.$('sampleResults').querySelectorAll('pre').length,3);
  }finally{f.w.close();}
});
test('failed sample keeps confirmed save visible and allows official submission, with no HTML execution',async()=>{
  const f=await fixture();try{f.emit({type:'sample_view',saved:true,error:'<img src=x onerror=alert(1)>',workerError:'后台暂时不可用'});assert.equal(f.$('sampleSaved').hidden,false);assert(f.$('sampleState').textContent.startsWith('代码已保存；测试未完成：'));assert.equal(f.w.document.querySelectorAll('img').length,0);f.$('submitOJ').click();assert.equal(f.messages.at(-1).type,'oj_prepare');}finally{f.w.close();}
});
