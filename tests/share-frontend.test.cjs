const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
// Full Squarespace artifact is committed beside the backend for reproducible tests.
const html=fs.readFileSync(require('node:path').join(__dirname,'../frontend/squarespace-short-links.html'),'utf8');
const script=html.match(/<script>([\s\S]*?)<\/script>/)[1];
test('full frontend JavaScript parses',()=>{new vm.Script(script);});
const hydrate=script.slice(script.indexOf('(async function hydrateFromUrl(){'),script.lastIndexOf('})();'));
const snap={v:1,place:'Hood River, Oregon',region:'Europe',priorities:[],results:[{match:'Torbole'}]};
async function run(search,hash='',reply=snap){
  let calls=0, searches=0, rendered=null,status='';
  const context={URLSearchParams,location:{search,hash},placeEl:{value:''},regionEl:{value:''},priorityEls:[],
    lastSnapshot:null,savedShare:null,setLoading(){},setStatus(s){status=s;},showShareControls(){},
    render(r){rendered=r;},runSearch(){searches++;},
    decodeSnapshot(b64){try{return JSON.parse(Buffer.from(b64,'base64url').toString());}catch{return null;}},
    async shareRequest(){calls++;if(reply instanceof Error)throw reply;return {snapshot:reply};}
  };
  vm.createContext(context);await vm.runInContext(hydrate,context);
  return {calls,searches,rendered,status,context};
}
test('short link restores exact results without a model search',async()=>{
  const r=await run('?share='+'a'.repeat(24));assert.equal(r.calls,1);assert.equal(r.searches,0);
  assert.deepEqual(r.rendered,snap.results);assert.equal(r.context.placeEl.value,snap.place);
});
test('invalid, missing and unavailable short links never fall through to paid search',async()=>{
  for(const [id,reply] of [['bad',snap],['a'.repeat(24),new Error('not found')],['b'.repeat(24),null]]){
    const r=await run('?this=Hood&that=Europe&share='+id,'',reply);assert.equal(r.searches,0);assert.equal(r.rendered,null);
  }
});
test('existing frozen links work, broken snapshots do not trigger AI',async()=>{
  const encoded=Buffer.from(JSON.stringify(snap)).toString('base64url');
  const r=await run('?this=Hood&that=Europe','#d='+encoded);assert.equal(r.calls,0);assert.equal(r.searches,0);
  assert.deepEqual(r.rendered,snap.results);
  const broken=await run('?this=Hood&that=Europe','#d=broken');assert.equal(broken.searches,0);
  const empty=await run('?this=Hood&that=Europe','#d=');assert.equal(empty.searches,0);
});
test('ordinary query-only search retains existing behavior',async()=>{
  const r=await run('?this=Hood&that=Europe');assert.equal(r.searches,1);assert.equal(r.calls,0);
});
