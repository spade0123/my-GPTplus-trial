// Browser-only recovery copies. These never enqueue a model job or a submission.
const maxVersions=10;
let writes=Promise.resolve();
function scope(url,account) {
  const u=new URL(url);
  if(u.origin!=='https://programming.pku.edu.cn'||!/^\/probset\/[a-f0-9]{32}\/[a-f0-9]{32}\/ide\.do$/.test(u.pathname)||!/^\d{1,30}$/.test(String(account)))throw new Error('草稿的题目或用户标识无效。');
  return {url:u.origin+u.pathname,account:String(account),key:`pku-drafts:${account}:${u.pathname}`};
}
export async function readDrafts(storage,url,account) {
  const s=scope(url,account),record=(await storage.get(s.key))[s.key];
  return record?.url===s.url&&record.account===s.account?record:{schemaVersion:1,url:s.url,account:s.account,versions:[]};
}
export function storeDraft(storage,draft,pageUrl) {
  const job=writes.catch(()=>{}).then(async()=>{
    const s=scope(pageUrl,draft?.account);
    if(draft.url!==s.url||typeof draft.code!=='string'||draft.code.length>100000)throw new Error('草稿无效或超过 100000 字符，未写入备份。');
    const previous=await readDrafts(storage,s.url,s.account),now=new Date().toISOString();
    const match=previous.versions.find(v=>v.code===draft.code);
    const version={id:match?.id||crypto.randomUUID(),code:draft.code,createdAt:match?.createdAt||now,updatedAt:now};
    const versions=[...previous.versions.filter(v=>v.code!==draft.code),version].slice(-maxVersions);
    const record={schemaVersion:1,url:s.url,account:s.account,title:String(draft.title||'').slice(0,200),updatedAt:now,versions};
    // A failed write must never be acknowledged as a saved recovery copy.
    await storage.set({[s.key]:record});
    return {versionId:version.id,updatedAt:now,record};
  });
  writes=job;
  return job;
}
