import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {installIdeProtection} from '../extension/ide-protection.js';

const url='https://programming.pku.edu.cn/probset/d0ef3e0f7fa5481d896f9a07254c8ecd/b672274bc30a4243af36f8968e8371b4/ide.do';
const source=await fs.readFile(new URL('../extension/site-cache-guard.js',import.meta.url),'utf8');
const key='problem_b672274bc30a4243af36f8968e8371b4',listKey='problemlist_d0ef3e0f7fa5481d896f9a07254c8ecd';
function fullPage(pageUrl=url){
  const dom=new JSDOM('<div id="problemDescription"></div><textarea id="editor"></textarea><button id="btnTest">测试</button>',{url:pageUrl,runScripts:'outside-only',storageQuota:2048});
  const w=dom.window;
  w.localStorage.setItem('_backup_old','existing student source');
  w.localStorage.setItem('solution_old','existing submission');
  w.localStorage.setItem('filler','x'.repeat(1800));
  let used=0;for(let i=0;i<w.localStorage.length;i++){const k=w.localStorage.key(i);used+=k.length+w.localStorage.getItem(k).length;}
  w.localStorage.setItem('padding','x'.repeat(2048-used-'padding'.length));
  return dom;
}
function records(storage){return Object.fromEntries(Array.from({length:storage.length},(_,i)=>{const k=storage.key(i);return [k,storage.getItem(k)];}));}

test('full website problem cache no longer aborts rendering/code loading/Test setup; all prior data is unchanged',()=>{
  const dom=fullPage(),w=dom.window;let requests=0;
  try{
    const old=records(w.localStorage);
    // Matches the public website's callback order: cache first, then render,
    // then the continuation that loads code and binds the Test handler.
    const load=()=>{
      w.localStorage.setItem(key,JSON.stringify({id:key.slice(8),description:'题面正文'}));
      w.document.getElementById('problemDescription').textContent='题面正文';
      w.localStorage.setItem(listKey,JSON.stringify({id:listKey.slice(12),title:'题集'}));
      w.document.getElementById('editor').value='int main(){return 0;}';
      w.document.getElementById('btnTest').onclick=()=>requests++;
    };
    assert.throws(load,e=>e.name==='QuotaExceededError');
    assert.equal(w.document.getElementById('problemDescription').textContent,'');
    w.document.getElementById('btnTest').click();assert.equal(requests,0);
    w.eval(source);assert.doesNotThrow(load);
    assert.equal(w.document.getElementById('problemDescription').textContent,'题面正文');
    assert.equal(w.document.getElementById('editor').value,'int main(){return 0;}');
    assert.equal(requests,0); // setup never runs/submits a student program
    w.document.getElementById('btnTest').click();assert.equal(requests,1);
    assert.deepEqual(records(w.localStorage),old);
    assert.equal(w.__pkuCoachCacheGuard.skippedCacheWrites,2);
    assert.equal(w.localStorage.getItem(key),null); // no false claim of persistence
    const wrapped=w.Storage.prototype.setItem;w.eval(source);assert.equal(w.Storage.prototype.setItem,wrapped);
  }finally{dom.window.close();}
});

test('backup, source, authentication, arbitrary and session writes still fail normally; non-quota errors survive',()=>{
  const dom=fullPage(),w=dom.window;
  try{
    w.eval(source);
    for(const k of ['_backup_new','solution_new','data_abcdef','user_123','unknown',key+'-other'])assert.throws(()=>w.localStorage.setItem(k,'x'),e=>e.name==='QuotaExceededError');
    w.sessionStorage.setItem('filler','x'.repeat(2048-'filler'.length));
    assert.throws(()=>w.sessionStorage.setItem(key,'x'),e=>e.name==='QuotaExceededError');
    assert.throws(()=>w.Storage.prototype.setItem.call({},key,'x'),e=>e.name==='TypeError');
    assert.equal(w.__pkuCoachCacheGuard.skippedCacheWrites,0);
  }finally{dom.window.close();}
  const unrelated=new JSDOM('',{url,runScripts:'outside-only'});
  try{
    const w=unrelated.window,error=new w.DOMException('storage blocked','SecurityError');
    w.Storage.prototype.setItem=function(){throw error;};w.eval(source);
    assert.throws(()=>w.localStorage.setItem(key,'x'),e=>e===error);
  }finally{unrelated.window.close();}
});

