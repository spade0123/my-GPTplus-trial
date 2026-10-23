const path=require('node:path'),os=require('node:os'),fs=require('node:fs/promises'),{spawn}=require('node:child_process'),{randomUUID}=require('node:crypto'),{EventEmitter}=require('node:events');
class FloatingHost{
  constructor(root,{launch=spawn,onError=()=>{},platform=process.platform}={}){Object.assign(this,{root:path.resolve(root),launch,onError,platform});this.sequence=0;this.snapshots=new Map();this.pending=[];this.disposed=false;}
  send(value){if(this.child&&!this.child.killed)this.child.stdin.write(JSON.stringify(value)+'\n');}
  async ensure(){
    if(this.starting)return this.starting;
    if(this.child)return;
    this.starting=(async()=>{
      if(this.platform!=='win32')throw new Error('当前浮窗版本支持 Windows；没有创建编辑器标签页。');
      const executable=path.join(this.root,'native-window/coach-window.exe');await fs.access(executable);
      this.profile=await fs.mkdtemp(path.join(os.tmpdir(),'openjudge-coach-window-'));
      const child=this.launch(executable,[this.root,this.profile],{windowsHide:true,shell:false,stdio:['pipe','pipe','pipe']});this.child=child;
      let buffer='';child.stdout.setEncoding('utf8');child.stdout.on('data',chunk=>{buffer+=chunk;let p;while((p=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,p);buffer=buffer.slice(p+1);try{this.receive(JSON.parse(line));}catch(e){this.onError(e);}}});
      child.stderr.resume();child.stdin.on('error',()=>{});
      child.on('error',error=>{this.onError(error);this.reset(child);});child.on('exit',code=>{if(!this.disposed&&this.current&&this.child===child)this.onError(new Error('学习教练浮窗已意外关闭（'+code+'）。可再次点击按钮打开；本机已保存记录保留。'));this.reset(child);});
    })().finally(()=>this.starting=null);return this.starting;
  }
  reset(child){if(this.child!==child)return;this.child=null;this.current?.dispose();const profile=this.profile;this.profile=null;if(profile)void fs.rm(profile,{recursive:true,force:true,maxRetries:20,retryDelay:300}).catch(()=>{});}
  async replace(title,beforeClose){
    const sequence=++this.sequence;
    if(this.current)await this.closePanel(this.current);
    await this.ensure();if(sequence!==this.sequence||this.disposed)return null;
    const host=this,events=new EventEmitter(),panel={session:randomUUID(),title,ready:false,closed:false,queue:[],beforeClose,viewColumn:undefined};
    panel.webview={cspSource:'https://coach.local',asWebviewUri:uri=>{const relative=path.relative(host.root,uri.fsPath);if(relative.startsWith('..')||path.isAbsolute(relative))throw new Error('Invalid floating resource');return {toString:()=> 'https://coach.local/'+relative.split(path.sep).map(encodeURIComponent).join('/')};},postMessage:async message=>{if(panel.closed)return false;if(!panel.ready)panel.queue.push(message);else host.send({cmd:'post',json:JSON.stringify({floatingSession:panel.session,message})});return true;},onDidReceiveMessage:fn=>{events.on('message',fn);return {dispose:()=>events.off('message',fn)};}};
    Object.defineProperty(panel.webview,'html',{get:()=>panel.html||'',set:html=>{if(panel.closed)return;panel.html=html;panel.ready=false;host.send({cmd:'html',title:panel.title,html});}});
    panel.onDidDispose=fn=>{events.on('dispose',fn);return {dispose:()=>events.off('dispose',fn)};};
    panel.reveal=()=>{if(!panel.closed)host.send({cmd:'focus'});};
    panel.dispose=()=>{if(panel.closed)return;panel.closed=true;panel.queue=[];if(host.current===panel){host.current=null;host.send({cmd:'hide'});}events.emit('dispose');events.removeAllListeners();};
    panel.events=events;this.current=panel;return panel;
  }
  receive(value){
    if(value.type==='native_error'){this.onError(new Error(value.error));return;}
    if(value.type==='native_close_requested'){if(this.current)void this.closePanel(this.current).catch(this.onError);return;}
    const panel=this.current;if(!panel||panel.closed||value.floatingSession!==panel.session)return;
    const message=value.message;
    if(message?.type==='floating_ready'){panel.ready=true;for(const queued of panel.queue.splice(0))void panel.webview.postMessage(queued);return;}
    if(message?.type==='floating_snapshot'){const pending=this.snapshots.get(message.id);if(pending&&pending.panel===panel){this.snapshots.delete(message.id);clearTimeout(pending.timer);pending.resolve(message.ui);}return;}
    panel.events.emit('message',message);
  }
  snapshot(panel){if(!panel.ready||panel.closed)return Promise.resolve(null);return new Promise(resolve=>{const id=randomUUID(),timer=setTimeout(()=>{this.snapshots.delete(id);resolve(null);},400);this.snapshots.set(id,{panel,timer,resolve});void panel.webview.postMessage({type:'floating_snapshot_request',id});});}
  async closePanel(panel){if(panel.closed)return;if(panel.closePromise)return panel.closePromise;panel.closePromise=(async()=>{try{if(panel.beforeClose)await panel.beforeClose(await this.snapshot(panel));}catch(e){this.onError(e);}finally{panel.dispose();}})();return panel.closePromise;}
  dispose(){this.disposed=true;this.sequence++;this.current?.dispose();this.send({cmd:'close'});this.child?.stdin.end();for(const pending of this.snapshots.values()){clearTimeout(pending.timer);pending.resolve(null);}this.snapshots.clear();}
}
module.exports={FloatingHost};
