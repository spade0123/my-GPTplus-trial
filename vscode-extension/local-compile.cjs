// Invoked only by the user's VS Code build task, never by website judging.
const fs=require('node:fs/promises'),path=require('node:path'),{spawn}=require('node:child_process');
(async()=>{
  const [compiler,source,rawArgs]=process.argv.slice(2),args=JSON.parse(rawArgs||'[]');
  if(!compiler||!path.isAbsolute(source||'')||! /\.(?:c|cc|cpp|cxx)$/i.test(source)||!Array.isArray(args)||args.length>100||args.some(arg=>typeof arg!=='string'||arg.includes('\0')||/^-o/.test(arg)))throw new Error('编译参数无效，输出目录由插件统一管理。');
  const directory=path.join(path.dirname(source),'build');
  await fs.mkdir(directory,{recursive:true});
  if((await fs.lstat(directory)).isSymbolicLink())throw new Error('build 不能是符号链接，请使用源码目录内的普通文件夹。');
  try{await fs.writeFile(path.join(directory,'.gitignore'),'*\n!.gitignore\n',{flag:'wx'});}catch(error){if(error.code!=='EEXIST')throw error;}
  const output=path.join(directory,path.basename(source,path.extname(source))+(process.platform==='win32'?'.exe':''));
  console.log('源码：'+source+'\n产物：'+output);
  const child=spawn(compiler,[...args,source,'-o',output],{cwd:path.dirname(source),shell:false,windowsHide:true,stdio:'inherit'});
  child.on('error',error=>{console.error('编译器启动失败：'+error.message);process.exitCode=1;});
  child.on('exit',code=>{process.exitCode=code===null?1:code;});
})().catch(error=>{console.error(error.message);process.exitCode=1;});
