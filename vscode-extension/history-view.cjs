const vscode=require('vscode'),{randomUUID}=require('node:crypto');
function openHistory({context,backend}){
  const panel=vscode.window.createWebviewPanel('gridCoachHistory','编程网格 · 对话历史',vscode.ViewColumn.Active,{enableScripts:true,retainContextWhenHidden:true,localResourceRoots:[context.extensionUri]});
  const uri=file=>panel.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri,file)).toString(),nonce=randomUUID().replace(/-/g,'');
  const src=panel.webview.cspSource;
  panel.webview.html='<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src '+src+' data:; style-src '+src+' \'unsafe-inline\'; font-src '+src+'; script-src \'nonce-'+nonce+'\';"><link rel="stylesheet" href="'+uri('media/vendor/katex/katex.min.css')+'"><link rel="stylesheet" href="'+uri('history.css')+'"></head><body><main><aside><header><strong>对话历史</strong><button id="refresh">刷新</button></header><input id="search" type="search" placeholder="搜索题目或对话名称" aria-label="搜索题目或对话名称"><label class="muted"><input id="archived" type="checkbox"> 显示已归档</label><nav id="topics" aria-label="题目列表"></nav><button id="quick">打开快捷交流</button></aside><section class="workspace"><div id="threads" aria-label="题内对话列表"></div><div id="toolbar" hidden><input id="title" maxlength="80" aria-label="对话名称"><button id="rename">重命名</button><button id="archive">归档</button><button id="export">导出 Markdown</button></div><div id="notice" role="status"></div><div id="transcript" aria-live="polite"><p class="empty">选择左侧题目，再选择对话。这里展示本机插件保存的记录。</p></div><form id="composer" hidden><div id="contextNote" class="muted"></div><div id="reference" hidden></div><textarea id="question" maxlength="2000" rows="3" placeholder="继续追问这段对话…（Ctrl / ⌘ + Enter 发送）" aria-label="追问内容"></textarea><footer><span class="muted">只有发送才调用 AI · 沿用历史代码快照</span><button id="send" type="submit">发送追问</button></footer></form></section></main><script nonce="'+nonce+'" src="'+uri('media/vendor/marked/marked.umd.js')+'"></script><script nonce="'+nonce+'" src="'+uri('media/vendor/katex/katex.min.js')+'"></script><script nonce="'+nonce+'" src="'+uri('media/report-renderer.js')+'"></script><script nonce="'+nonce+'" src="'+uri('history.js')+'"></script></body></html>';
  const allowed=new Set(['conversation_snapshot','conversation_topics','conversation_detail','conversation_create','conversation_update','conversation_followup']);
  const listener=panel.webview.onDidReceiveMessage(async message=>{
    const requestId=message?.requestId;
    try{
      if(message?.type==='quick'){await vscode.commands.executeCommand('gridCoach.discussion');return;}
      if(message?.type==='copy_code'){
        if(typeof message.text!=='string'||message.text.length>100000)throw new Error('复制内容过长。');
        await vscode.env.clipboard.writeText(message.text);await panel.webview.postMessage({requestId,value:{copied:true}});return;
      }
      if(message?.type==='export'){
        if(typeof message.text!=='string'||message.text.length>3000000)throw new Error('导出内容过长。');
        const active=vscode.window.activeTextEditor?.document.uri,folder=(active&&vscode.workspace.getWorkspaceFolder(active))||vscode.workspace.workspaceFolders?.[0];
        const target=await vscode.window.showSaveDialog({defaultUri:vscode.Uri.joinPath(folder?.uri||context.globalStorageUri,'grid-conversation.md'),filters:{Markdown:['md']}});
        if(target)await vscode.workspace.fs.writeFile(target,Buffer.from(message.text,'utf8'));
        return;
      }
      if(!allowed.has(message?.type)||typeof requestId!=='string')return;
      const {requestId:_id,...request}=message;
      const value=await(await backend()).request(request);
      await panel.webview.postMessage({requestId,value});
    }catch(error){await panel.webview.postMessage({requestId,error:error.message});}
  });
  panel.onDidDispose(()=>listener.dispose());context.subscriptions.push(panel);return panel;
}
module.exports={openHistory};
