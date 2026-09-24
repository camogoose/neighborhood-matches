import photos from '../../lib/place-photos.cjs';
const lookup=photos.createPhotoLookup();
const origins=new Set(['https://thisplaceisjustlikethatplace.com','https://www.thisplaceisjustlikethatplace.com']);
if(process.env.VERCEL_ENV==='preview')for(const host of [process.env.VERCEL_URL,process.env.VERCEL_BRANCH_URL])if(host && /^[a-z0-9-]+\.vercel\.app$/.test(host))origins.add('https://'+host);
export default async function handler(req,res){
  res.setHeader('Vary','Origin');res.setHeader('Cache-Control','no-store');
  const origin=req.headers.origin;
  if(origin && !origins.has(origin))return res.status(403).json({ok:false,error:'Origin not allowed.'});
  if(origin)res.setHeader('Access-Control-Allow-Origin',origin);
  res.setHeader('Access-Control-Allow-Methods','GET,OPTIONS');
  if(req.method==='OPTIONS')return res.status(204).end();
  if(req.method!=='GET'){res.setHeader('Allow','GET,OPTIONS');return res.status(405).json({ok:false,error:'Method not allowed.'});}
  try{
    const result=await lookup.lookup(req.query);
    res.setHeader('Cache-Control',result.photo?'public, max-age=3600, s-maxage=86400':'public, max-age=300, s-maxage=900');
    return res.status(200).json(result);
  }catch(error){return res.status(error.status===400?400:error.status===429?429:503).json({ok:false,error:'Photo temporarily unavailable.'});}
}
