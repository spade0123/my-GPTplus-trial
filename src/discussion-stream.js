import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {discussionContext,DISCUSSION_GUIDE} from './discussion-context.js';

// One private stdio connection per worker; each request has an ephemeral thread.
// This is not a user-visible Codex chat and is never added to its sidebar.
export class DiscussionStream {
  constructor({resolveCommand,spawnProcess=spawn,timeoutMs=60000,rpcTimeoutMs=10000,guide=DISCUSSION_GUIDE,context=discussionContext,label='交流'}={}){
    Object.assign(this,{resolveCommand,spawnProcess,timeoutMs,rpcTimeoutMs,guide,context,label});this.nextId=0;this.requests=new Map();this.active=new Map();
  }
  async open(){
    if(this.opening)return this.opening;
    this.opening=this.start().catch(async error=>{await this.close();throw error;});return this.opening;
  }
  async start(){
    this.cwd=await fs.mkdtemp(path.join(os.tmpdir(),'pku-cpp-chat-'));
    const args=['app-server','--listen','stdio://','-c','mcp_servers={}','-c','model_provider="pku_coach_http"','-c','model_providers.pku_coach_http.name="OpenAI C++ Coach HTTP"','-c','model_providers.pku_coach_http.requires_openai_auth=true','-c','model_providers.pku_coach_http.wire_api="responses"','-c','model_providers.pku_coach_http.supports_websockets=false','-c','web_search="disabled"','-c','model_reasoning_effort="low"','-c','model_verbosity="low"','-c','notify=[]','-c','developer_instructions=""'];
    for(const feature of ['shell_tool','apps','plugins','browser_use','computer_use','multi_agent','skill_search'])args.push('--disable',feature);
    args.push('--enable','skip_host_skill_discovery');
    this.child=this.spawnProcess(await this.resolveCommand(),args,{cwd:this.cwd,windowsHide:true,shell:false});
    this.stderr='';this.child.stderr.on('data',b=>{this.stderr=(this.stderr+b.toString()).slice(-4000);});this.child.stdin.on('error',()=>{});
    this.lines=createInterface({input:this.child.stdout});this.lines.on('line',line=>{try{this.receive(JSON.parse(line));}catch{/* Ignore non-protocol startup output. */}});
    this.child.once('error',()=>this.fail(new Error('无法启动交流连接，请检查本机 Codex 安装路径。')));
    this.child.once('close',()=>{this.closed=true;const missing=this.stderr.match(/missing field [`'"]?([\w.]+)/i);this.fail(new Error(missing?`交流启动配置缺少 ${missing[1]}，请更新本机连接程序。`:'交流模型连接已断开；问题和源码已保存，可重试。'));});
    await this.rpc('initialize',{clientInfo:{name:'pku_cpp_coach',title:'北大 C++ 学习教练',version:'1.8.7'}});
    this.send({method:'initialized',params:{}});
    // Empty tables merge with user config in app-server. Explicitly disable
    // every configured server instead of assuming mcp_servers={} removed it.
    const config=await this.rpc('config/read',{includeLayers:false});
    this.disabledServers=Object.fromEntries(Object.keys(config.config?.mcp_servers||{}).map(name=>[name,{enabled:false,required:false}]));
  }
  send(message){
    if(this.closed||!this.child?.stdin.writable)throw new Error('交流模型连接不可用。');
    this.child.stdin.write(JSON.stringify(message)+'\n');
  }
  rpc(method,params){
    return new Promise((resolve,reject)=>{
      const id=++this.nextId,timer=setTimeout(()=>{this.requests.delete(id);reject(new Error('交流模型连接初始化超时，请稍后重试。'));},this.rpcTimeoutMs);
      this.requests.set(id,{resolve,reject,timer});
      try{this.send({id,method,params});}catch(error){clearTimeout(timer);this.requests.delete(id);reject(error);}
    });
  }
  receive(message){
    this.eventMethods||=[];if(message.method)this.eventMethods.push(message.method);if(this.eventMethods.length>40)this.eventMethods.shift();
    if(['configWarning','warning'].includes(message.method)){this.warnings||=[];this.warnings.push(String(message.params?.summary||message.params?.message||''));}
    if(message.id!==undefined&&!message.method){
      const request=this.requests.get(message.id);if(!request)return;
      clearTimeout(request.timer);this.requests.delete(message.id);
      if(message.error)request.reject(new Error('交流接口错误：'+String(message.error.message||'请求失败').slice(0,500)));else request.resolve(message.result);return;
    }
    // Never approve file access, commands, tool calls or external side effects.
    if(message.id!==undefined&&message.method){this.send({id:message.id,error:{code:-32601,message:'Tools and approval requests are disabled for this read-only discussion.'}});return;}
    const p=message.params||{},active=this.active.get(p.threadId);if(!active)return;
    if(message.method==='error')this.lastModelError=String(p.error?.message||'');
    if(message.method==='item/agentMessage/delta'){
      active.items.set(p.itemId,(active.items.get(p.itemId)||'')+p.delta);this.progress(active);
    }else if(message.method==='item/completed'&&p.item?.type==='agentMessage'){
      active.items.set(p.item.id,p.item.text||'');this.progress(active);
    }else if(message.method==='turn/completed'){
      clearTimeout(active.timer);this.active.delete(p.threadId);
      const text=[...active.items.values()].join('\n\n').trim();
      if(p.turn?.status==='completed'&&text)active.resolve({answer:text,next_step:''});
      else active.reject(new Error(p.turn?.status==='interrupted'?'交流回复已中断；已生成的部分仍保留。':'交流模型未完成回复；问题和源码已保存，可重试。'));
    }
  }
  progress(active){
    const text=[...active.items.values()].join('\n\n').slice(0,15000);
    if(text===active.text)return;active.text=text;
    try{const result=active.onDelta?.(text);result?.catch?.(()=>{});}catch{}
  }
  async createThread(){
    await this.open();
    const start=await this.rpc('thread/start',{model:process.env.PKU_MODEL||'gpt-6.1-sol',cwd:this.cwd,approvalPolicy:'never',sandbox:'read-only',ephemeral:true,baseInstructions:this.guide,developerInstructions:'本服务只回答用户代码问题，禁止使用任何工具。',config:{mcp_servers:this.disabledServers},serviceTier:'default'});
    const threadId=start.thread?.id;
    if(!threadId||start.thread.ephemeral!==true||start.sandbox?.type!=='readOnly')throw new Error('交流会话未满足临时只读要求，已停止发送源码。');
    return start;
  }
  async warm(){if(!this.prepared)this.prepared=await this.createThread();}
  async run(evidence,{onDelta,timeoutMs=this.timeoutMs}={}){
    const start=this.prepared||await this.createThread();this.prepared=null;
    const threadId=start.thread.id;
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{
        const current=this.active.get(threadId);if(!current)return;
        this.active.delete(threadId);this.rpc('turn/interrupt',{threadId,turnId:current.turnId||''}).catch(()=>{});
        reject(new Error(`${this.label}模型超过 ${Math.ceil(timeoutMs/1000)} 秒未完成；已生成内容、问题和源码已保存，可稍后重试。`));
      },timeoutMs);
      const active={resolve,reject,timer,onDelta,items:new Map(),text:''};this.active.set(threadId,active);
      this.rpc('turn/start',{threadId,input:[{type:'text',text:JSON.stringify(this.context(evidence)),text_elements:[]}],model:process.env.PKU_MODEL||'gpt-6.1-sol',effort:'low',summary:'none',approvalPolicy:'never',sandboxPolicy:{type:'readOnly'},serviceTierForTurn:'default'}).then(result=>{active.turnId=result.turn?.id;},error=>{clearTimeout(timer);this.active.delete(threadId);reject(error);});
    });
  }
  fail(error){
    for(const request of this.requests.values()){clearTimeout(request.timer);request.reject(error);}this.requests.clear();
    for(const active of this.active.values()){clearTimeout(active.timer);active.reject(error);}this.active.clear();
  }
  async close(){
    this.fail(new Error('交流连接已关闭。'));
    this.lines?.close();this.child?.stdin.end();this.child?.kill();
    if(this.cwd)await fs.rm(this.cwd,{recursive:true,force:true,maxRetries:4,retryDelay:150}).catch(()=>{});
    this.child=null;this.opening=null;this.prepared=null;this.closed=false;
  }
}
