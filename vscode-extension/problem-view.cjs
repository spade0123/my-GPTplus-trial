const vscode=require('vscode'),fs=require('node:fs/promises'),{randomUUID}=require('node:crypto');
class ProblemView{
  constructor(context){
    this.context=context;this.latest={status:'waiting',connected:false};
    context.subscriptions.push(vscode.window.registerWebviewViewProvider('gridCoach.problemStatement',this));
  }
  async resolveWebviewView(view){
    this.view=view;const nonce=randomUUID().replaceAll('-',''),webview=view.webview;
    const uri=file=>webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri,file)).toString();
    webview.options={enableScripts:true,localResourceRoots:[this.context.extensionUri]};
    const scripts=['media/vendor/marked/marked.umd.js','media/vendor/katex/katex.min.js','media/report-renderer.js','problem-view.js'];
    webview.html='<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+
      `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource}; img-src data:; connect-src 'none';">`+
      `<link rel="stylesheet" href="${uri('media/vendor/katex/katex.min.css')}"><link rel="stylesheet" href="${uri('problem-view.css')}"></head><body>`+
      '<header><span class="eyebrow">编程网格 · 题面</span><h1 id="title">等待浏览器打开题目</h1><p id="state" role="status">Chrome 打开编程网格具体题目的 IDE 后，这里会自动显示。</p><button id="openProblem" hidden>在浏览器查看原题</button></header><main id="sections"></main><footer>题面自动显示；网格·保存、网格·提示和网格·交流由右下角三个按钮操作。</footer>'+
      scripts.map(file=>`<script nonce="${nonce}" src="${uri(file)}"></script>`).join('')+'</body></html>';
    this.context.subscriptions.push(view.onDidDispose(()=>{if(this.view===view)this.view=null;}),webview.onDidReceiveMessage(async message=>{
      if(message.type==='ready')return webview.postMessage(this.latest);
      if(message.type==='open_problem'&&this.latest.url)return vscode.env.openExternal(vscode.Uri.parse(this.latest.url));
      if(message.type==='copy_sample'&&typeof message.text==='string'&&message.text.length<=20000)await vscode.env.clipboard.writeText(message.text);
    }));
  }
  async accept(value){
    const duplicate=this.latest.revision===value.revision&&this.latest.connected===value.connected;
    this.latest=value;if(this.view)await this.view.webview.postMessage(value);
    if(!duplicate&&value.connected&&['ready','loading'].includes(value.status))await this.show();
  }
  async show(){
    if(this.view)this.view.show(true);
    else await vscode.commands.executeCommand('gridCoach.problemStatement.focus',{preserveFocus:true});
  }
}
module.exports={ProblemView};
