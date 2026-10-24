const vscode=require('vscode');
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const percent=value=>Number.isFinite(value)?`${Math.round(value*10)/10}%`:'未知';
const date=value=>value?new Date(value*1000).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):'未提供';
function registerUsage(context,backend){
  let snapshot,error='',loading=false,pending,panel,disposed=false;
  const button=vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right,997);
  button.name='编程网格 账户额度';button.command='gridCoach.accountUsage';
  const rows=()=>snapshot?.buckets.flatMap(bucket=>bucket.windows.map(window=>({...window,bucket})))||[];
  const expired=row=>row.resetsAt&&row.resetsAt*1000<=Date.now();
  function render(){
    if(disposed)return;
    const all=rows(),five=all.filter(row=>row.minutes===300),main=five.find(row=>row.bucket.id==='codex')||five[0];
    const stale=Boolean(error||main&&expired(main));
    button.text=loading&&!snapshot?'$(sync~spin) 额度·读取中':main?`额度·5h 已用 ${percent(main.usedPercent)}${stale?'（待更新）':''}`:'额度·5h 未知';
    button.tooltip=['当前登录 Codex 账户的总用量，包含其他窗口；点击查看详情。',...all.map(row=>`${row.bucket.name} · ${row.minutes===300?'5 小时':row.minutes?row.minutes+' 分钟':'未知窗口'}：已用 ${percent(row.usedPercent)}；北京时间 ${date(row.resetsAt)} 重置`),snapshot?'查询时间：'+new Date(snapshot.checkedAt).toLocaleString('zh-CN'):'',error].filter(Boolean).join('\n');
    if(vscode.workspace.getConfiguration('gridCoach').get('usage.showStatusBar',true))button.show();else button.hide();
    if(!panel)return;
    const card=row=>`<section><h2>${escape(row.bucket.name)} · ${row.minutes===300?'5 小时额度':row.minutes?escape(row.minutes)+' 分钟额度':'窗口长度未提供'}</h2><div class="number">已用 ${percent(row.usedPercent)}</div>${row.usedPercent===null?'':`<progress max="100" value="${row.usedPercent}" aria-label="已用额度"></progress><p>剩余 ${percent(100-row.usedPercent)}</p>`}<p>北京时间 ${escape(date(row.resetsAt))} 重置${expired(row)?' · 重置时间已到，等待重新查询':''}</p></section>`;
    panel.webview.html=`<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font-family:var(--vscode-font-family);padding:16px;color:var(--vscode-editor-foreground);background:var(--vscode-editor-background)}section{border:1px solid var(--vscode-widget-border,#666);border-radius:8px;padding:16px;margin:12px 0}h2{font-size:16px}.number{font-size:30px;font-weight:700}progress{width:100%;accent-color:var(--vscode-progressBar-background)}p{line-height:1.6}a{color:var(--vscode-textLink-foreground)}.muted{color:var(--vscode-descriptionForeground)}</style></head><body><h1>账户额度</h1><p><a href="command:gridCoach.refreshUsage">${loading?'正在读取…':'刷新额度'}</a></p>${error?`<p>${escape(error)}${snapshot?' 下方保留上次读数，可能已过期。':''}</p>`:''}${all.length?[...five,...all.filter(row=>row.minutes!==300)].map(card).join(''):`<p>${loading?'正在读取官方用量…':'尚无可用的额度数据。'}</p>`}${!five.length&&snapshot?'<p>账户没有返回长度为 5 小时的窗口；不将其他窗口换算成 5h。</p>':''}<p class="muted">显示当前登录账户的用量，包含插件、Codex 其他窗口等共享消耗，不能单独归因于本插件。不同额度池分别展示，不相加。100% 代表用完该窗口额度，不代表运行了 5 小时。</p><p class="muted">${snapshot?'最近查询：'+escape(new Date(snapshot.checkedAt).toLocaleString('zh-CN')):'尚未查询成功'}。开启 VS Code 时读取，之后每 5 分钟更新；查询不会生成 AI 回答。数据只保存在当前窗口内存中。</p></body></html>`;
  }
  function refresh(){
    if(pending)return pending;
    loading=true;render();
    pending=(async()=>{try{snapshot=await (await backend()).request({type:'account_usage'});error='';}catch(e){error=e.message;}finally{loading=false;pending=null;render();}})();
    return pending;
  }
  function open(){
    if(panel)panel.reveal();else{
      panel=vscode.window.createWebviewPanel('gridCoachUsage','编程网格 · 账户额度',vscode.ViewColumn.Beside,{enableScripts:false,enableCommandUris:['gridCoach.refreshUsage']});
      panel.onDidDispose(()=>panel=null);
    }
    render();void refresh();
  }
  const timer=setInterval(()=>void refresh(),5*60*1000);
  const repaint=setInterval(render,30000);
  context.subscriptions.push(button,vscode.commands.registerCommand('gridCoach.accountUsage',open),vscode.commands.registerCommand('gridCoach.refreshUsage',refresh),vscode.workspace.onDidChangeConfiguration(event=>{if(event.affectsConfiguration('gridCoach.usage'))render();}),{dispose(){disposed=true;clearInterval(timer);clearInterval(repaint);panel?.dispose();}});
  render();void refresh();
}
module.exports={registerUsage};
