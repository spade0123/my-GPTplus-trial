const vscode=require('vscode');
function relocateUri(value,files){
  let uri;try{uri=vscode.Uri.parse(value);}catch{return value;}
  for(const {oldUri,newUri}of files){
    if(uri.scheme!==oldUri.scheme||uri.authority!==oldUri.authority||oldUri.scheme!==newUri.scheme||oldUri.authority!==newUri.authority)continue;
    const prefix=oldUri.path.replace(/\/$/,'');
    if(uri.path===prefix||uri.path.startsWith(prefix+'/'))return newUri.with({path:newUri.path.replace(/\/$/,'')+uri.path.slice(prefix.length),query:uri.query,fragment:uri.fragment}).toString();
  }
  return value;
}
function relocatePanels(collection,files){
  for(const [key,state]of [...collection]){
    const next=relocateUri(state.uri,files);if(next===state.uri)continue;
    collection.delete(key);state.uri=next;collection.set(next,state);
  }
}
module.exports={relocateUri,relocatePanels};