test('successful caches persist normally and other pages are not patched',()=>{
  const dom=new JSDOM('',{url,runScripts:'outside-only'});
  try{
    dom.window.eval(source);dom.window.localStorage.setItem(key,'cache');
    assert.equal(dom.window.localStorage.getItem(key),'cache');assert.equal(dom.window.__pkuCoachCacheGuard.skippedCacheWrites,0);
  }finally{dom.window.close();}
  const other=fullPage('https://programming.pku.edu.cn/course/abc/');
  try{const original=other.window.Storage.prototype.setItem;other.window.eval(source);assert.equal(other.window.Storage.prototype.setItem,original);}finally{other.window.close();}
});

test('cache fallback remains visible when it happened before the normal extension UI connected',()=>{
  const dom=fullPage(),w=dom.window,notices=[];
  try{
    w.eval(source);w.localStorage.setItem(key,'new cache');
    w.document.addEventListener('pku-coach-draft-notice',e=>notices.push(e.detail));
    w.eval(`(${installIdeProtection.toString()})()`);
    assert.equal(notices[0].kind,'cache');assert.match(notices[0].message,/现有草稿未删除/);
    assert.match(notices[0].message,/不代表当前代码已保存/);
  }finally{dom.window.close();}
});

test('production only registers the three-control overlay, own question windows and legacy migration; old page hooks are unreachable',async()=>{
  const manifest=JSON.parse(await fs.readFile(new URL('../extension/manifest.json',import.meta.url),'utf8'));
  const allowed=new Set(['manifest_version','name','version','minimum_chrome_version','description','key','permissions','options_ui','action','background','host_permissions','content_scripts','web_accessible_resources']);
  for(const key of Object.keys(manifest))assert.ok(allowed.has(key),`unexpected executable or permission entry: ${key}`);
  assert.deepEqual(manifest.permissions,['scripting','sidePanel','storage','nativeMessaging']);
  assert.deepEqual(manifest.background,{service_worker:'floating-worker.js',type:'module'});
  assert.deepEqual(manifest.host_permissions,['https://programming.pku.edu.cn/*']);
  assert.deepEqual(manifest.web_accessible_resources,[{resources:['assist-window.html'],matches:['https://programming.pku.edu.cn/*']}]);
  assert.deepEqual(manifest.content_scripts,[{matches:['https://programming.pku.edu.cn/probset/*/*/ide.do*'],js:['floating-buttons.js'],run_at:'document_idle'}]);
  assert.equal(manifest.minimum_chrome_version,'116');
  assert.deepEqual(manifest.options_ui,{page:'storage-transfer.html',open_in_tab:true});
  assert.deepEqual(manifest.action,{default_title:'显示右下角学习教练按钮'});
  const launcher=await fs.readFile(new URL('../extension/launcher.html',import.meta.url),'utf8');
  assert.doesNotMatch(launcher,/<script|https?:\/\//i);
  assert.deepEqual([...launcher.matchAll(/href="([^"]+)"/g)].map(m=>m[1]),['storage-transfer.html']);
  const html=await fs.readFile(new URL('../extension/storage-transfer.html',import.meta.url),'utf8');
  assert.deepEqual([...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map(m=>m[1]),['storage-transfer-ui.js']);
  for(const name of ['storage-transfer-ui.js','transfer-records.js','legacy-data-areas.js']){
    const script=await fs.readFile(new URL('../extension/'+name,import.meta.url),'utf8');
    assert.doesNotMatch(script,/chrome\.(?:scripting|tabs|debugger|browsingData)|\b(?:fetch|eval)\s*\(|chrome\.storage\.[\w.]+\.(?:set|clear)\s*\(|\blocalStorage\b|\bstorage\.set\s*\(|\bstore\.(?:put|add|clear)\s*\(/);
  }
  assert.equal(manifest.manifest_version,3);assert.ok(manifest.key);
});

test('guard signals pressure before the estimated watermark and on actual source quota failures without swallowing them',()=>{
  const dom=new JSDOM('',{url,runScripts:'outside-only'}),w=dom.window;let signals=0;
  try{
    w.localStorage.setItem(key,'x'.repeat(2*1024*1024));
    w.document.addEventListener('pku-coach-storage-pressure',()=>signals++);
    w.eval(source);assert.equal(signals,1);assert.equal(w.__pkuCoachCacheGuard.quotaFailures,0);
  }finally{w.close();}
  const full=fullPage(),f=full.window;let quotaSignals=0;
  try{
    f.document.addEventListener('pku-coach-storage-pressure',()=>quotaSignals++);f.eval(source);
    assert.throws(()=>f.localStorage.setItem('_backup_new','source'),e=>e.name==='QuotaExceededError');
    assert.equal(quotaSignals,1);assert.equal(f.__pkuCoachCacheGuard.quotaFailures,1);assert.equal(f.__pkuCoachCacheGuard.skippedCacheWrites,0);
    assert.equal(f.localStorage.getItem('_backup_old'),'existing student source');
  }finally{f.close();}
});
