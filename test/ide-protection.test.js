import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {installIdeProtection,readEditableDraft,restoreEditorDraft} from '../extension/ide-protection.js';
import {storeDraft,readDrafts} from '../extension/draft-store.js';

const url='https://programming.pku.edu.cn/probset/d0ef3e0f7fa5481d896f9a07254c8ecd/f6b942b2dcd74656880a088f85f56c3f/ide.do';
const other=url.replace('f6b942b2dcd74656880a088f85f56c3f','0123456789abcdef0123456789abcdef');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function storage(){
  const data={};
  return {data,get:async key=>({[key]:structuredClone(data[key])}),set:async values=>Object.assign(data,structuredClone(values))};
}
function page(backup){
  const dom=new JSDOM('<title>学习草稿</title><div id="editor" class="ace_editor"></div>',{url,runScripts:'outside-only'});
  const w=dom.window,handlers=new Map();let code='int main(){return 0;}',readonly=false,requests=0;
  const editor={getValue:()=>code,getReadOnly:()=>readonly,on:(name,fn)=>handlers.set(name,fn),setValue:value=>{code=value;handlers.get('change')?.();},focus(){}};
  w.document.querySelector('#editor').env={editor};
  Object.assign(w,{userid:123,sourceCodeVersion:1,ide_mode:'',problemId:'problem-id',backup:{id:'problem-id'},backupSourceCodeForRecovery:backup||function(){throw new w.DOMException('Website storage full','QuotaExceededError');}});
  w.runCode=function(input){w.backupSourceCodeForRecovery();requests++;return input;};
  w.eval(`(${installIdeProtection.toString()})()`);
  return {dom,w,editor,get requests(){return requests;},edit(value){editor.setValue(value);},readonly(value){readonly=value;}};
}
function reply(w,event,ok=true,error=''){
  w.document.dispatchEvent(new w.CustomEvent('pku-coach-draft-reply',{detail:{requestId:event.detail.requestId,ok,error}}));
}

test('quota failure waits for durable backup then resumes exactly one user-initiated run',async()=>{
  const p=page();try{
    let request;const notices=[];
    p.w.document.addEventListener('pku-coach-draft-save',event=>{request=event;});
    p.w.document.addEventListener('pku-coach-draft-notice',event=>notices.push(event.detail));
    const running=p.w.runCode('input');
    assert.equal(p.requests,0);assert.equal(request.detail.draft.code,p.editor.getValue());
    assert.equal(p.w.runCode('input'),running); // double click while saving
    reply(p.w,request);await running;
    assert.equal(p.requests,1);assert.ok(notices.some(n=>n.kind==='quota'));
    assert.doesNotThrow(()=>p.w.backupSourceCodeForRecovery());
  }finally{p.dom.window.close();}
});

test('failed or stale backup never resumes a test with unprotected/changed code',async()=>{
  const p=page();try{
    const requests=[],notices=[];
    p.w.document.addEventListener('pku-coach-draft-save',e=>requests.push(e));
    p.w.document.addEventListener('pku-coach-draft-notice',e=>notices.push(e.detail));
    let running=p.w.runCode('input');reply(p.w,requests[0],false,'扩展存储也已满');await running;
    assert.equal(p.requests,0);assert.match(notices.at(-1).message,/扩展存储也已满/);
    running=p.w.runCode('input');p.edit('int main(){return 1;}');reply(p.w,requests[1]);await running;
    assert.equal(p.requests,0);assert.equal(notices.at(-1).kind,'changed');
    running=p.w.runCode('new-input');reply(p.w,requests[2]);await running;assert.equal(p.requests,1);
  }finally{p.dom.window.close();}
});

test('normal backups retain synchronous behavior and unrelated site exceptions are not swallowed',()=>{
  let backups=0,issue=null;
  const p=page(()=>{if(issue)throw issue;backups++;});try{
    assert.equal(p.w.runCode('same-input'),'same-input');assert.equal(backups,1);assert.equal(p.requests,1);
    issue=new Error('unrelated bug');
    assert.throws(()=>p.w.runCode('input'),error=>error===issue);assert.equal(p.requests,1);
  }finally{p.dom.window.close();}
});

