import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {JSDOM} from 'jsdom';
import {saveAttempt,getProblem} from '../src/problem-history.js';
import {queueHint,queueDiscussion,processHint,discussionHistory,hintHistory,assistHistory,readHint} from '../src/hint-review.js';

const url='https://programming.pku.edu.cn/probset/'+'a'.repeat(32)+'/'+'b'.repeat(32)+'/ide.do';
const otherUrl=url.replace('b'.repeat(32),'c'.repeat(32));
const capture={url,title:'求和',problem:{description:'读入两个整数，计算并输出它们的和。',input:'两个整数',output:'整数和',sampleInput:'1 2',sampleOutput:'3'},code:'#include <iostream>\nusing namespace std;\nint main(){int a,b;cin>>a>>b;cout<<a-b;}',runtime:{text:'-1'},standard:'c++17'};
const direction='## 解题方向\n读入两个整数并相加。\n\n## 对照你的代码\ncout<<a-b 计算了差。\n\n## 下一步\n将 a-b 改成 a+b。\n\n## 手算验证\n输入 1 2，预期 3；手算，未运行。';
const solution='## 完整参考程序\n```cpp\n#include <iostream>\nusing namespace std;\nint main(){int a,b;cin>>a>>b;cout<<a+b;}\n```';

test('disk restoration separates dialogue from hints/solutions, including more than 30 events sharing one snapshot',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pku-assistance-history-'));process.env.PKU_DATA_DIR=dir;
  try{
    const first=await saveAttempt(capture,{origin:'hint_request'});await queueHint(first.id,{eventId:first.eventId,attemptNumber:first.attemptNumber});
    await processHint(first.id,{compile:async()=>({status:'passed',ranProgram:false}),model:async()=>({markdown:direction})});
    const saved=await saveAttempt(capture,{origin:'discussion'}),chat=await queueDiscussion(saved.id,{question:'为何输出是 -1？',eventId:saved.eventId,attemptNumber:saved.attemptNumber});
    await processHint(chat.id,{discussionModel:async()=>({answer:'你的 cout<<a-b 在做减法，改为 cout<<a+b。',next_step:''})});
    let last;
    for(let i=0;i<31;i++){
      const attempt=await saveAttempt(capture,{origin:'discussion'});
      last=await queueDiscussion(attempt.id,{question:'给出完整解答',purpose:'solution',eventId:attempt.eventId,attemptNumber:attempt.attemptNumber});
    }
    await processHint(last.id,{discussionModel:async()=>({answer:solution,next_step:''})});
    const before=(await getProblem(url)).attempts.length;
    assert.equal((await discussionHistory(url,{limit:1})).entries[0].id,chat.id);
    assert.equal((await discussionHistory(url)).total,1);
    const restored=await hintHistory(url);
    assert.equal(restored.hint.analysis,direction);assert.equal(restored.solution.id,last.id);assert.equal(restored.solution.analysis,solution);
    const combined=await assistHistory(url);assert.equal(combined.hints.hint.id,first.id);assert.equal(combined.hints.solution.id,last.id);assert.equal(combined.discussion.total,1);assert.equal(combined.discussion.entries[0].id,chat.id);
    assert.equal((await getProblem(url)).attempts.length,before);
    assert.equal((await readHint(last.id)).status,'complete');
    const next=await saveAttempt({...capture,runtime:{text:'新运行区'}},{origin:'discussion'});
    const question=await queueDiscussion(next.id,{question:'这次运行区是什么意思？',eventId:next.eventId,attemptNumber:next.attemptNumber});
    await processHint(question.id,{discussionModel:async evidence=>{
      assert.equal(evidence.history.length,1);assert.equal(evidence.history[0].id,chat.id);assert.equal(evidence.capture.runtime.text,'新运行区');return {answer:'这一轮运行区的内容是新运行区，需要核对测试输入。',next_step:''};
    }});
    const other=await saveAttempt({...capture,url:otherUrl},{origin:'discussion'});
    await queueDiscussion(other.id,{question:'另一题的问题',eventId:other.eventId,attemptNumber:other.attemptNumber});
    assert.equal((await discussionHistory(url)).total,2);assert.equal((await discussionHistory(otherUrl)).total,1);
    assert.equal((await hintHistory(otherUrl)).hint,null);assert.equal((await hintHistory(otherUrl)).solution,null);
  }finally{delete process.env.PKU_DATA_DIR;await fs.rm(dir,{recursive:true,force:true});}
});

