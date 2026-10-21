import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {JSDOM} from 'jsdom';
const url='https://programming.pku.edu.cn/probset/'+'a'.repeat(32)+'/'+'b'.repeat(32)+'/ide.do';
const source=await fs.readFile(new URL('../extension/floating-buttons.js',import.meta.url),'utf8');
test('overlay adds exactly three own buttons; original DOM, full site storage, editor, test and submit functions remain unchanged',()=>{
  const dom=new JSDOM('<h1>原来的题目</h1><textarea id="original">原代码</textarea><button id="btnTest">平台测试</button>',{url,runScripts:'outside-only',storageQuota:1024});
  const w=dom.window,original=w.document.documentElement.outerHTML;let shadow,handler,reads=0;const sent=[];
  const attach=w.Element.prototype.attachShadow;w.Element.prototype.attachShadow=function(opts){shadow=attach.call(this,opts);return shadow;};
  const forbidden=()=>{reads++;throw new Error('Original site must not be touched');};
  w.runCode=forbidden;w.submitCode=forbidden;w.backupSourceCodeForRecovery=forbidden;
  w.localStorage.setItem('padding','x'.repeat(1017));for(const key of ['getItem','setItem','removeItem','clear'])w.Storage.prototype[key]=forbidden;
  w.chrome={runtime:{getURL:file=>'chrome-extension://test/'+file,connect:({name})=>{assert.equal(name,'pku-coach-floating');return {onMessage:{addListener:fn=>handler=fn},onDisconnect:{addListener(){}},postMessage:msg=>sent.push(msg)};}}};
  try{
    w.eval(source);const host=w.document.getElementById('pku-coach-buttons');assert(host);assert.equal(shadow.querySelectorAll('.buttons button').length,3);assert.equal(reads,0);assert.equal(sent.length,0);assert(shadow.querySelector('.panel').hidden);
    w.eval(source);assert.equal(w.document.querySelectorAll('#pku-coach-buttons').length,1);
    const buttons=[...shadow.querySelectorAll('.buttons button')];assert.deepEqual(buttons.map(b=>b.textContent),['快捷保存','提示','交流']);
    buttons[0].click();assert.equal(sent.at(-1).type,'quick_save');handler({type:'saved',actionId:sent.at(-1).actionId});assert.equal(buttons[0].textContent,'已保存');
    buttons[1].click();assert.equal(sent.at(-1).type,'open_hint');handler({type:'tool_opened',actionId:sent.at(-1).actionId,mode:'hint',frameUrl:'chrome-extension://test/assist-window.html?session=one'});
    const hint=shadow.querySelector('iframe');assert(hint);assert.equal(shadow.querySelector('.panel').hidden,false);
    shadow.querySelector('.heading button').click();assert.equal(shadow.querySelector('.panel').hidden,true);assert.equal(hint.isConnected,true);
    buttons[2].click();assert.equal(sent.at(-1).type,'open_discussion');handler({type:'tool_opened',actionId:sent.at(-1).actionId,mode:'discussion',frameUrl:hint.src});
    const chat=shadow.querySelector('iframe');assert.equal(chat,hint);assert.equal(chat.title,'C++ 代码提示与交流');
    shadow.querySelector('.heading button').click();buttons[2].click();handler({type:'tool_opened',actionId:sent.at(-1).actionId,mode:'discussion',frameUrl:chat.src});
    assert.equal(shadow.querySelector('iframe'),chat);assert.equal(chat.hidden,false);assert.equal(shadow.querySelectorAll('iframe').length,1);
    assert.equal(reads,0);assert.equal(w.runCode,forbidden);assert.equal(w.submitCode,forbidden);assert.equal(w.backupSourceCodeForRecovery,forbidden);
    const clone=w.document.documentElement.cloneNode(true);clone.querySelector('#pku-coach-buttons').remove();assert.equal(clone.outerHTML,original);assert.equal(w.document.getElementById('original').value,'原代码');
  }finally{dom.window.close();}
});
test('only IDE pages get the own controls, and the root never loads readers, observers, storage or page-wide handlers',()=>{
  const dom=new JSDOM('<h1>课程列表</h1>',{url:'https://programming.pku.edu.cn/course/abc',runScripts:'outside-only'});
  dom.window.eval(source);assert.equal(dom.window.document.getElementById('pku-coach-buttons'),null);dom.window.close();
  assert.doesNotMatch(source,/\blocalStorage\b|\bsessionStorage\b|\bindexedDB\b|MutationObserver|document\.addEventListener|window\.addEventListener|\.getValue\(|\.setValue\(|\bfetch\(/);
});
test('own hint window restores its session without generating a replacement; no sidebar is registered',async()=>{
  const manifest=JSON.parse(await fs.readFile(new URL('../extension/manifest.json',import.meta.url),'utf8'));
  assert.equal(manifest.side_panel,undefined);
  const worker=await fs.readFile(new URL('../extension/floating-worker.js',import.meta.url),'utf8');
  assert.doesNotMatch(worker,/dispatch\(session,\{type:'hint'/);assert.match(worker,/resume_context/);assert.match(worker,/session\.pending/);
  assert.match(worker,/sidePanel\.setPanelBehavior\(\{openPanelOnActionClick:false\}\)/);assert.doesNotMatch(worker,/sidePanel\.open|sidePanel\.setOptions/);
  assert.doesNotMatch(worker,/installIdeProtection|installSubmissionObserver|maintainCache|restoreEditorDraft|chrome\.storage|\blocalStorage\b|\bsessionStorage\b|chrome\.windows\.create/);
  const window=await fs.readFile(new URL('../extension/assist-window.js',import.meta.url),'utf8');
  assert.match(window,/name:'pku-coach-assist'/);assert.match(window,/send\(\{type:'resume'\}\)/);
  assert.doesNotMatch(window,/chrome\.storage|\blocalStorage\b|\bsessionStorage\b/);
});
