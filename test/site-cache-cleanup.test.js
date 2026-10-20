import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {inspectSiteStorage,readSiteCache,clearSiteCache,backupAndClearSiteCache} from '../extension/site-cache.js';
const url='https://programming.pku.edu.cn/probset/d0ef3e0f7fa5481d896f9a07254c8ecd/b672274bc30a4243af36f8968e8371b4/ide.do';
const problem='problem_b672274bc30a4243af36f8968e8371b4',list='problemlist_d0ef3e0f7fa5481d896f9a07254c8ecd';
function fixture(){const d=new JSDOM('<textarea id="editor">current unsaved code</textarea>',{url,runScripts:'outside-only'}),w=d.window;
 for(const [k,v] of Object.entries({[problem]:'cached problem',[list]:'cached list','_backup_123':'my source',solution_123:'submission',data_abc:'source hash',user_123:'account',version:'version'}))w.localStorage.setItem(k,v);
 w.sessionStorage.setItem('stdin','current input');return d;
}
function store(){const data={};return {data,get:async key=>({[key]:structuredClone(data[key])}),set:async item=>Object.assign(data,structuredClone(item))};}
test('cleanup backs up and verifies caches before removing only unchanged recoverable question keys',async()=>{
 const dom=fixture(),w=dom.window,s=store();
 try{
  const snapshot=w.eval(`(${readSiteCache.toString()})()`);assert.equal(snapshot.entries.length,2);
  w.localStorage.setItem(list,'new cache while backing up');
  const result=await backupAndClearSiteCache({storage:s,snapshot,id:'one',clear:async snap=>{
   assert.ok(s.data['pku-site-cache-backup-one']);return w.eval(`(${clearSiteCache.toString()})(${JSON.stringify(snap)})`);
  }});
  assert.equal(result.cleared,1);assert.equal(result.changed,1);assert.equal(w.localStorage.getItem(problem),null);assert.equal(w.localStorage.getItem(list),'new cache while backing up');
  for(const [k,v] of Object.entries({_backup_123:'my source',solution_123:'submission',data_abc:'source hash',user_123:'account',version:'version'}))assert.equal(w.localStorage.getItem(k),v);
  assert.equal(w.document.getElementById('editor').value,'current unsaved code');assert.equal(w.sessionStorage.getItem('stdin'),'current input');
  assert.equal(s.data['pku-site-cache-backup-one'].entries.find(e=>e.key===problem).value,'cached problem');
 }finally{dom.window.close();}
});
test('backup failure or failed verification deletes nothing; forged keys cannot enter cleanup',async()=>{
 const dom=fixture(),w=dom.window;
 try{
  const snapshot=w.eval(`(${readSiteCache.toString()})()`);let removed=false;
  for(const storage of [{get:async()=>({}),set:async()=>{throw new Error('extension full');}},{set:async()=>{},get:async()=>({})}])await assert.rejects(backupAndClearSiteCache({storage,snapshot,id:'id',clear:()=>{removed=true;}}));
  assert.equal(removed,false);assert.equal(w.localStorage.getItem(problem),'cached problem');
  assert.throws(()=>w.eval(`(${clearSiteCache.toString()})(${JSON.stringify({...snapshot,entries:[{key:'_backup_123',value:'my source'}]})})`),/备份范围无效/);
  assert.throws(()=>w.eval(`(${clearSiteCache.toString()})(${JSON.stringify({...snapshot,url:url+'other'})})`),/页面已改变/);
 }finally{dom.window.close();}
});

test('inspection measures website usage without reading session input; identical backups are reused',async()=>{
 const dom=fixture(),w=dom.window,s=store();
 try{
  w.__pkuCoachCacheGuard={pageId:'page-id',quotaFailures:3};
  const before=Object.fromEntries(Array.from({length:w.localStorage.length},(_,i)=>{const k=w.localStorage.key(i);return [k,w.localStorage.getItem(k)];}));
  const info=w.eval(`(${inspectSiteStorage.toString()})()`);
  assert.equal(info.usedUnits,Object.entries(before).reduce((n,[k,v])=>n+k.length+v.length,0));assert.equal(info.cacheCount,2);assert.equal(info.pageId,'page-id');assert.equal(info.quotaFailures,3);
  const snapshot=w.eval(`(${readSiteCache.toString()})()`);
  await backupAndClearSiteCache({storage:s,snapshot,id:'same',clear:async()=>({cleared:0})});
  const original=s.data['pku-site-cache-backup-same'];let fullWrites=0;
  const set=s.set;s.set=async values=>{if(values['pku-site-cache-backup-same'])fullWrites++;return set(values);};
  await backupAndClearSiteCache({storage:s,snapshot,id:'same',clear:async()=>({cleared:0})});
  assert.equal(fullWrites,0);assert.equal(s.data['pku-site-cache-backup-same'],original);assert.equal(w.sessionStorage.getItem('stdin'),'current input');
 }finally{dom.window.close();}
});
