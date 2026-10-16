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
