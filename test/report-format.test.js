import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {REPORT_SECTIONS,formatModelReport} from '../src/report-format.js';

const makeReport=()=>({sections:Object.fromEntries(REPORT_SECTIONS.map(({key},i)=>[key,`第 ${i+1} 板块正文。`])),topics:['io','stl'],evidence:'第 4 行输入读取证据。',next_step:'用带空格的一行输入验证 getline。'});
test('model schema and formatter require all six sections and preserve reference C++ plus metadata',async()=>{
  const schema=JSON.parse(await fs.readFile(new URL('../src/report-sections-schema.json',import.meta.url),'utf8'));
  assert.deepEqual(schema.properties.sections.required,REPORT_SECTIONS.map(s=>s.key));
  const raw=makeReport();raw.sections.reference='思路说明。\n\n```cpp\n#include <iostream>\nint main(){ std::cout << 0; }\n```';
  const report=formatModelReport(raw);
  assert.deepEqual(report.markdown.match(/^## .+$/gm),REPORT_SECTIONS.map(({title},i)=>`## ${i+1}. ${title}`));
  assert.ok(report.markdown.includes(raw.sections.reference));
  raw.sections.reference='## 参考思路\n\n```cpp\n// 标题样式的源码必须保留\n# example\n```';
  const nested=formatModelReport(raw).markdown;
  assert.equal(nested.match(/^## .+$/gm).length,6);assert.match(nested,/### 参考思路/);assert.match(nested,/\n# example\n/);
  assert.deepEqual(report.topics,raw.topics);assert.equal(report.evidence,raw.evidence);
  delete raw.sections.input;assert.throws(()=>formatModelReport(raw));
});
