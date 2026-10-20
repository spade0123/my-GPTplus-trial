import fs from 'node:fs/promises';
import {watch} from 'node:fs';
import path from 'node:path';
import {ROOT} from './core.js';
import {frame,decoder} from './native-protocol.js';
import {mailboxDir} from './browser-mailbox.js';
import {writeRecord,acquireLock} from './browser-review.js';
import {saveProblemNotice} from './problem-display.js';
const config=JSON.parse(await fs.readFile(path.join(ROOT,'native/paths.json'),'utf8'));
if(process.argv[2]!==`chrome-extension://${config.extensionId}/`)process.exit(2);
const dir=mailboxDir(),pending=new Map();let watcher,opening,release,noticeSequence=0,noticeWrites=Promise.resolve();
const send=value=>process.stdout.write(frame(value));
async function scan(){
  for(const name of await fs.readdir(path.join(dir,'requests'))){
    if(!/^[-a-f0-9]{36}\.json$/.test(name))continue;
    try{
      const request=JSON.parse(await fs.readFile(path.join(dir,'requests',name),'utf8'));
      if(request.id+'.json'!==name||request.expiresAt<Date.now()||!['tabs','capture','inspect_submit','prepare_submit','submit','refresh_submission','navigate_problem','close_submission_tab'].includes(request.action)||pending.has(request.id))continue;
      pending.set(request.id,request.expiresAt);send({type:'browser_request',...request});
    }catch{}
  }
  for(const [id,expires]of pending)if(expires<Date.now())pending.delete(id);
}
async function open(){
  await fs.mkdir(path.join(dir,'requests'),{recursive:true});await fs.mkdir(path.join(dir,'responses'),{recursive:true});
  release=await acquireLock(path.join(dir,'host.lock'));if(!release)throw new Error('另一份 Chrome 已连接本版本，请保持唯一连接。');
  watcher=watch(path.join(dir,'requests'),()=>{void scan();});
  await writeRecord(path.join(dir,'ready.json'),{connected:true,pid:process.pid,connectedAt:new Date().toISOString()});
  await scan();send({type:'bridge_ready'});
}
process.stdin.on('data',decoder(async message=>{
  try{
    if(message.type==='bridge_open'){opening||=open();await opening;return;}
    if(message.type==='problem_notice'){
      await opening;if(!release||!Number.isInteger(message.sequence)||message.sequence<=noticeSequence)return;
      noticeSequence=message.sequence;noticeWrites=noticeWrites.catch(()=>{}).then(()=>saveProblemNotice(message));await noticeWrites;return;
    }
    if(message.type!=='browser_reply'||!pending.has(message.id))return;
    pending.delete(message.id);
    await writeRecord(path.join(dir,'responses',message.id+'.json'),{value:message.value,error:message.error,code:message.code});
  }catch(e){send({type:'bridge_error',error:String(e.message).slice(0,1000)});}
},()=>process.exit(2)));
process.stdin.on('end',()=>{void(async()=>{try{await opening;await noticeWrites;}catch{}watcher?.close();if(release){await writeRecord(path.join(dir,'ready.json'),{connected:false});await release();}})().finally(()=>process.exit());});
