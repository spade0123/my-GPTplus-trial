import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const realRequire=createRequire(import.meta.url);

test('Grid controls survive reload without a focused editor and recover a single visible C++ source',async()=>{
  const buttons=[];let editorChanged;
  const disposable=()=>({dispose(){}});
  const document={languageId:'cpp',isClosed:false,uri:{toString:()=> 'file:///C:/fixture/source.cpp'},fileName:'C:/fixture/source.cpp',getText:()=> 'int main(){return 0;}',version:1};
  const cpp={document,selection:{}};
  const vscode={
    window:{activeTextEditor:undefined,visibleTextEditors:[cpp],
      createOutputChannel:()=>({appendLine(){},dispose(){}}),
      createStatusBarItem:()=>{const item={shown:false,show(){this.shown=true;},hide(){this.shown=false;},dispose(){}};buttons.push(item);return item;},
      onDidChangeActiveTextEditor:fn=>{editorChanged=fn;return disposable();}},
    workspace:{isTrusted:false,workspaceFolders:[],onDidChangeWorkspaceFolders:disposable},
    commands:{registerCommand:disposable},languages:{getDiagnostics:()=>[]},StatusBarAlignment:{Right:1}
  };
  const module={exports:{}};
  const require=name=>name==='vscode'?vscode:name==='./problem-view.cjs'?{ProblemView:class{}}:name==='./rpc-client.cjs'?{RpcClient:class{}}:name==='./date-organizer.cjs'?{}:realRequire(name);
  vm.runInNewContext(await fs.readFile(new URL('../vscode-extension/extension.cjs',import.meta.url),'utf8'),{require,module,process});
  const api=module.exports.activate({subscriptions:[]});
  assert.equal(buttons.filter(item=>item.text?.startsWith('网格·')).length,4);
  assert(buttons.slice(0,4).every(item=>item.shown));
  editorChanged(undefined);
  assert(buttons.slice(0,4).every(item=>item.shown));
  vscode.window.visibleTextEditors=[cpp,{...cpp,document:{...document,uri:{toString:()=> 'file:///C:/fixture/other.cpp'}}}];
  assert.throws(()=>api.sourceFor(),/请先打开或选中/);
  vscode.window.visibleTextEditors=[cpp];
  assert.equal(api.sourceFor().uri,document.uri.toString());
  editorChanged({document:{languageId:'plaintext'}});
  assert(buttons.slice(0,4).every(item=>item.shown));
});
