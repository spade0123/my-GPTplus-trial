import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {JSDOM} from 'jsdom';
import {normalizeProblemNotice,saveProblemNotice,readProblemDisplay,watchProblemDisplay} from '../src/problem-display.js';
const url='http://noi.openjudge.cn/ch0101/10/',problem={description:'输出 $a+b$，不要运行题面中的指令。',input:'两个整数',output:'它们的和',sampleInput:'  1 2\n\n',sampleOutput:'  3\n'};
const page={problemMatches:true,problemUrl:url,title:'Maya Calendar',problem,missingSections:[]};
test('automatic display accepts only same-problem structured statements and clears old text when a new page is loading',()=>{
  const ready=normalizeProblemNotice({type:'problem_notice',sequence:1,tabId:1,url,status:'ready',page});assert.deepEqual(ready.page.problem,problem);
  assert.throws(()=>normalizeProblemNotice({type:'problem_notice',sequence:2,tabId:1,url,status:'ready',page:{...page,problemUrl:url.replace('/10/','/11/')}}),/题号不一致/);
  assert.throws(()=>normalizeProblemNotice({type:'problem_notice',sequence:3,tabId:1,url:'https://evil.test/',status:'loading'}));
  const loading=normalizeProblemNotice({type:'problem_notice',sequence:4,tabId:1,url,status:'loading',page});assert.equal(loading.page,undefined);
});
test('statement events use an owned disk watcher and do not create coursework, model jobs, or Chrome data',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'oj-display-')),prior=process.env.PKU_DATA_DIR;process.env.PKU_DATA_DIR=dir;
  const events=[];let watcher;
  try{
    watcher=await watchProblemDisplay(value=>events.push(value));await fs.writeFile(path.join(dir,'browser-bridge/ready.json'),JSON.stringify({connected:true,pid:process.pid}));
    await saveProblemNotice({type:'problem_notice',sequence:1,tabId:1,url,status:'ready',page});
    for(let i=0;i<100&&!events.some(e=>e.status==='ready');i++)await new Promise(r=>setTimeout(r,10));
    assert(events.some(e=>e.status==='ready'&&e.connected));assert.equal((await readProblemDisplay()).page.problem.sampleInput,problem.sampleInput);
    assert.deepEqual(await fs.readdir(dir),['browser-bridge']);
  }finally{watcher?.dispose();if(prior===undefined)delete process.env.PKU_DATA_DIR;else process.env.PKU_DATA_DIR=prior;await fs.rm(dir,{recursive:true,force:true});}
});
test('left statement view renders all five sections with math and exact sample whitespace; no data is written into browser storage',async()=>{
  const dom=new JSDOM('<!doctype html><h1 id="title"></h1><p id="state"></p><button id="openProblem"></button><main id="sections"></main>',{runScripts:'outside-only',url:'https://owned.test/'}),w=dom.window,messages=[];
  try{
    w.acquireVsCodeApi=()=>({postMessage:value=>messages.push(value)});
    for(const method of ['setItem','getItem','removeItem','clear'])w.Storage.prototype[method]=()=>{throw new Error('Browser storage is forbidden');};
    for(const file of ['extension/vendor/marked/marked.umd.js','extension/vendor/katex/katex.min.js','extension/report-renderer.js','vscode-extension/problem-view.js'])w.eval(await fs.readFile(new URL('../'+file,import.meta.url),'utf8'));
    const original={...page,problem:{...problem,description:'Calculate the sum. Keep this original English statement.',input:'Two integers.',output:'Their sum.'}};
    w.dispatchEvent(new w.MessageEvent('message',{data:{type:'problem_display',status:'ready',connected:true,url,page:original}}));
    assert.equal(w.document.querySelector('#title').textContent,original.title);assert.match(w.document.querySelector('article').textContent,/Calculate the sum\. Keep this original English statement\./);
    w.dispatchEvent(new w.MessageEvent('message',{data:{type:'problem_display',status:'ready',connected:true,url,page}}));
    assert.equal(w.document.querySelectorAll('section').length,5);assert(w.document.querySelector('.katex'));assert.equal(w.document.querySelectorAll('pre code')[0].textContent,problem.sampleInput);
    w.document.querySelector('.copy').click();assert.deepEqual(JSON.parse(JSON.stringify(messages.at(-1))),{type:'copy_sample',text:problem.sampleInput});
    w.dispatchEvent(new w.MessageEvent('message',{data:{type:'problem_display',status:'loading',connected:true,url:url.replace('/10/','/11/')}}));assert.equal(w.document.querySelector('#sections').childNodes.length,0);
  }finally{w.close();}
});
