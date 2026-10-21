import fs from 'node:fs/promises';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..'),media=path.join(root,'vscode-extension/media');
await fs.mkdir(media,{recursive:true});
for(const file of ['assist-window.html','assist-window.js','sidepanel.css','report-renderer.js','instant-hints.js'])await fs.copyFile(path.join(root,'extension',file),path.join(media,file));
await fs.cp(path.join(root,'extension/vendor'),path.join(media,'vendor'),{recursive:true});
console.log('VS Code 共用界面资源已构建。');
