import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {saveCodeQuestion,saveCodeReply,codeHelpHistory} from '../src/code-help.js';
async function isolated(fn){const directory=await fs.mkdtemp(path.join(os.tmpdir(),'pku-code-help-'));process.env.PKU_DATA_DIR=directory;try{await fn(directory);}finally{delete process.env.PKU_DATA_DIR;await fs.rm(directory,{recursive:true,force:true});}}
const evidence=()=>({source:'provided-code',snapshotId:null,question:'为什么这里多加了 1？',capture:{code:'int main(){int x=2;return x+1;}',statement:'返回原来的整数。',title:'自拟验证题',url:''}});
test('each local question freezes its own code and reply; rewriting a reply preserves the prior answer',()=>isolated(async directory=>{
  const current=evidence(),first=await saveCodeQuestion('discussion',current);current.capture.code='int main(){return 0;}';
  const second=await saveCodeQuestion('discussion',current);assert.notEqual(first.id,second.id);
  await saveCodeReply({id:first.id,answer:'在当前版本的 return x+1 中，多加了 1。'});
  assert.equal((await saveCodeReply({id:first.id,answer:'在当前版本的 return x+1 中，多加了 1。'})).reused,true);
  await saveCodeReply({id:first.id,answer:'保留原来的 x，局部去掉 +1 后再验证。'});
  const saved=JSON.parse(await fs.readFile(path.join(directory,'code-help',first.id+'.json'),'utf8'));
  assert.equal(saved.code,evidence().capture.code);assert.equal(saved.previousAnswers.length,1);assert.match(saved.previousAnswers[0].answer,/多加了/);
  const history=await codeHelpHistory({includeSource:true});assert.equal(history.total,2);assert.equal(history.records.find(r=>r.id===second.id).status,'awaiting_reply');
  assert.ok((await codeHelpHistory()).records.every(r=>r.code===undefined&&r.statement===undefined));
}));
test('a newly saved reply remains visible to later reports even when its question was created earlier',()=>isolated(async directory=>{
  const saved=await saveCodeQuestion('hint',evidence()),file=path.join(directory,'code-help',saved.id+'.json');
  await fs.writeFile(file,JSON.stringify({...saved,createdAt:'2000-01-01T00:00:00.000Z',updatedAt:'2000-01-01T00:00:00.000Z'}));
  const since=new Date(Date.now()-10000).toISOString();assert.equal((await codeHelpHistory({since})).total,0);
  await saveCodeReply({id:saved.id,answer:'对照当前源码，先检查 return 的表达式。'});
  assert.equal((await codeHelpHistory({since})).total,1);
  const history=await codeHelpHistory();assert.equal((await codeHelpHistory({until:history.records[0].updatedAt})).total,0);
}));
test('invalid references and damaged original code cannot be acknowledged as saved replies',()=>isolated(async directory=>{
  await assert.rejects(saveCodeReply({id:'../../other-file',answer:'test'}),/ID 无效/);
  const saved=await saveCodeQuestion('hint',evidence()),file=path.join(directory,'code-help',saved.id+'.json');
  const altered={...saved,code:'changed code'};await fs.writeFile(file,JSON.stringify(altered));
  await assert.rejects(saveCodeReply({id:saved.id,answer:'must not be saved'}),/核对失败/);
  assert.equal(JSON.parse(await fs.readFile(file,'utf8')).answer,undefined);
}));
