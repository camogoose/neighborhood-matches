const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const budgetMatch = require('../lib/budget-match.cjs');
const { cacheKey, createResultCache, normalizeResults } = budgetMatch;
const result = { match: 'Example village', city: '', region: 'Denmark', blurb: 'A small riverside settlement. It differs in climate.', tags: ['river'], whatMakesItSpecial: ['Small scale'], landmarks: [] };
function harness({ fail = false, finish = 'stop', output = { results: [result] }, env = {} } = {}) {
  const calls = [], clients = [];
  class OpenAI {
    constructor(options) { clients.push(options); this.chat = { completions: { create: async options => {
      calls.push(options);
      if (fail) throw new Error('secret provider debug');
      return { choices: [{ finish_reason: finish, message: { content: JSON.stringify(output) } }] };
    } } }; }
  }
  const source = fs.readFileSync(path.join(__dirname, '../pages/api/like.js'), 'utf8')
    .replace('import OpenAI from "openai";', '')
    .replace('import budgetMatch from "../../lib/budget-match.cjs";', '')
    .replace('export const config', 'const config').replace('export default async function handler', 'async function handler');
  const context = { OpenAI, budgetMatch, process: { env: { OPENAI_API_KEY: 'fake', ...env } } };
  vm.createContext(context); vm.runInContext(source, context);
  return { calls, clients, async request(body = {place:'Narrowsburg NY',region:'Denmark'}, method = 'POST') {
    const res = { headers: {}, setHeader(k,v){this.headers[k]=v}, status(c){this.code=c;return this}, json(p){this.payload=p;return this}, end(){return this} };
    await context.handler({method,body,headers:{origin:'https://thisplaceisjustlikethatplace.com'}},res); return res;
  } };
}
test('single original-model call, no web tools, retries disabled and bounded output', async () => {
  const h=harness(); const r=await h.request();
  assert.equal(r.code,200); assert.equal(h.calls.length,1);
  assert.equal(h.calls[0].model,'gpt-4o-mini'); assert.equal(h.calls[0].tools,undefined);
  assert.equal(h.calls[0].max_tokens,2200); assert.equal(h.calls[0].response_format.type,'json_object');
  assert.equal(h.clients[0].maxRetries,0); assert.equal(h.clients[0].timeout,25000);
  assert.equal(r.payload.results[0].news,null); assert.match(r.payload.results[0].map.gmaps,/google.com\/maps/);
});
test('identity precedes amenities, country scope has no diversity quota', async () => {
  const h=harness(); await h.request(); const p=h.calls[0].messages[1].content;
  for(const part of ['hamlet, village, small town','signature activities FIRST','rural weekend escape','wind-sports','Geographic diversity is NOT','Return up to 3','not imaginary research']) assert(p.includes(part));
  assert(p.indexOf('defining identity') < p.indexOf('compare walkability'));
});
test('source inputs and preferences retained; preference changes do not reuse wrong results', async () => {
  const h=harness();
  await h.request({place:'Hood River OR',region:'Denmark',priorities:['walkability','invalid','walkability']});
  await h.request({place:' hood river OR ',region:' denmark ',priorities:['walkability']});
  assert.equal(h.calls.length,1);
  await h.request({place:'Hood River OR',region:'Denmark',priorities:['nightlife']});
  assert.equal(h.calls.length,2); assert(h.calls[0].messages[1].content.includes('Hood River OR'));
});
test('invalid input, health, preflight, paused and missing key make no model calls', async () => {
  const h=harness(); assert.equal((await h.request({place:'',region:'x'})).code,400);
  for(const method of ['GET','OPTIONS','DELETE']) await h.request({},method);
  assert.equal(h.calls.length,0);
  for(const env of [{MATCHING_PAUSED:'true'},{OPENAI_API_KEY:''}]) {
    const p=harness({env}); assert((await p.request()).code>=500); assert.equal(p.calls.length,0); assert.equal(p.clients.length,0);
  }
});
test('provider failures and truncated or malformed results fail safely', async () => {
  for(const options of [{fail:true},{finish:'length'},{output:{}},{output:{results:[{}]}}]) {
    const h=harness(options);const r=await h.request();assert.equal(r.code,503);
    assert(!JSON.stringify(r.payload).includes('secret')); assert.equal(h.calls.length,1);
  }
});
test('fewer results and empty result set remain valid; exact duplicates removed', () => {
  assert.equal(normalizeResults({results:[]}).length,0);
  assert.equal(normalizeResults({results:[result,result]}).length,1);
  assert.equal(normalizeResults({results:[{...result,rank:9,score:200} ]})[0].rank,1);
  assert.equal(normalizeResults({results:[{...result,score:200} ]})[0].score,1);
});
test('cache coalesces pending work, expires and does not cache failures', async () => {
  let time=0,calls=0,release;
  const c=createResultCache({now:()=>time,ttl:10});
  const make=()=>{calls++;return new Promise(resolve=>{release=resolve})};
  const a=c('x',make),b=c('x',make);await Promise.resolve();assert.equal(calls,1);release('ok');
  assert.deepEqual(await Promise.all([a,b]),['ok','ok']);
  assert.equal(await c('x',()=>{throw Error()}),'ok');time=11;
  assert.equal(await c('x',()=> 'new'),'new');
  await assert.rejects(c('bad',()=>{throw Error('bad')}));assert.equal(await c('bad',()=> 'recovered'),'recovered');
});
test('cache bounds concurrent misses, preserves pending work and caps completed entries', async () => {
  const c=createResultCache({max:1,maxActive:1});let release;
  const a=c('a',()=>new Promise(r=>{release=r}));await Promise.resolve();
  await assert.rejects(c('b',()=> 'b'),{code:'BUSY'});release('a');await a;
  assert.equal(await c('b',()=> 'b'),'b');assert.equal(await c('a',()=> 'again'),'again');
});
test('cache keys preserve geographic distinctions and normalize priority order', () => {
  assert.equal(cacheKey(' A ',' B ',['x','y']),cacheKey('a','b',['y','x']));
  assert.notEqual(cacheKey('a','b',[]),cacheKey('a','c',[]));
});