async function frameFixture(){
  const html=await fs.readFile(new URL('../extension/assist-window.html',import.meta.url),'utf8'),dom=new JSDOM(html,{url:'https://own-frame.test',runScripts:'outside-only'}),w=dom.window,sent=[];let receive;
  w.chrome={runtime:{connect:()=>({onMessage:{addListener:fn=>receive=fn},onDisconnect:{addListener(){}},postMessage:msg=>sent.push(msg)})}};
  for(const name of ['vendor/marked/marked.umd.js','report-renderer.js','instant-hints.js','assist-window.js'])w.eval(await fs.readFile(new URL('../extension/'+name,import.meta.url),'utf8'));
  return {dom,w,sent,$:id=>w.document.getElementById(id),receive:msg=>receive(msg),close(){w.document.getElementById('chatPanel').ontoggle=null;dom.window.close();},history(actionId,{total=0,hint=null,solution=null,entries=[],chatTotal=entries.length}={}){
    receive({type:'assist_history',actionId,url,hints:{url,total,hint,solution},discussion:{url,total:chatTotal,entries}});
  },open(mode,current=capture){
    receive({type:'resume_context',mode});const action=sent.at(-1);
    receive({type:'assist_context',actionId:action.actionId,capture:current,missingSections:[]});return action.actionId;
  }};
}
const hintJob={id:'d'.repeat(64),kind:'hint',sourceUrl:url,status:'complete',analysis:direction,codeHash:'1'.repeat(64),eventId:'hint-event'};
const solutionJob={id:'e'.repeat(64),kind:'discussion',purpose:'solution',sourceUrl:url,status:'complete',analysis:solution,question:'给出完整解答',codeHash:'1'.repeat(64),eventId:'solution-event'};
const chatJob={id:'f'.repeat(64),kind:'discussion',purpose:'discussion',sourceUrl:url,status:'complete',analysis:'把你的 a-b 改成 a+b。',question:'为什么是 -1？',codeHash:'1'.repeat(64),eventId:'chat-event'};

test('reopening hints restores saved text and solution without generating again or resetting expanded content',async()=>{
  const f=await frameFixture(),{$,receive,sent}=f;
  try{
    let actionId=f.open('hint');f.history(actionId,{total:2,hint:hintJob,solution:solutionJob});
    assert.match($('hintAnswer').textContent,/将 a-b 改成 a\+b/);assert.match($('solutionAnswer').textContent,/完整参考程序/);
    $('solutionPanel').open=true;const oldCode=$('solutionAnswer').querySelector('pre code');
    actionId=f.open('hint',{...capture,code:capture.code.replace('a-b','a+b'),runtime:{text:'第二次读取的编译错误'}});
    f.history(actionId,{total:2,hint:hintJob,solution:solutionJob});
    assert.equal($('solutionPanel').open,true);assert.equal($('solutionAnswer').querySelector('pre code'),oldCode);
    assert.match($('context').textContent,/运行区已读取/);assert.match($('hintState').textContent,/对应源码 11111111/);
    assert.equal(sent.filter(m=>m.type==='hint'||m.type==='discuss').length,0);assert.equal($('chatMessages').textContent,'');
    $('refreshHint').click();const fresh=sent.at(-1);assert.equal(fresh.type,'hint');
    f.history(actionId,{total:2,hint:hintJob,solution:solutionJob});
    assert.equal($('hintAnswer').textContent,'');assert.equal($('refreshHint').disabled,true);
  }finally{f.close();}
});

