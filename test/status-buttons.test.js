import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
test('three status buttons stay visible when focusing any coach panel, library, other editor or no editor, without reading source',async()=>{
  const buttons=[],commands=new Map();let changed,reads=0;
  const document={languageId:'cpp',isClosed:false,getText(){reads++;return 'int main(){}';}},editor={document};
  const vscode={StatusBarAlignment:{Right:2},workspace:{isTrusted:false},commands:{registerCommand:(name,callback)=>{commands.set(name,callback);return {dispose(){}};}},window:{activeTextEditor:editor,createOutputChannel:()=>({appendLine(){},dispose(){}}),onDidChangeActiveTextEditor:callback=>{changed=callback;return {dispose(){}};},createStatusBarItem:()=>{const b={visible:false,show(){this.visible=true;},hide(){this.visible=false;},dispose(){}};buttons.push(b);return b;}}};
  const module={exports:{}},source=await fs.readFile(new URL('../vscode-extension/extension.cjs',import.meta.url),'utf8');
  const mocked=name=>name==='vscode'?vscode:name==='./problem-view.cjs'?{ProblemView:class{}}:name.startsWith('./')?require('../vscode-extension/'+name.slice(2)):require(name);
  vm.runInNewContext(source,{require:mocked,module,process});module.exports.activate({subscriptions:[],extensionPath:process.cwd()});
  assert.deepEqual(buttons.map(b=>b.text),['测试运行','提示','交流']);
  for(const active of [undefined,{document:{languageId:'markdown'}},editor,undefined]){vscode.window.activeTextEditor=active;changed(active);assert(buttons.every(b=>b.visible));}
  assert.equal(reads,0);assert.equal(commands.has('openjudgeCoach.testRun'),true);
  await new Promise(resolve=>setImmediate(resolve));
});
