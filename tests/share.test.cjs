const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const share = require('../lib/share-store.cjs');
const sample = () => ({ v:1, place:'Narrowsburg, NY', region:'California', priorities:[], results:[{
  rank:1, match:'Nevada City', city:'Nevada City', region:'California, USA', blurb:'River access — cafés & walks.',
  whatMakesItSpecial:['Outdoors'], landmarks:[{name:'Town center',why:'Walks'}], tags:['small town'],news:null
}] });
test('snapshot preserves result text and Unicode, drops unexpected fields', () => {
  const s = sample(); assert.deepEqual(share.snapshot({...s, secret:'discard'}),s);
});
test('reject malformed, oversized, empty and unsafe article snapshots', () => {
  for (const value of [null,{}, {...sample(),v:2}, {...sample(),results:[]}, {...sample(),place:'x'.repeat(121)}]) assert.throws(()=>share.snapshot(value));
  const s=sample(); s.results[0].news={title:'bad',url:'javascript:alert(1)'};
  assert.throws(()=>share.snapshot(s));
  s.results[0].news=null;s.results[0].landmarks=[null];assert.throws(()=>share.snapshot(s));
});
test('storage uses one atomic capped save, stable IDs and exact snapshot retrieval',async()=>{
  const records=new Map();const commands=[];
  const fetchImpl=async(url,opts)=>{
    assert.equal(url,'https://test.upstash.io');assert.equal(opts.headers.Authorization,'Bearer test');
    const args=JSON.parse(opts.body);commands.push(args);
    let result;
    if(args[0]==='EVAL') {
      assert.equal(args[1],share.SAVE_SCRIPT);assert.equal(args[2],4);
      result=records.has(args[3])?'EXISTS':'CREATED';records.set(args[3],args[7]);
    } else { assert.equal(args[0],'GET');result=records.get(args[1])??null; }
    return {ok:true,json:async()=>({result})};
  };
  const store=share.createShareStore({url:'https://test.upstash.io',token:'test',fetchImpl});
  const id=await store.save(sample());assert.match(id,share.ID_PATTERN);
  assert.equal(await store.save(sample()),id);assert.equal(records.size,1);
  assert.deepEqual(await store.get(id),sample());assert.equal(await store.get('0'.repeat(24)),null);
  const before=commands.length;await assert.rejects(store.get('../../x'));assert.equal(commands.length,before);
  assert.match(share.SAVE_SCRIPT,/count >= 20000/);assert.match(share.SAVE_SCRIPT,/100663296/);
  assert.match(share.SAVE_SCRIPT,/daily >= 500/);
});
test('capacity, daily cap and provider errors do not retry or leak credentials',async()=>{
  for(const result of ['FULL','LIMIT','unexpected']) {
    let count=0;const store=share.createShareStore({url:'https://test.upstash.io',token:'secret',fetchImpl:async()=>{count++;return{ok:true,json:async()=>({result})};}});
    await assert.rejects(store.save(sample()));assert.equal(count,1);
  }
  const store=share.createShareStore({url:'https://test.upstash.io',token:'secret',fetchImpl:async()=>({ok:true,json:async()=>({error:'secret provider failure'})})});
  await assert.rejects(store.get('a'.repeat(24)),/Storage unavailable/);
  assert.throws(()=>share.createShareStore({url:'http://example.com',token:'x'}));
});
function api(env={},fetch=async()=>{throw Error('unexpected storage call');}) {
  const code=fs.readFileSync(require.resolve('../pages/api/share.js'),'utf8')
    .replace("import shareStore from '../../lib/share-store.cjs';",'')
    .replace('export const config','const config').replace('export default async function handler','async function handler');
  const context={shareStore:{...share,createShareStore:opts=>share.createShareStore({...opts,fetchImpl:fetch})},process:{env}};
  vm.createContext(context);vm.runInContext(code,context);return context.handler;
}
async function invoke(handler,req) {
  const response={headers:{},setHeader(k,v){this.headers[k]=v;},status(n){this.code=n;return this;},json(v){this.body=v;return this;},end(){return this;}};
  await handler({headers:{},query:{},...req},response);return response;
}
test('HTTP validation, CORS, disabled configuration and method gates make no storage calls',async()=>{
  const handler=api();
  assert.equal((await invoke(handler,{method:'POST',body:sample()})).code,503);
  assert.equal((await invoke(handler,{method:'POST',body:{}})).code,400);
  assert.equal((await invoke(handler,{method:'GET',query:{id:['a','b']}})).code,400);
  assert.equal((await invoke(handler,{method:'POST',headers:{origin:'https://evil.example'},body:sample()})).code,403);
  const preflight=await invoke(handler,{method:'OPTIONS',headers:{origin:'https://www.thisplaceisjustlikethatplace.com'}});
  assert.equal(preflight.code,204);assert.equal(preflight.headers['Access-Control-Allow-Origin'],'https://www.thisplaceisjustlikethatplace.com');
  assert.equal((await invoke(handler,{method:'DELETE'})).code,405);
});
test('HTTP GET serves saved results, misses stay 404; POST returns canonical short URL',async()=>{
  const handler=api({SHARING_ENABLED:'true',UPSTASH_REDIS_REST_URL:'https://test.upstash.io',UPSTASH_REDIS_REST_TOKEN:'test'},async(url,opts)=>{
    const args=JSON.parse(opts.body);return {ok:true,json:async()=>({result:args[0]==='EVAL'?'CREATED':args[1].endsWith('0'.repeat(24))?null:JSON.stringify(sample())})};
  });
  const saved=await invoke(handler,{method:'POST',body:sample()});assert.equal(saved.code,200);
  assert.equal(saved.body.url,'https://www.thisplaceisjustlikethatplace.com/?share='+saved.body.id);
  const read=await invoke(handler,{method:'GET',query:{id:saved.body.id}});assert.equal(read.code,200);assert.deepEqual(read.body.snapshot,sample());
  assert.equal((await invoke(handler,{method:'GET',query:{id:'0'.repeat(24)}})).code,404);
});
test('Marketplace credentials work without exposing secrets or using read-only tokens',async()=>{
  const env={SHARING_ENABLED:'true',KV_REST_API_URL:'https://test.upstash.io',KV_REST_API_TOKEN:'write-token',KV_REST_API_READ_ONLY_TOKEN:'read-token'};
  const handler=api(env,async(url,opts)=>{
    assert.equal(url,env.KV_REST_API_URL);
    assert.equal(opts.headers.Authorization,'Bearer write-token');
    return {ok:true,json:async()=>({result:'CREATED'})};
  });
  const saved=await invoke(handler,{method:'POST',body:sample()});
  assert.equal(saved.code,200);assert.equal(JSON.stringify(saved.body).includes('write-token'),false);
  assert.equal((await invoke(api({...env,SHARING_ENABLED:'false'}),{method:'POST',body:sample()})).code,503);
  assert.equal((await invoke(api({...env,KV_REST_API_TOKEN:undefined}),{method:'POST',body:sample()})).code,503);
});
