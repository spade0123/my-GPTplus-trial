const {randomUUID}=require('node:crypto');
const {EventEmitter}=require('node:events');

class EditorHost{
  constructor(vscode,extensionUri,{onError=()=>{}}={}){
    Object.assign(this,{vscode,extensionUri,onError});this.sequence=0;this.snapshots=new Map();this.disposed=false;
  }
  async replace(title,beforeClose){
    const sequence=++this.sequence;
    if(this.current)await this.closePanel(this.current);
    if(sequence!==this.sequence||this.disposed)return null;
    const host=this,events=new EventEmitter(),native=this.vscode.window.createWebviewPanel('openjudgeCoach',title,{viewColumn:this.column||this.vscode.ViewColumn.Beside,preserveFocus:false},{enableScripts:true,retainContextWhenHidden:true,localResourceRoots:[this.extensionUri]}),webview=native.webview,panel={session:randomUUID(),ready:false,closed:false,queue:[],beforeClose};
    let lastTitle=title,lastColumn=native.viewColumn,html='',receive,disposed,viewState;
    Object.defineProperties(panel,{title:{get:()=>lastTitle,set:value=>{if(panel.closed)return;lastTitle=value;native.title=value;}},viewColumn:{get:()=>lastColumn}});
    const finish=()=>{
      if(panel.closed)return;
      host.column=lastColumn||host.column;panel.closed=true;panel.queue=[];if(host.current===panel)host.current=null;
      for(const [id,pending]of host.snapshots)if(pending.panel===panel){host.snapshots.delete(id);clearTimeout(pending.timer);pending.resolve(null);}
      if(!panel.closePromise&&panel.beforeClose&&panel.draft)try{void Promise.resolve(panel.beforeClose(panel.draft)).catch(host.onError);}catch(error){host.onError(error);}
      events.emit('dispose');events.removeAllListeners();receive?.dispose();disposed?.dispose();viewState?.dispose();
    };
    panel.webview={cspSource:webview.cspSource,asWebviewUri:uri=>panel.closed?uri:webview.asWebviewUri(uri),onDidReceiveMessage:fn=>{if(panel.closed)return {dispose(){}};events.on('message',fn);return {dispose:()=>events.off('message',fn)};},postMessage:async value=>{if(panel.closed)return false;if(!panel.ready){panel.queue.push(value);return true;}try{return await webview.postMessage(value);}catch(error){if(panel.closed)return false;throw error;}}};
    Object.defineProperty(panel.webview,'html',{get:()=>html,set:value=>{if(panel.closed)return;html=value;panel.ready=false;webview.html=value;}});
    panel.onDidDispose=fn=>{events.on('dispose',fn);return {dispose:()=>events.off('dispose',fn)};};
    panel.reveal=column=>{if(!panel.closed)native.reveal(column,false);};
    panel.dispose=()=>{if(panel.closed)return;finish();native.dispose();};
    receive=webview.onDidReceiveMessage(message=>{
      if(panel.closed||message?.editorSession!==panel.session)return;
      if(message.type==='editor_ready'){panel.ready=true;for(const value of panel.queue.splice(0))void panel.webview.postMessage(value).catch(host.onError);return;}
      if(message.type==='editor_draft'){panel.draft=message.ui;return;}
      if(message.type==='editor_snapshot'){const pending=host.snapshots.get(message.id);if(pending?.panel===panel){host.snapshots.delete(message.id);clearTimeout(pending.timer);panel.draft=message.ui;pending.resolve(message.ui);}return;}
      events.emit('message',message);
    });
    disposed=native.onDidDispose(finish);
    viewState=native.onDidChangeViewState?.(()=>{if(!panel.closed){lastColumn=native.viewColumn||lastColumn;host.column=lastColumn||host.column;}});
    this.column=lastColumn||this.column;this.current=panel;return panel;
  }
  snapshot(panel){
    if(!panel.ready||panel.closed)return Promise.resolve(panel.draft||null);
    return new Promise(resolve=>{const id=randomUUID(),timer=setTimeout(()=>{this.snapshots.delete(id);resolve(panel.draft||null);},400);this.snapshots.set(id,{panel,timer,resolve});void panel.webview.postMessage({type:'editor_snapshot_request',id}).catch(error=>this.onError(error));});
  }
  async closePanel(panel){
    if(panel.closed)return;if(panel.closePromise)return panel.closePromise;
    this.column=panel.viewColumn||this.column;
    panel.closePromise=(async()=>{try{if(panel.beforeClose)await panel.beforeClose(await this.snapshot(panel));}catch(error){this.onError(error);}finally{panel.dispose();}})();return panel.closePromise;
  }
  dispose(){this.disposed=true;this.sequence++;this.current?.dispose();for(const pending of this.snapshots.values()){clearTimeout(pending.timer);pending.resolve(null);}this.snapshots.clear();}
}
module.exports={EditorHost};
