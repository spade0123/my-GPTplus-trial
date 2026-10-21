// Explicit real-model smoke test: uses Codex quota, never part of npm test.
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import path from 'node:path';
import {ROOT,compilerCheck,inspectCode} from '../src/core.js';
import {runModel} from '../src/model-runner.js';
import {Report} from '../src/browser-review.js';
import {REPORT_SECTIONS} from '../src/report-format.js';
const paths=JSON.parse(await fs.readFile(path.join(ROOT,'native/paths.json'),'utf8'));
process.env.PKU_CODEX=paths.codex;process.env.PKU_CXX=paths.compiler;
const code='int main(){int sum; for(int i=1;i<=10;++i)sum+=i; return sum;}';
const report=Report.parse(await runModel({capture:{title:'模型链路演示（不是用户作业）',statement:'请检查 1 到 10 求和的初始化问题。只需简短报告。',code,standard:'c++17'},diagnostics:await compilerCheck(code),risks:inspectCode(code)}));
const headings=report.markdown.match(/^## .+$/gm);
assert.deepEqual(headings,REPORT_SECTIONS.map(({title},i)=>`## ${i+1}. ${title}`));
console.log(JSON.stringify({validReport:true,headings,topics:report.topics,reportCharacters:report.markdown.length,excerpt:report.markdown.slice(0,800)},null,2));
