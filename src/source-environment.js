export function sourceEnvironment(uri){
  try{const url=new URL(uri);if(url.protocol==='vscode-remote:')return /^wsl\+/i.test(url.hostname)?'wsl':'remote';}catch{}
  return undefined;
}
export async function captureDiagnostics(capture,compile,options){
  if(capture.sourceEnvironment)return {status:'not_requested',ranProgram:false,environment:capture.sourceEnvironment,warning:'源码来自远程工作区，未使用 Windows 本机编译器检查。请以远程 VS Code 诊断、Ctrl+Shift+B 构建和网格评测为准。'};
  return compile(capture.code,capture.standard,options);
}
