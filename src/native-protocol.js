export function frame(value) {
  const data=Buffer.from(JSON.stringify(value));
  if(data.length>900000)throw new Error('回复超过大小限制');
  const header=Buffer.alloc(4);header.writeUInt32LE(data.length);return Buffer.concat([header,data]);
}
export function decoder(onMessage,onError) {
  let buffer=Buffer.alloc(0),failed=false;
  return chunk=>{
    if(failed)return;
    buffer=Buffer.concat([buffer,chunk]);
    try {
      while(buffer.length>=4) {
        const size=buffer.readUInt32LE(0);if(size>300000)throw new Error('消息超过 300KB');
        if(buffer.length<size+4)return;
        const value=JSON.parse(buffer.subarray(4,4+size).toString('utf8'));buffer=buffer.subarray(4+size);onMessage(value);
      }
    }catch(e){failed=true;onError(e);}
  };
}
