export function outputDifference(actual,expected){
  const a=Array.from(String(actual).replace(/\r\n?/g,'\n')),b=Array.from(String(expected).replace(/\r\n?/g,'\n'));
  let index=0;while(index<a.length&&index<b.length&&a[index]===b[index])index++;
  if(index===a.length&&index===b.length)return null;
  const prefix=a.slice(0,index).join(''),row=prefix.split('\n').length,column=Array.from(prefix.slice(prefix.lastIndexOf('\n')+1)).length+1;
  const show=chars=>chars.slice(Math.max(0,index-25),index+40).join('').replace(/ /g,'␠').replace(/\t/g,'⇥').replace(/\n/g,'↵\n')+(index>=chars.length?'∎（结束）':'');
  return {row,column,index,actual:show(a),expected:show(b),actualCharacter:a[index]??null,expectedCharacter:b[index]??null};
}
