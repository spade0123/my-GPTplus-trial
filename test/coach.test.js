import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { ROOT, CODE_ROOT, COURSE, validateUrl, parsePage, fetchPage, inspectCode, readCode, compilerCheck } from '../src/core.js';

test('URL allowlist rejects external hosts, credentials and action endpoints', () => {
  assert.equal(validateUrl(COURSE), COURSE);
  assert.equal(validateUrl('https://programming.pku.edu.cn/course/probset/cc6dad104893441ca01fbbb1bc7b5e19/'),'https://programming.pku.edu.cn/course/probset/cc6dad104893441ca01fbbb1bc7b5e19/');
  for (const url of ['https://example.com/', 'http://programming.pku.edu.cn/course/abc/', 'https://programming.pku.edu.cn/submit/', 'https://user:pass@programming.pku.edu.cn/course/abc/', 'https://programming.pku.edu.cn/course/abc/?action=delete']) assert.throws(()=>validateUrl(url));
});
test('actual PKU DOM format yields assignment title, group and date', () => {
  const page = parsePage('<html><title>课程</title><body><div class="bar">当前作业</div><div class="probset"><div class="rbox" id="cc6dad104893441ca01fbbb1bc7b5e19"><span class="title">练习一</span><span class="closeTime">2026-10-20 00:00:00.0</span></div></div></body></html>', COURSE);
  assert.equal(page.assignments[0].title,'练习一');
  assert.equal(page.assignments[0].section,'当前作业');
  assert.equal(page.assignments[0].timezone,'Asia/Shanghai');
  assert.match(page.assignments[0].url,/\/probset\//);
});
test('PKU access error is recognized as authentication requirement', () => {
  assert.equal(parsePage('<body><div id="errorMessage">您还未登录，未登录用户不能访问课程题集，请您登录后访问！</div></body>',COURSE).loginRequired, true);
});
test('anonymous site handshake uses only PG_client and follows allowlisted redirects', async () => {
  let calls=0;
  const page=await fetchPage(COURSE,async(url,opts)=>{
    calls++;
    assert.equal(url,COURSE);
    if(calls===1) return new Response(null,{status:302,headers:{location:COURSE,'set-cookie':'PG_client=test; Path=/; Secure'}});
    assert.equal(opts.headers.Cookie,'PG_client=test');
    return new Response('<html><title>课程</title><body>练习</body></html>',{headers:{'content-type':'text/html'}});
  });
  assert.equal(calls,2);
  assert.equal(page.title,'课程');
  await assert.rejects(fetchPage(COURSE,async()=>new Response(null,{status:302,headers:{location:'https://example.com/'}})),/允许范围/);
  let loops=0;
  await assert.rejects(fetchPage(COURSE,async()=>{loops++;return new Response(null,{status:302,headers:{location:COURSE}});}),/302/);
  assert.equal(loops,4);
});
test('comments and literals do not create warnings; source line is retained', () => {
  assert.equal(inspectCode('// int x;\nconst char* s="int y; std::endl";\nauto r=R"tag(int z;)tag";').findings.length,0);
  const findings=inspectCode('// comment\nint sum;\nint main(){}').findings;
  assert.equal(findings[0].line,2);
  assert.equal(findings[0].confidence,'待验证');
});
test('local source traversal and non-C++ files are denied', async () => {
  await assert.rejects(readCode('../src/server.js'), /目录内/);
  await fs.mkdir(CODE_ROOT,{recursive:true});const name=`test-${process.pid}-${Date.now()}.cpp`,file=path.join(CODE_ROOT,name);
  await fs.writeFile(file,'int main(){return 0;}',{flag:'wx'});
  try{assert.match(await readCode(name),/int main/);}finally{await fs.unlink(file);}
});
test('compiler accepts valid C++, diagnoses invalid syntax, does not execute', async () => {
  const good=await compilerCheck('int main(){return 0;}');
  assert.equal(good.status,'passed',JSON.stringify(good));
  assert.equal(good.ranProgram,false);
  const bad=await compilerCheck('int main(){ int value = ; }');
  assert.equal(bad.status,'diagnostics');
  assert.match(bad.output,/error:/);
  const warning=await compilerCheck('int main(){int x = 3.5; return x;}');
  assert.equal(warning.status,'passed');
  assert.match(warning.output,/warning:/);
});
test('real MCP stdio handshake, tool validation, analysis, prompt and review persistence', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(),'pku-coach-test-'));
  const client = new Client({name:'pku-coach-tests',version:'1.0.0'});
  try {
    await client.connect(new StdioClientTransport({command:process.execPath,args:[path.join(ROOT,'src/server.js')],env:{...process.env,PKU_DATA_DIR:temp},stderr:'pipe'}));
    const tools=await client.listTools();
    assert.equal(tools.tools.length,11);
    assert.equal(tools.tools.some(t=>/sync|upload|github/.test(t.name)),false);
    const invalid=await client.callTool({name:'analyze_cpp',arguments:{}});
    assert.equal(invalid.isError,true);
    const both=await client.callTool({name:'analyze_cpp',arguments:{code:'int main(){}',file:'example.cpp'}});
    assert.equal(both.isError,true);
    const result=await client.callTool({name:'analyze_cpp',arguments:{code:'int main(){ int sum; return sum; }',statement:'演示：输出一个整数'}});
    assert.equal(result.isError,undefined);
    const data=JSON.parse(result.content[0].text);
    assert.equal(data.missingStatement,false);
    assert.equal(data.compiler.ranProgram,false);
    assert.ok(data.findings.some(x=>x.topic==='initialization'));
    const prompt=await client.getPrompt({name:'review_homework',arguments:{focus:'边界'}});
    assert.match(prompt.messages[0].content.text,/边界/);
    const currentCode='#include <iostream>\nusing namespace std;\nint main(){int x;cin>>x;cout<<x+1;}';
    const hintPrompt=await client.getPrompt({name:'hint_homework',arguments:{code:currentCode,statement:'读取一个整数，输出原来的整数。'}});
    assert.match(hintPrompt.messages[0].content.text,/实际行号/);assert.ok(hintPrompt.messages[0].content.text.includes(JSON.stringify(currentCode)));
    const chat=JSON.parse((await client.callTool({name:'code_help',arguments:{mode:'discussion',code:currentCode,question:'我这里的 x+1 应该怎样修改？'}})).content[0].text);
    assert.equal(chat.capture.code,currentCode);assert.match(chat.guide,/本轮当前代码/);
    const id=chat.requestId;
    const savedReply=await client.callTool({name:'save_code_help_reply',arguments:{id,answer:'你现在的 cout << x+1 比题目要求多加了 1，先在这份代码中去掉 +1，再用输入 2 检查是否输出 2。'}});
    assert.equal(savedReply.isError,undefined);
    const history=JSON.parse((await client.callTool({name:'review_history',arguments:{includeSource:true}})).content[0].text);
    assert.equal(history.codeHelp.total,2);const savedChat=history.codeHelp.records.find(r=>r.id===id);
    assert.equal(savedChat.code,currentCode);assert.equal(savedChat.status,'complete');assert.match(savedChat.answer,/去掉/);
    const hiddenSource=JSON.parse((await client.callTool({name:'review_history',arguments:{}})).content[0].text);
    assert.ok(hiddenSource.codeHelp.records.every(r=>r.code===undefined));
    await assert.rejects(client.getPrompt({name:'hint_homework',arguments:{}}),/本轮完整/);
    await assert.rejects(client.getPrompt({name:'discuss_homework',arguments:{code:currentCode,file:'example.cpp',question:'怎么改？'}}),/只选一项/);
    const empty=JSON.parse((await client.callTool({name:'learning_plan',arguments:{}})).content[0].text);
    assert.equal(empty.reviews,0);
    await client.callTool({name:'save_review',arguments:{title:'测试',topics:['bounds','bounds'],evidence:'第 3 行需要检查范围',next_step:'手算 n=1'}});
    const plan=JSON.parse((await client.callTool({name:'learning_plan',arguments:{}})).content[0].text);
    assert.equal(plan.reviews,1);
    assert.equal(plan.priorities[0].count,1);
  } finally { await client.close(); await fs.rm(temp,{recursive:true,force:true}); }
});
