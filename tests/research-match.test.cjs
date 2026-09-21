const { test } = require('node:test');
const assert = require('node:assert/strict');
const { safeUrl, unpack, validateProfile, rankCandidates, createCache, createMatcher, profilePrompt } = require('../lib/research-match.cjs');
// Synthetic fixtures check mechanics, NOT the accuracy of real destination recommendations.
const urls = ['https://tourism.example/place', 'https://parks.example/place'];
const sources = new Map(urls.map(url => [url, {url,title:'Fixture evidence'}]));
const profile = (name='Narrowsburg NY', placeType='hamlet', activity=false) => ({
  name, placeType, sources:[...sources.values()], researchedAt:'2026-09-21', features: [
    {id:'scale',kind:'scale',importance:'defining',claim:'Small settlement',evidenceUrls:[urls[0]]},
    {id:activity?'activity':'setting',kind:activity?'activity':'setting',importance:'defining',
      claim:activity?'Wind sports are central':'Riverside rural escape',evidenceUrls:[urls[1]]},
    {id:'shops',kind:'culture',importance:'supporting',claim:'Independent shops',evidenceUrls:[urls[0]]},
  ]});
const candidate = (p, overrides={}) => ({ match:'Fixture town',city:'',region:'Denmark',placeType:'small_town',inScope:true,
  blurb:'A comparable setting',caveat:'Different local traditions',evidenceUrls:[urls[0]],tags:['river'],preferenceFit:0.5,
  comparisons:p.features.map(f=>({featureId:f.id,fit:'strong',reason:'Evidence-backed comparison',evidenceUrls:[urls[1]]})),...overrides });
const envelope = data => ({status:'completed',output:[
  {type:'web_search_call',status:'completed',action:{sources:[...sources.values()]}},
  {type:'message',content:[{type:'output_text',text:JSON.stringify(data),annotations:[]}]}
]});

test('Narrowsburg: urban gallery district cannot beat or substitute for a small river town', () => {
  const p=profile();
  const r=rankCandidates(p,{sources,data:{candidates:[candidate(p,{match:'Urban galleries',placeType:'urban_neighborhood',preferenceFit:1}),candidate(p)]}});
  assert.equal(r.length,1);assert.equal(r[0].match,'Fixture town');
});
test('Hood River: missing defining wind sports is not rescued by shops', () => {
  const p=profile('Hood River OR','town',true);
  const bad=candidate(p,{match:'Shopping town'});bad.comparisons[1].fit='mismatch';
  const r=rankCandidates(p,{sources,data:{candidates:[bad,candidate(p,{match:'Wind town'})]}});
  assert.deepEqual(r.map(x=>x.match),['Wind town']);
});
test('Lower East Side: urban matches remain eligible and same-city results are allowed', () => {
  const p=profile('Lower East Side NYC','urban_neighborhood');
  const r=rankCandidates(p,{sources,data:{candidates:[1,2,3].map(n=>candidate(p,{match:'District '+n,city:'Same city',placeType:'urban_neighborhood'}))}});
  assert.equal(r.length,3);assert(r.every(x=>x.city==='Same city'));
});
test('defining identity outranks perfect preferences and supporting similarities', () => {
  const p=profile(); const partial=candidate(p,{match:'Partial',preferenceFit:1});partial.comparisons[1].fit='partial';
  const strong=candidate(p,{match:'Strong',preferenceFit:0});strong.comparisons[2].fit='mismatch';
  const r=rankCandidates(p,{sources,data:{candidates:[partial,strong]}});
  assert.equal(r[0].match,'Strong');
});
test('uncited, out-of-scope, unknown and duplicate candidates cannot fill slots', () => {
  const p=profile();const unknown=candidate(p,{match:'Unknown'});unknown.comparisons[0].fit='unknown';
  const fake=candidate(p,{match:'Fake'});fake.comparisons[0].evidenceUrls=['https://invented.example/x'];
  const r=rankCandidates(p,{sources,data:{candidates:[unknown,fake,candidate(p,{inScope:false}),candidate(p),candidate(p)]}});
  assert.equal(r.length,1);assert(r[0].sources.every(s=>sources.has(s.url)));
  assert.match(r[0].blurb,/Difference:/);
});
test('source profile requires evidence, scale and two independent source domains', () => {
  const p=profile();assert.equal(validateProfile({data:p,sources}).placeType,'hamlet');
  const bad=structuredClone(p);bad.features.forEach(f=>f.evidenceUrls=[urls[0]]);
  assert.throws(()=>validateProfile({data:bad,sources}),/reliable information/);
  assert.throws(()=>validateProfile({data:{},sources}),/identify/);
});
test('refused, incomplete, malformed, unsearched or uncited research fails closed', () => {
  assert.throws(()=>unpack({status:'incomplete'}));
  assert.throws(()=>unpack({status:'completed',output:[]}));
  const bad=envelope({});bad.output[1].content[0].text='Not JSON';assert.throws(()=>unpack(bad));
  const noSources=envelope({});noSources.output[0].action.sources=[];assert.throws(()=>unpack(noSources));
  assert.equal(safeUrl('javascript:alert(1)'), '');assert.equal(safeUrl('https://user:password@example.org'), '');
});
test('cache coalesces requests, expires, bounds size and retries after failure', async () => {
  let now=0,calls=0;const cache=createCache({max:2,now:()=>now});
  const make=async()=>++calls;
  assert.deepEqual(await Promise.all([cache('a',10,make),cache('a',10,make)]),[1,1]);
  now=11;assert.equal(await cache('a',10,make),2);
  await assert.rejects(cache('b',10,async()=>{throw Error('failure')}));
  assert.equal(await cache('b',10,make),3);
  await cache('c',10,make);assert.equal(await cache('a',10,make),5);
});
test('pipeline searches source first, then researched candidates, and caches repeat searches', async () => {
  const p=profile();const calls=[];
  const matcher=createMatcher({env:{OPENAI_API_KEY:'test'},fetchImpl:async(url,options)=>{
    calls.push(JSON.parse(options.body));
    return {ok:true,json:async()=>calls.length===1?envelope(p):envelope({candidates:[candidate(p)]})};
  }});
  const first=await matcher('Narrowsburg NY','Denmark',['arts and creative scene']);
  assert.equal(first.results.length,1);assert.match(first.research.notice,/Fewer than three/);
  await matcher(' NARROWSBURG NY ','Denmark',['arts and creative scene']);
  assert.equal(calls.length,2);
  assert.match(calls[1].input,/Riverside rural escape/);
  assert.equal(calls[0].tool_choice,'required');assert.equal(calls[0].store,false);
  assert.equal(calls[0].max_tool_calls,5);
});
test('provider failures and missing key do not fall back to guessed matches', async () => {
  const unavailable=createMatcher({env:{OPENAI_API_KEY:'test'},fetchImpl:async()=>({ok:false})});
  await assert.rejects(unavailable('Narrowsburg','Denmark'),/unavailable/);
  await assert.rejects(createMatcher({env:{}})('a','b'),/not configured/);
});
test('profile instructions cover proximity, seasonality and defining versus incidental activities', () => {
  const p=profilePrompt('Hood River OR');
  assert.match(p,/relationship to major cities/);assert.match(p,/seasonality/);
  assert.match(p,/available nearby does not mean it defines/);
});
