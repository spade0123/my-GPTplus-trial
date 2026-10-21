import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {JSDOM} from 'jsdom';

const scripts=await Promise.all(['vendor/marked/marked.umd.js','vendor/katex/katex.min.js','report-renderer.js'].map(file=>fs.readFile(new URL(`../extension/${file}`,import.meta.url),'utf8')));
function page(markdown) {
  const dom=new JSDOM('<!doctype html><article></article>',{runScripts:'outside-only'});
  for(const script of scripts)dom.window.eval(script);
  const report=dom.window.document.querySelector('article');
  dom.window.PkuReportRenderer.render(report,markdown);
  return {dom,report};
}

test('Markdown formats emphasis, inline code, nested lists, tables, and fenced C++ without treating code as math',()=>{
  const source=['## 学习建议','**重点**、*说明*和 `std::getline`。','',
    '- 第一项','  - 子项 `a < b`','',
    '| 头文件 | 用法 |','| --- | --- |','| `<algorithm>` | **排序** $O(n \\log n)$ |','',
    '```cpp','#include <iostream>','const char* s = "$not_math$";','```'].join('\n');
  const {dom,report}=page(source);
  try {
    assert.equal(report.querySelector('strong').textContent,'重点');
    assert.equal(report.querySelector('em').textContent,'说明');
    assert.equal(report.querySelector('p code').textContent,'std::getline');
    assert.ok(report.querySelector('ul ul li'));
    assert.equal(report.querySelectorAll('table tr').length,2);
    assert.equal(report.querySelector('td code').textContent,'<algorithm>');
    assert.equal(report.querySelectorAll('.katex').length,1);
    assert.match(report.querySelector('pre code').textContent,/#include <iostream>/);
    assert.match(report.querySelector('pre code').textContent,/\$not_math\$/);
  } finally {dom.window.close();}
});

test('all four math delimiters preserve the surrounding report and incomplete formulas do not swallow later headings',()=>{
  const {dom,report}=page(String.raw`行内 $n^2$ 与 \(m+1\)。

$$
\frac{n(n+1)}{2}
$$
公式之后。

\[
\sum_{i=1}^{n} i
\]
末尾仍保留。

$$
未闭合公式

## 后续板块`);
  try {
    assert.equal(report.querySelectorAll('.math-inline .katex').length,2);
    assert.equal(report.querySelectorAll('.math-block .katex-display').length,2);
    assert.match(report.textContent,/公式之后。/);assert.match(report.textContent,/末尾仍保留。/);
    assert.equal(report.querySelector('h2').textContent,'后续板块');
  } finally {dom.window.close();}
});

test('untrusted Markdown cannot add executable HTML, unsafe links, or remote images',()=>{
  const {dom,report}=page(['<script>window.pwned=true</script>','',
    '<img src="https://example.com/track" onerror="window.pwned=true">','',
    '[危险](javascript:alert(1))','', '![远程图片](https://example.com/pixel)', '',
    '[文档](https://example.com/docs)', '', '$\\href{javascript:alert(1)}{x}$'].join('\n'));
  try {
    assert.equal(report.querySelector('script,img,iframe,object'),null);
    assert.equal(report.querySelector('a[href^="javascript:"]'),null);
    assert.equal(dom.window.pwned,undefined);
    assert.equal(report.querySelector('a[href="https://example.com/docs"]').rel,'noopener noreferrer');
    assert.match(report.textContent,/远程图片/);
  } finally {dom.window.close();}
});

test('code highlighting preserves exact C++ source and copying writes only the clicked block',async()=>{
  const code='#include <iostream>\nusing namespace std;\nint main(){\n\tint cnt=1\'000;\n\tconst char* s=R"tag(<img src=x onerror="bad()"> // text)tag";\n\tcout<<cnt+1;\n}\n// original source comment';
  const {dom,report}=page('片段 `cnt+1`：\n\n```cpp\n'+code+'\n```\n\n```text\n1 2\n```');
  const copied=[];Object.defineProperty(dom.window.navigator,'clipboard',{value:{writeText:async text=>copied.push(text)}});
  try{
    const block=report.querySelector('pre code');assert.equal(block.textContent,code);assert(block.querySelector('.syntax-keyword'));assert(block.querySelector('.syntax-type'));assert(block.querySelector('.syntax-string'));assert.equal(block.querySelector('.syntax-number').textContent,"1'000");
    assert.equal(report.querySelector('img,script'),null);assert.equal(report.querySelector('p code').textContent,'cnt+1');assert.equal(copied.length,0);
    const buttons=[...report.querySelectorAll('.code-copy')];await buttons[0].onclick();assert.deepEqual(copied,[code]);assert.equal(buttons[0].textContent,'已复制');
    await buttons[1].onclick();assert.deepEqual(copied,[code,'1 2']);
    dom.window.navigator.clipboard.writeText=async()=>{throw new Error('denied');};await buttons[0].onclick();assert.equal(buttons[0].textContent,'复制失败');
  }finally{dom.window.close();}
});

test('problem sections in the hint window are collapsed without hiding the leading program',()=>{
  const {dom,report}=page('');
  try{
    const panel=dom.window.document.createElement('section');panel.id='hintPanel';report.replaceWith(panel);panel.append(report);
    dom.window.PkuReportRenderer.render(report,'## 完整参考程序\n```cpp\nint main(){return 0;}\n```\n\n## 解题思路\n推导。\n\n## 原题目\n### 题目描述\n原文。\n\n### 例子输入\n```text\n1 2\n```');
    const folded=report.querySelector('details.problem-section');assert(folded);assert.equal(folded.open,false);assert.match(folded.textContent,/原文/);assert.equal(report.querySelector('h2').textContent,'完整参考程序');assert(!folded.contains(report.querySelector('pre')));
  }finally{dom.window.close();}
});

test('chat nested in the hint panel retains ordinary dialogue rendering instead of folding it as a reference problem',()=>{
  const {dom,report}=page('');
  try{
    const hint=dom.window.document.createElement('section');hint.id='hintPanel';
    const chat=dom.window.document.createElement('details');chat.id='chatPanel';chat.open=true;
    report.replaceWith(hint);hint.append(chat);chat.append(report);
    dom.window.PkuReportRenderer.render(report,'## 原题目\n这里是回答问题所需的题意说明。\n\n```cpp\ncout<<cnt+1;\n```');
    assert.equal(report.querySelector('details.problem-section'),null);assert.equal(report.querySelector('pre code').textContent,'cout<<cnt+1;');assert(report.querySelector('.code-copy'));
  }finally{dom.window.close();}
});
