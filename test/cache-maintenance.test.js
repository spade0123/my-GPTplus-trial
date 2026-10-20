import test from 'node:test';
import assert from 'node:assert/strict';
import {CACHE_WATERMARK_UNITS,createCacheMaintenance} from '../extension/cache-maintenance.js';

test('automatic cleanup checks pressure and quota evidence, and serializes work across tabs',async()=>{
  let time=100000,cleans=0,checks=0;
  let info={url:'page',pageId:'one',usedUnits:CACHE_WATERMARK_UNITS-1,cacheCount:2,quotaFailures:0};
  let unblock;
  const manager=createCacheMaintenance({now:()=>time,inspect:async()=>{checks++;return info;},clean:async()=>{cleans++;if(unblock)await unblock.promise;return {cleared:2,estimatedBytes:4096};}});
  assert.equal((await manager.check(1)).status,'healthy');assert.equal(cleans,0);
  info={...info,usedUnits:CACHE_WATERMARK_UNITS};time+=30000;
  unblock={};unblock.promise=new Promise(r=>unblock.resolve=r);
  const one=manager.check(1),two=manager.check(2,{force:true});
  assert.equal(one,two);await new Promise(r=>setImmediate(r));assert.equal(cleans,1);
  unblock.resolve();assert.equal((await one).status,'cleaned');unblock=null;
  assert.equal((await manager.check(2)).status,'cooldown');assert.equal(checks,2);
  info={...info,usedUnits:1,quotaFailures:1};time+=5000;
  assert.equal((await manager.check(2,{force:true})).status,'cleaned');assert.equal(cleans,2);
  time+=30000;assert.equal((await manager.check(2)).status,'healthy');assert.equal(cleans,2);
  info={...info,pageId:'new-page'};time+=30000;
  assert.equal((await manager.check(3)).status,'cleaned');assert.equal(cleans,3);
});

test('failed backup backs off, retries without new quota events, and never deletes important storage',async()=>{
  let time=100000,attempts=0,removed=0,fail=true;
  const manager=createCacheMaintenance({now:()=>time,inspect:async()=>({pageId:'page',usedUnits:1,cacheCount:1,quotaFailures:1}),clean:async()=>{
    attempts++;if(fail)throw new Error('backup full');removed++;return {cleared:1};
  }});
  const result=await manager.check(1);assert.equal(result.status,'blocked');assert.match(result.error,/backup full/);assert.equal(removed,0);
  time+=30000;assert.equal((await manager.check(1)).status,'cooldown');assert.equal(attempts,1);
  fail=false;time+=30000;assert.equal((await manager.check(1)).status,'cleaned');assert.equal(attempts,2);assert.equal(removed,1);
});

test('no recoverable cache leaves source alone and only warns on a new quota failure',async()=>{
  let time=100000,quota=1,cleans=0;
  const manager=createCacheMaintenance({now:()=>time,inspect:async()=>({pageId:'page',usedUnits:CACHE_WATERMARK_UNITS+1,cacheCount:0,quotaFailures:quota}),clean:async()=>{cleans++;}});
  assert.equal((await manager.check(1)).status,'no_safe_cache');time+=30000;
  assert.equal((await manager.check(1)).status,'empty');time+=5000;quota++;
  assert.equal((await manager.check(1,{force:true})).status,'no_safe_cache');assert.equal(cleans,0);
});
