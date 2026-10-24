// Serialized into the logged-in page. Return a small raster, never HTML or SVG source.
export async function readGridProblemImage(expectedUrl,id){
  try{
    const expected=new URL(expectedUrl),match=String(id).match(/^figure-(\d+)-([a-f0-9]{1,8})$/);
    if(!match||location.origin!==expected.origin||location.pathname!==expected.pathname||expected.origin!=='https://programming.pku.edu.cn')throw new Error('题目已改变，请刷新题面。');
    const image=document.querySelectorAll('img')[Number(match[1])];if(!image)throw new Error('参考图位置已改变，请刷新题面。');
    const source=(image.getAttribute('src')||'')+'|'+(image.getAttribute('srcset')||'');let hash=2166136261;for(let i=0;i<source.length;i++)hash=Math.imul(hash^source.charCodeAt(i),16777619);
    if((hash>>>0).toString(16)!==match[2])throw new Error('参考图已更新，请刷新题面。');
    let timer;
    try{if(!image.complete||!image.naturalWidth)await Promise.race([image.decode(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('网页图片尚未加载完成。')),5000);})]);}finally{clearTimeout(timer);}
    if(!image.naturalWidth||!image.naturalHeight)throw new Error('网页图片没有加载成功。');
    const canvas=document.createElement('canvas');let scale=Math.min(1,1600/image.naturalWidth,1600/image.naturalHeight);
    for(let attempt=0;attempt<6;attempt++){
      canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));
      canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);
      let dataUrl=canvas.toDataURL(attempt===0?'image/png':'image/webp',0.85);
      if(dataUrl.length<=170000&&/^data:image\/(?:png|webp);base64,/.test(dataUrl)){
        if(location.pathname!==expected.pathname)throw new Error('读取参考图期间切换了题目。');
        return {dataUrl,width:canvas.width,height:canvas.height};
      }
      scale*=0.72;
    }
    throw new Error('参考图过大，请在原题页面查看。');
  }catch(error){return {error:error?.name==='SecurityError'?'这张图禁止跨页面读取，请在原题页面查看。':String(error.message||'图片读取失败').slice(0,300)};}
}
