// Optional live smoke check; not included in the offline unit test suite.
import assert from 'node:assert/strict';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { ROOT } from '../src/core.js';
const client = new Client({name:'live-verification',version:'1.0.0'});
try {
  await client.connect(new StdioClientTransport({command:process.execPath,args:[path.join(ROOT,'src/server.js')],env:{...process.env},stderr:'pipe'}));
  const call=async(name,args={})=>{
    const r=await client.callTool({name,arguments:args});
    assert.notEqual(r.isError,true,JSON.stringify(r));
    return JSON.parse(r.content[0].text);
  };
  const list=await call('list_assignments');
  assert.ok(list.assignments.length>0);
  const locked=await call('read_course_page',{url:'https://programming.pku.edu.cn/probset/cc6dad104893441ca01fbbb1bc7b5e19/'});
  const demo=await call('analyze_cpp',{file:'example.cpp',statement:'演示：输出 1 到 10 的整数之和。'});
  assert.equal(demo.compiler.status,'passed');
  assert.ok(demo.findings.some(x=>x.topic==='initialization'));
  console.log(JSON.stringify({course:list.title,assignments:list.assignments.length,checkedProblemSetRequiresLogin:locked.loginRequired,exampleCompilerStatus:demo.compiler.status,exampleWarnings:demo.compiler.output,heuristicTopics:demo.findings.map(x=>x.topic)},null,2));
} finally { await client.close(); }