test('chat reopening keeps questions, real replies and unsent text, rejects mixed-purpose history and never shows instant hints',async()=>{
  const f=await frameFixture(),{$,receive,sent}=f;
  try{
    let actionId=f.open('discussion');
    f.history(actionId,{total:2,hint:hintJob,solution:solutionJob,chatTotal:1,entries:[hintJob,solutionJob,chatJob,{...chatJob,id:'a'.repeat(64),sourceUrl:otherUrl,question:'不属于本题'}]});
    assert.equal($('chatMessages').querySelectorAll('.chat').length,1);assert.match($('chatMessages').textContent,/为什么是 -1/);
    assert.doesNotMatch($('chatMessages').textContent,/完整参考程序|解题方向|不属于本题/);assert.match($('solutionAnswer').textContent,/完整参考程序/);
    assert($('hintPanel').contains($('chatPanel')));assert.equal($('hintPanel').hidden,false);assert.equal($('chatPanel').open,true);assert.match($('hintAnswer').textContent,/将 a-b 改成 a\+b/);
    $('question').value='还没发送的追问';actionId=f.open('discussion',{...capture,runtime:{error:'最新报错'}});
    assert.match($('chatMessages').textContent,/把你的 a-b 改成 a\+b/);assert.equal($('question').value,'还没发送的追问');
    f.history(actionId,{entries:[chatJob]});assert.equal($('chatMessages').querySelectorAll('.chat').length,1);
    $('chatForm').dispatchEvent(new f.w.Event('submit',{bubbles:true,cancelable:true}));const ask=sent.at(-1);
    receive({type:'action_preview',requestType:'discuss',actionId:ask.actionId,capture,missingSections:[]});
    const pending={...chatJob,id:'2'.repeat(64),eventId:ask.actionId,question:ask.question,status:'running',analysis:undefined,instantAnalysis:'不应该出现在交流中的本地检查'};
    receive({type:'saved',actionId:ask.actionId,hint:pending});
    assert.doesNotMatch($('chatMessages').textContent,/不应该出现在交流中的本地检查/);
    receive({type:'hint_status',...pending,partialAnalysis:'根据你当前的代码，先把减法改为加法。'});
    assert.match($('chatMessages').textContent,/根据你当前的代码/);
    actionId=f.open('discussion');assert.match($('chatMessages').textContent,/根据你当前的代码/);
    f.history(actionId,{entries:[chatJob,{...pending,partialAnalysis:'根据你当前的代码，先把减法改为加法。'}]});
    assert.equal($('chatMessages').querySelectorAll('.chat').length,2);assert.equal(sent.filter(m=>m.type==='discuss').length,1);
  }finally{f.close();}
});

test('a first hint with no history starts once; reopening an empty or unreadable history never repeats it',async()=>{
  const f=await frameFixture(),{receive,sent}=f;
  try{
    let actionId=f.open('hint');f.history(actionId);
    assert.equal(sent.filter(m=>m.type==='hint').length,1);
    actionId=f.open('hint');f.history(actionId);
    assert.equal(sent.filter(m=>m.type==='hint').length,1);
  }finally{f.close();}
  const restored=await frameFixture();
  try{
    const actionId=restored.open('hint');restored.history(actionId,{total:1});
    assert.equal(restored.sent.filter(m=>m.type==='hint').length,0);
  }finally{restored.close();}
});

test('sending before disk history arrives still restores earlier dialogue without losing the new question',async()=>{
  const f=await frameFixture(),{$,receive,sent}=f;
  try{
    const actionId=f.open('discussion');$('question').value='新的追问';
    $('chatForm').dispatchEvent(new f.w.Event('submit',{bubbles:true,cancelable:true}));assert.equal(sent.at(-1).type,'discuss');
    f.history(actionId,{entries:[chatJob]});
    const questions=[...$('chatMessages').querySelectorAll('.question')].map(el=>el.textContent);
    assert.deepEqual(questions,['新的追问','为什么是 -1？']);assert.match($('chatMessages').textContent,/把你的 a-b 改成 a\+b/);
  }finally{f.close();}
});

