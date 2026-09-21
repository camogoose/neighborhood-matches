// Offline API integration tests. All research and delivery are stubbed.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { candidatePrompt, VERSION } = require('../lib/research-match.cjs');
function harness(failure) {
  const calls = [];
  const source = fs.readFileSync(path.join(__dirname, '../pages/api/like.js'), 'utf8')
    .replace('import researchMatch from "../../lib/research-match.cjs";', '')
    .replace('export const config', 'const config')
    .replace('export default async function handler', 'async function handler');
  const context = { process: { env: { OPENAI_API_KEY: 'test' } }, console: {error(){}},
    researchMatch: { VERSION, createMatcher: () => async (...args) => {
      calls.push(args);
      if (failure) throw failure;
      return { results: [1,2,3].map(i => ({match:'Area '+i, city:'Same city', region:'Country', sources:[]})), research: {} };
    } } };
  vm.createContext(context); vm.runInContext(source, context);
  return { calls, async request(body, method = 'POST') {
    const headers = {};
    const res = { setHeader(k,v){headers[k]=v}, status(code){this.code=code;return this},
      json(payload){this.payload=payload;return this},end(){return this}, headers };
    await context.handler({method,headers:{origin:'https://www.thisplaceisjustlikethatplace.com'},body},res);
    return res;
  } };
}
test('country consideration does not force city diversity', () => {
  const p = candidatePrompt({features:[]}, 'Denmark', []);
  assert.match(p, /all winners can be in one city/);
  assert.match(p, /smaller towns/);
});
test('source, destination and allowed priorities reach research pipeline', async () => {
  const h=harness();
  const r=await h.request({place:' Narrowsburg NY ',region:'Denmark',priorities:['walkability','invalid','walkability','nightlife']});
  assert.equal(r.code,200); assert.equal(h.calls[0][0],'Narrowsburg NY');
  assert.equal(h.calls[0][1],'Denmark');
  assert.equal(JSON.stringify(h.calls[0][2]),JSON.stringify(['walkability','nightlife']));
  assert.equal(r.payload.results.length,3);
  assert(r.payload.results.every(x=>x.city==='Same city' && x.map.gmaps.startsWith('https://')));
  assert.equal(r.headers['Access-Control-Allow-Origin'],'https://www.thisplaceisjustlikethatplace.com');
});
test('invalid input, methods and health never trigger research', async () => {
  const h=harness();
  assert.equal((await h.request({place:'',region:'Denmark'})).code,400);
  assert.equal((await h.request({},'DELETE')).code,405);
  assert.equal((await h.request({},'OPTIONS')).code,200);
  assert.equal((await h.request({},'GET')).payload.version,VERSION);
  assert.equal(h.calls.length,0);
});
test('research failure returns a safe error, not old unsourced results', async () => {
  const r=await harness(new Error('secret-provider-debug')).request({place:'x',region:'y'});
  assert.equal(r.code,503);assert(!JSON.stringify(r.payload).includes('secret-provider-debug'));
  assert.equal(r.payload.ok,false);assert.equal(r.payload.results,undefined);
});
test('known research validation failures remain diagnosable without provider output', async () => {
  for (const message of ['Research did not complete. Please try again.',
    'Web research was unavailable. Please try again.',
    'Research returned an unreadable result. Please try again.',
    'Research returned no sources. Please try again.',
    'Candidate research was incomplete. Please try again.']) {
    const r = await harness(new Error(message)).request({place:'x',region:'y'});
    assert.equal(r.code,503); assert.equal(r.payload.error,message);
  }
});
