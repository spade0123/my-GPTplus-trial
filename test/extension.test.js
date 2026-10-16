import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {extractPage} from '../extension/extract.js';
const url='https://programming.pku.edu.cn/probset/d0ef3e0f7fa5481d896f9a07254c8ecd/f6b942b2dcd74656880a088f85f56c3f/ide.do';
function page(html) {
  const dom=new JSDOM(html,{url,runScripts:'outside-only'});
  Object.defineProperty(dom.window.HTMLElement.prototype,'innerText',{get(){return this.textContent;}});
  return dom;
}
const extract=dom=>dom.window.eval(`(${extractPage.toString()})()`);
test('browser extraction takes full Ace buffer, not its hidden input or problem samples',()=>{
  const dom=page('<title>测试题</title><div id="problem">输入两个整数并输出它们的和，范围为零到一百。<pre>int main(){return 1;}</pre></div><div class="ace_editor"><textarea class="ace_text-input">x</textarea><div>只渲染一行</div></div>');
  const full='#include <iostream>\nint main(){\n int x=0;\n return x;\n}';
  dom.window.document.querySelector('.ace_editor').env={editor:{getValue:()=>full}};
  const result=extract(dom);
  assert.equal(result.candidates.length,1);assert.equal(result.candidates[0].value,full);
  assert.match(result.problem.description,/输入两个整数/);assert.equal(result.needsVerification,true);
  dom.window.close();
});
test('unknown layout does not fall back to the whole course page',()=>{
  const dom=page('<title>题目</title><nav>不要采集导航</nav><main><p>课程导航文字和未识别内容。</p><input type="password" value="should-not-read"><textarea>int main(){return 0;}</textarea></main>');
  const result=extract(dom);assert.equal(result.statement,'');assert.doesNotMatch(result.statement,/should-not-read|int main|不要采集导航/);
  assert.equal(result.candidates.length,1);assert.equal(result.needsVerification,true);dom.window.close();
});
test('multiple editor buffers remain selectable; duplicates collapse',()=>{
  const dom=page('<title>题目</title><p>完整题面文字完整题面文字完整题面文字完整题面文字。</p><div class="CodeMirror"></div><textarea>int main(){return 0;}</textarea>');
  dom.window.document.querySelector('.CodeMirror').CodeMirror={getValue:()=> 'int main(){return 0;}'};
  dom.window.monaco={editor:{getModels:()=>[{getValue:()=> 'int main(){return 1;}'}]}};
  assert.equal(extract(dom).candidates.length,2);dom.window.close();
});
test('five problem sections are separated and runtime is excluded from the problem',()=>{
  const dom=page(`<title>字符串最大跨距</title><nav>课程 作业 计算概论</nav><main>
    <div><b>题目描述：</b></div><p>给定字符串，求两个子串之间的最大跨距。</p>
    <h3>关于输入</h3><p>输入一行字符串，以逗号分隔。</p>
    <h3>关于输出</h3><p>输出一个整数，不存在时输出 -1。</p>
    <h3>例子输入</h3><pre>  abcd,ab,cd\nnext line\n</pre>
    <h3>例子输出</h3><pre>0\n</pre>
    <section><h3>运行界面</h3><label>输入</label><textarea id="stdin">real input</textarea><label>输出</label><pre id="stdout">actual output</pre><pre id="stderr">runtime error</pre><span role="status">退出码 1</span></section>
    </main>`);
  const result=extract(dom);
  assert.match(result.problem.description,/给定字符串/);assert.match(result.problem.input,/逗号/);assert.match(result.problem.output,/-1/);
  assert.equal(result.problem.sampleInput,'  abcd,ab,cd\nnext line\n');assert.equal(result.problem.sampleOutput,'0\n');
  assert.equal(result.runtime.input,'real input');assert.equal(result.runtime.output,'actual output');assert.equal(result.runtime.error,'runtime error');assert.equal(result.runtime.status,'退出码 1');
  assert.doesNotMatch(result.statement,/课程|actual output|runtime error|退出码/);assert.equal(result.missingSections.length,0);assert.equal(result.needsVerification,false);
  dom.window.close();
});
test('execution output and hints stop sample output even without a runtime heading',()=>{
  const dom=page(`<title>题目</title><main>
    <h3>题目描述</h3><p>读取两个整数并输出它们的和，用于检查分区。</p>
    <h3>关于输入</h3><p>两个整数。</p><h3>关于输出</h3><p>整数和。</p>
    <h3>例子输入</h3><pre>1 2\n</pre><h3>例子输出</h3><pre>3\n</pre>
    <div class="toolbar"><strong>执行输出：</strong></div><pre>ACTUAL: 7\n</pre>
    <div><span>提示信息：</span></div><pre>HINT: compilation finished\n</pre>
    </main>`);
  const result=extract(dom);
  assert.equal(result.problem.sampleOutput,'3\n');
  assert.equal(result.runtime.output,'ACTUAL: 7\n');
  assert.equal(result.runtime.hints,'HINT: compilation finished\n');
  assert.doesNotMatch(result.statement,/ACTUAL|HINT|执行输出|提示信息/);
  assert.doesNotMatch(result.runtime.output,/HINT/);assert.doesNotMatch(result.runtime.hints,/ACTUAL/);
  dom.window.close();
});
test('heading-like words inside sample code never split the sample',()=>{
  const dom=page('<h3>例子输出</h3><pre><span>执行输出</span>\n<span>提示信息</span>\nexpected text</pre><h3>执行输出</h3><pre>real output</pre><h3>提示信息</h3><p>real hint</p>');
  const result=extract(dom);
  assert.equal(result.problem.sampleOutput,'执行输出\n提示信息\nexpected text');
  assert.equal(result.runtime.output,'real output');assert.equal(result.runtime.hints,'real hint');
  dom.window.close();
});
test('current PKU stable IDs exclude navigation and problem hints from the combined runtime panel',()=>{
  const dom=page('<h1>真实结构夹具</h1><div id="div_problem_description"><h4>题目描述</h4><p id="problemDescription">给定一个非负整数，计算它的实际位数。</p><h4>关于输入</h4><p id="aboutInput">一行整数</p><h4>关于输出</h4><p id="aboutOutput">实际位数</p><h4>例子输入</h4><span id="sampleInput"><pre>  05\n</pre></span><h4>例子输出</h4><span id="sampleOutput"><pre>1\n</pre></span><h4>提示信息</h4><p id="problemHint">长度不超过20</p></div><textarea id="stdin">05</textarea><div id="outputdiv"><h4>执行输出和提示信息</h4><pre id="output"><span class="testing title">Testing</span>actual output and hints</pre></div><span id="hintStatus">执行结果已返回</span><div>提交程序 提交记录 编辑修改</div>');
  const result=extract(dom);assert.match(result.problem.description,/长度不超过20/);assert.equal(result.problem.input,'一行整数');assert.equal(result.problem.sampleOutput,'1\n');assert.equal(result.problem.sampleInput,'  05\n');
  assert.equal(result.runtime.output,'');assert.equal(result.runtime.hints,'');assert.match(result.runtime.text,/actual output and hints/);assert.match(result.runtime.status,/Testing/);
  assert.doesNotMatch(result.statement,/actual output|提交程序/);assert.doesNotMatch(result.runtime.text,/长度不超过20|提交记录/);dom.window.close();
});
test('page UI previews sections and submits runtime separately',async()=>{
  const dom=page('<title>题目</title><p>页面题目。</p>');let messageHandler;const sent=[];let ui;
  const attach=dom.window.HTMLElement.prototype.attachShadow;
  dom.window.HTMLElement.prototype.attachShadow=function(opts){ui=attach.call(this,{...opts,mode:'open'});return ui;};
  dom.window.chrome={runtime:{connect:()=>({onDisconnect:{addListener(){}},onMessage:{addListener(fn){messageHandler=fn;}},postMessage:m=>sent.push(m)})},storage:{local:{get:async()=>({}),set:async()=>{}}}};
  dom.window.eval(await fs.readFile(new URL('../extension/content.js',import.meta.url),'utf8'));
  ui.getElementById('launch').click();assert.ok(sent.some(m=>m.type==='extract'));
  const problem={description:'输入两个整数，输出它们的和。',input:'输入范围为零到一百。',output:'一个整数',sampleInput:'1 2',sampleOutput:'3'};
  await messageHandler({type:'capture',capture:{url,title:'测试题',problem,runtime:{input:'2 3',output:'5',hints:'编译完成'},statement:'题面兼容文本',candidates:[{source:'ace:0',label:'Ace',value:'int main(){return 0;}'}]}});
  assert.equal(ui.getElementById('sampleInput').value,'1 2');assert.equal(ui.getElementById('runOutput').value,'5');
  assert.equal(sent.filter(m=>m.type==='save').length,0); // first extraction never automatically spends quota
  ui.getElementById('run').click();await new Promise(r=>setTimeout(r,0));
  const firstSave=sent.find(m=>m.type==='save');
  assert.deepEqual(Object.keys(firstSave.capture).sort(),['code','problem','runtime','standard','title','url']);
  assert.equal(firstSave.capture.problem.sampleOutput,'3');assert.equal(firstSave.capture.runtime.output,'5');
  assert.equal(firstSave.capture.runtime.hints,'编译完成');
  const first={id:'a'.repeat(64),title:'测试题',createdAt:'2026-10-16T00:00:00Z',status:'queued'};
  await messageHandler({type:'saved',requestType:'save',...first});
  assert.equal(ui.getElementById('run').disabled,false);assert.equal(ui.getElementById('refresh').disabled,false);
  ui.getElementById('code').value='int main(){return 1;}';ui.getElementById('run').click();
  assert.equal(sent.filter(m=>m.type==='save').length,2); // second save precedes the first report
  await messageHandler({type:'saved',requestType:'finish',...first,finalizationId:'test-final'});
  assert.equal(ui.getElementById('run').disabled,true); // automatic AC archive never unlocks a separate in-flight save
  assert.match(ui.getElementById('archiveState').textContent,/AC/);
  await messageHandler({type:'review_status',...first,status:'complete',analysis:'旧报告'});
  assert.equal(ui.getElementById('run').disabled,true); // old report never unlocks an unacknowledged new save
  await messageHandler({type:'saved',requestType:'save',id:'b'.repeat(64),title:'另一版本',createdAt:'2026-10-16T00:01:00Z',status:'queued'});
  const firstRow=[...ui.getElementById('jobs').children].find(row=>row.textContent.includes('aaaaaaa'));
  firstRow.querySelector('button').click();
  await messageHandler({type:'review_status',...first,status:'complete',analysis:'模型报告 <script>不会执行</script>'});
  assert.equal(ui.getElementById('report').querySelector('script'),null);
  assert.match(ui.getElementById('state').textContent,/保存/);dom.window.close();
});