test('opening embedded chat keeps hint content and draft, reads context once, and does not generate a hint',async()=>{
  const f=await frameFixture(),{$,sent}=f;
  try{
    let actionId=f.open('hint');f.history(actionId,{total:1,hint:hintJob});
    assert.equal($('chatPanel').open,false);$('question').value='未发送的问题';
    const before=sent.length;$('chatPanel').open=true;$('chatPanel').dispatchEvent(new f.w.Event('toggle'));
    assert.equal(sent.length,before+1);assert.equal(sent.at(-1).type,'assist_history');assert.equal($('question').value,'未发送的问题');
    assert.match($('hintAnswer').textContent,/将 a-b 改成 a\+b/);assert.equal($('hintPanel').hidden,false);
    actionId=sent.at(-1).actionId;f.receive({type:'assist_context',actionId,capture:{...capture,runtime:{error:'最新运行区'}},missingSections:[]});f.history(actionId,{total:1,hint:hintJob,entries:[chatJob]});
    assert.equal(sent.filter(m=>m.type==='hint'||m.type==='discuss').length,0);
    actionId=f.open('hint');f.history(actionId,{total:1,hint:hintJob,entries:[chatJob]});assert.equal($('chatPanel').open,false);assert.equal($('question').value,'未发送的问题');
  }finally{f.close();}
});

test('opening hints collapses restored dialogue without deleting draft or conversations; discussion explicitly expands it',async()=>{
  const f=await frameFixture();try{
    let id=f.open('discussion');f.history(id,{total:1,hint:hintJob,entries:[chatJob]});assert.equal(f.$('chatPanel').open,true);
    id=f.open('hint');f.receive({type:'restore_ui',ui:{question:'保留草稿',chatOpen:true}});f.history(id,{total:1,hint:hintJob,entries:[chatJob]});
    assert.equal(f.$('chatPanel').open,false);assert.equal(f.$('question').value,'保留草稿');assert(f.$('chatMessages').textContent.includes(chatJob.question));
    id=f.open('discussion');f.history(id,{entries:[chatJob]});assert.equal(f.$('chatPanel').open,true);assert.equal(f.$('question').value,'保留草稿');assert.equal(f.sent.filter(m=>m.type==='hint'||m.type==='discuss').length,0);
  }finally{f.close();}
});
test('dialogue history shows the newest exchange first and keeps question-answer pairs together when a late reply arrives',async()=>{
  const f=await frameFixture();try{
    const id=f.open('discussion'),newer={...chatJob,id:'2'.repeat(64),eventId:'newer',question:'新问题',analysis:'新回答',createdAt:'2026-10-21T01:00:02Z'},older={...chatJob,id:'1'.repeat(64),eventId:'older',question:'旧问题',analysis:'旧回答',createdAt:'2026-10-21T01:00:01Z'};
    f.history(id,{entries:[older,newer]});assert.deepEqual([...f.$('chatMessages').querySelectorAll('.question')].map(e=>e.textContent),['新问题','旧问题']);
    f.receive({type:'hint_status',...older,analysis:'旧问题的较晚回复'});assert.equal(f.$('chatMessages').firstElementChild.querySelector('.question').textContent,'新问题');assert(f.$('chatMessages').lastElementChild.textContent.includes('旧问题的较晚回复'));
  }finally{f.close();}
});
test('a chat shortcut with no history only opens chat; a later explicit hint open may generate the first hint',async()=>{
  const f=await frameFixture();
  try{
    let actionId=f.open('discussion');f.history(actionId);assert.equal(f.$('chatPanel').open,true);assert.equal(f.sent.filter(m=>m.type==='hint').length,0);
    actionId=f.open('hint');f.history(actionId);assert.equal(f.sent.filter(m=>m.type==='hint').length,1);
  }finally{f.close();}
});

test('restoring embedded chat cannot replace an in-flight hint with an older saved answer',async()=>{
  const f=await frameFixture();
  try{
    let actionId=f.open('hint');f.history(actionId,{total:1,hint:hintJob});
    f.$('refreshHint').click();assert.equal(f.$('hintAnswer').textContent,'');
    actionId=f.open('discussion');f.history(actionId,{total:2,hint:hintJob,solution:solutionJob,entries:[chatJob]});
    assert.equal(f.$('hintAnswer').textContent,'');assert.equal(f.$('solutionPanel').hidden,true);assert.equal(f.$('refreshHint').disabled,true);
    assert.match(f.$('chatMessages').textContent,/为什么是 -1/);assert.equal(f.$('chatPanel').open,true);
  }finally{f.close();}
});
