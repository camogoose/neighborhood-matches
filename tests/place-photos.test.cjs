const {test}=require('node:test');
const assert=require('node:assert/strict');
const {input,candidate,photoFromInfo,createPhotoLookup}=require('../lib/place-photos.cjs');
const place={match:'Federal Hill',city:'Providence',region:'Rhode Island, USA'};
const page={title:'Federal Hill, Providence, Rhode Island',extract:'A neighborhood of Providence in Rhode Island.',coordinates:[{lat:41,lon:-71}],pageimage:'Fountain.jpg',index:1};
const file={title:'File:Fountain.jpg',imageinfo:[{mime:'image/jpeg',width:1200,height:800,thumburl:'https://upload.wikimedia.org/wikipedia/commons/a/ab/Fountain.jpg',descriptionurl:'https://commons.wikimedia.org/wiki/File:Fountain.jpg',extmetadata:{Artist:{value:'<b>Photographer</b>'},LicenseShortName:{value:'CC BY-SA 4.0'},LicenseUrl:{value:'https://creativecommons.org/licenses/by-sa/4.0'}}}]};
test('location identity rejects name collisions, disambiguation and incidental mentions',()=>{
 assert.ok(candidate(page,place.match,place,'place'));
 assert.ok(!candidate({...page,title:'Federal Hill, Baltimore',extract:'Baltimore Maryland'},place.match,place,'place'));
 assert.ok(!candidate({...page,pageprops:{disambiguation:''}},place.match,place,'place'));
 assert.ok(!candidate({...page,title:'A biography'},place.match,place,'place'));
});
test('licenses, source hosts and dimensions are constrained',()=>{
 const p=photoFromInfo(page,file,'place',place,place.match);assert.equal(p.author,'Photographer');
 for(const change of [{thumburl:'https://evil.test/a.jpg'},{width:100},{extmetadata:{...file.imageinfo[0].extmetadata,LicenseUrl:{value:'https://creativecommons.org/licenses/by-nc/4.0'}}}])assert.equal(photoFromInfo(page,{...file,imageinfo:[{...file.imageinfo[0],...change}]},'place',place,place.match),null);
});
test('input rejects arrays and excessive strings before requesting anything',()=>{
 assert.throws(()=>input({...place,match:['a']}));assert.throws(()=>input({...place,city:'x'.repeat(161)}));
});
test('lookup is cached, deduplicated and excludes country suffix from search',async()=>{
 let calls=[];const lookup=createPhotoLookup({fetchImpl:async url=>{calls.push(url);return {ok:true,json:async()=>({query:{pages:url.startsWith('https://en.')?[page]:[file]}})}}});
 const [a,b]=await Promise.all([lookup.lookup(place),lookup.lookup(place)]);
 assert.deepEqual(a,b);assert.ok(a.photo);assert.equal(calls.length,2);
 assert.ok(!new URL(calls[0]).searchParams.get('gsrsearch').includes('USA'));
 await lookup.lookup(place);assert.equal(calls.length,2);
});
test('no matching article returns no photo instead of an unrelated city',async()=>{
 let calls=0;const lookup=createPhotoLookup({fetchImpl:async()=>{calls++;return {ok:true,json:async()=>({query:{pages:[]}})}}});
 assert.equal((await lookup.lookup(place)).photo,null);assert.equal(calls,1);
});
test('provider errors are surfaced, not cached as successful place photos',async()=>{
 const lookup=createPhotoLookup({fetchImpl:async()=>({ok:false})});await assert.rejects(lookup.lookup(place));
});