test('typing stores incomplete code without running/submitting; restore is explicit and guarded',async()=>{
  const p=page();try{
    const saves=[];p.w.document.addEventListener('pku-coach-draft-save',e=>{saves.push(e.detail.draft);reply(p.w,e);});
    p.edit('#include <iostream>\nint main(){');await sleep(680);
    assert.equal(saves.length,1);assert.equal(saves[0].code,p.editor.getValue());assert.equal(p.requests,0);
    const capture=()=>p.w.eval(`(${readEditableDraft.toString()})()`);
    const restore=(draft,expected)=>p.w.eval(`(${restoreEditorDraft.toString()})(${JSON.stringify(draft)},${JSON.stringify(expected)})`);
    const current=capture(),old={...current,code:'int main(){return 9;}'};
    assert.equal(p.editor.getValue(),current.code); // reading history never overwrites
    assert.equal(restore(old,'outdated-code').ok,false);assert.equal(p.editor.getValue(),current.code);
    assert.equal(restore({...old,account:'456'},current.code).ok,false);
    assert.equal(restore(old,current.code).ok,true);assert.equal(p.editor.getValue(),old.code);assert.equal(p.requests,0);
    p.readonly(true);assert.equal(capture(),null);assert.equal(restore(current,old.code).ok,false);
  }finally{p.dom.window.close();}
});

test('draft storage isolates questions/accounts, serializes concurrent saves, and merges identical code',async()=>{
  const s=storage(),draft={url,account:'123',title:'练习',code:'int main(){return 0;}'};
  await Promise.all([storeDraft(s,draft,url),storeDraft(s,{...draft,code:'int main(){return 1;}'},url),storeDraft(s,draft,url)]);
  let record=await readDrafts(s,url,'123');assert.equal(record.versions.length,2);assert.equal(record.versions.at(-1).code,draft.code);
  await storeDraft(s,{...draft,url:other,code:'other problem'},other);
  await storeDraft(s,{...draft,account:'456',code:'other user'},url);
  assert.equal((await readDrafts(s,other,'123')).versions[0].code,'other problem');
  assert.equal((await readDrafts(s,url,'456')).versions[0].code,'other user');
  await assert.rejects(storeDraft(s,{...draft,url:other},url),/草稿无效/);
  await assert.rejects(storeDraft(s,{...draft,code:'x'.repeat(100001)},url),/超过/);
  s.set=async()=>{throw new Error('quota');};await assert.rejects(storeDraft(s,{...draft,code:'new-code'},url),/quota/);
  record=await readDrafts(s,url,'123');assert.equal(record.versions.at(-1).code,draft.code);
});

test('background recovery saves current code before an explicit restore and never enqueues analysis',async()=>{
  const dom=new JSDOM('',{url,runScripts:'outside-only'}),w=dom.window,s=storage();
  try{
    let onConnect,receive;const sent=[],operations=[];
    const draft={url,account:'123',title:'练习',code:'old version'};
    const {versionId}=await storeDraft(s,draft,url);
    w.installSubmissionObserver=()=>{};w.installIdeProtection=()=>{};w.readEditableDraft=()=>{};w.restoreEditorDraft=()=>{};
    w.storeDraft=(...args)=>{operations.push('save');return storeDraft(...args);};w.readDrafts=readDrafts;
    w.chrome={tabs:{get:async()=>({url})},storage:{local:s},scripting:{executeScript:async spec=>{
      if(spec.func===w.readEditableDraft)return [{result:{...draft,code:'current unsaved code'}}];
      if(spec.func===w.restoreEditorDraft){operations.push('restore');assert.equal(spec.args[1],'current unsaved code');return [{result:{ok:true}}];}
      return [];
    }},runtime:{onConnect:{addListener:fn=>{onConnect=fn;}},connectNative(){throw new Error('must not call native/model');}}};
    const source=await fs.readFile(new URL('../extension/background.js',import.meta.url),'utf8');w.eval(source.replace(/^import[^\n]+\n/gm,''));
    onConnect({name:'pku-coach',sender:{url,tab:{id:1}},onMessage:{addListener:fn=>{receive=fn;}},onDisconnect:{addListener(){}},postMessage:m=>sent.push(m),disconnect(){}});
    await receive({type:'draft_restore',account:'123',versionId});
    assert.deepEqual(operations,['save','restore']);assert.equal(sent.at(-1).type,'draft_restored');
    assert.ok((await readDrafts(s,url,'123')).versions.some(v=>v.code==='current unsaved code'));
    await receive({type:'draft_save',requestId:'r1',draft:{...draft,code:'new code'}});
    assert.equal(sent.at(-1).type,'draft_saved');assert.equal(sent.at(-1).requestId,'r1');
    s.set=async()=>{throw new Error('backup full');};
    await receive({type:'draft_save',requestId:'r2',draft:{...draft,code:'cannot save'}});
    assert.equal(sent.at(-1).type,'error');assert.equal(sent.at(-1).requestId,'r2');
  }finally{dom.window.close();}
});
