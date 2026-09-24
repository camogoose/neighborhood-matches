// Isolated preview: fixture search/share, real free photo lookup, no AI/storage writes.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const lookup=require('../lib/place-photos.cjs').createPhotoLookup();
const root=path.join(__dirname,'..');
const examples=[
 {match:'Federal Hill',city:'Providence',region:'Rhode Island, USA',tags:['food','community'],whatMakesItSpecial:['Italian restaurants and local dining'],landmarks:[{name:'DePasquale Square',why:'A gathering place'}],blurb:'A food-focused neighborhood with a strong community feel.'},
 {match:'West End',city:'Providence',region:'Rhode Island, USA',tags:['arts','historic'],whatMakesItSpecial:['Historic architecture'],landmarks:[],blurb:'Historic streets and a creative local community.'},
 {match:'Narrowsburg',city:'Narrowsburg',region:'New York, USA',tags:['river town'],whatMakesItSpecial:['Access to the Delaware River'],landmarks:[],blurb:'A small river town.'}
];
http.createServer(async(req,res)=>{
 const url=new URL(req.url,'http://localhost');
 if(url.pathname.startsWith('/photos/') && /^\/photos\/[a-z]+\.jpg$/.test(url.pathname)){
  res.setHeader('Content-Type','image/jpeg');res.end(fs.readFileSync(path.join(root,'public',url.pathname)));return;
 }
 if(url.pathname==='/api/place-photo'){
  res.setHeader('Content-Type','application/json');
  if(url.searchParams.get('match')==='Narrowsburg'){res.end(JSON.stringify({ok:true,photo:null}));return;}
  try{res.end(JSON.stringify(await lookup.lookup(Object.fromEntries(url.searchParams))));}catch{res.statusCode=503;res.end('{}');}return;
 }
 let html=fs.readFileSync(path.join(root,'frontend/squarespace-short-links.html'),'utf8').replaceAll('https://neighborhood-matches.vercel.app','http://127.0.0.1:4319');
 const guard='<script>const realFetch=window.fetch.bind(window);window.fetch=(url,options)=>String(url).includes("/api/like")?Promise.resolve(new Response(JSON.stringify({ok:true,results:'+JSON.stringify(examples)+'}))):String(url).includes("/api/share")?Promise.reject(new Error("Saving disabled in fixture")):realFetch(url,options);</script>';
 res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><p>PHOTO TEST — sample search, real free images. Narrowsburg forces illustrative fallback.</p>'+guard+html);
}).listen(4319,'127.0.0.1',()=>console.log('http://127.0.0.1:4319'));
