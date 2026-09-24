const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'../frontend/squarespace-short-links.html'),'utf8');
const script=html.match(/<script>([\s\S]*?)<\/script>/)[1];
const context={esc:s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;'),chip:s=>'<span>'+s+'</span>',mapSection:()=>'<map/>',articleSection:()=>'<article-link/>'};
vm.createContext(context);
vm.runInContext(script.slice(script.indexOf('  const previewPhotos'),script.indexOf('  function skeleton')),context);
const item={match:'Astoria',city:'New York',region:'New York, USA',blurb:'A complete explanation. '.repeat(30),whatMakesItSpecial:['First detail','Last detail'],landmarks:[{name:'Park',why:'Waterfront'}],tags:['food','arts']};
test('new cards retain full explanation, highlights, landmarks, tags and map',()=>{
 const card=context.card(item,0);
 for(const text of [item.blurb,'First detail','Last detail','Park','Waterfront','food','arts','<map/>']) assert.ok(card.includes(text),text);
 assert.equal((card.match(/<details /g)||[]).length,3);
 assert.ok(!card.includes('<details open'));
});
test('photos require matching place and geography and include credits',()=>{
 const card=context.card(item,0);assert.ok(card.includes('<img'));assert.ok(card.includes('Rsmn'));assert.ok(card.includes('publicdomain/zero/1.0'));
 const unknown=context.card({...item,region:'Oregon, USA'},0);assert.ok(!unknown.includes('<img'));assert.ok(unknown.includes('tt-no-photo'));
});
test('result text is escaped',()=>{assert.ok(!context.card({...item,blurb:'<script>alert(1)</script>'},0).includes('<script>'));});
test('map loads only on expansion and retains accessible title',()=>{
 assert.ok(script.includes('<iframe data-src="${iframe}" title="Map of ${esc(q)}"'));
 assert.ok(script.includes("event.target.open"));
});
test('production artifact has no demo data, preview guards or sample sharing behavior',()=>{
 for(const text of ['DESIGN PREVIEW','design-only preview','const sample =','This preview does not save','Different places, familiar possibilities.']) assert.ok(!html.includes(text),text);
 assert.ok(script.includes('await fetch(API_URL'));
 assert.ok(script.includes("shareRequest({ method: 'POST'"));
});
