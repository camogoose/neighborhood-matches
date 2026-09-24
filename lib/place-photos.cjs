// Free Wikimedia metadata only. No model, API key, storage writes or image proxy.
const WIKI = 'https://en.wikipedia.org/w/api.php';
const COMMONS = 'https://commons.wikimedia.org/w/api.php';
const USER_AGENT = 'ThisPlaceIsJustLikeThatPlace/1.0 (https://www.thisplaceisjustlikethatplace.com/)';
const normalize = value => String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const contains = (text, phrase) => (' '+normalize(text)+' ').includes(' '+normalize(phrase)+' ');
function input(value) {
  const out = {};
  for (const field of ['match','city','region']) {
    if (typeof value?.[field] !== 'string' || !value[field].trim() || value[field].length > 160 || /[\x00-\x1f<>|]/.test(value[field])) throw Object.assign(new Error('Invalid place.'),{status:400});
    out[field] = value[field].trim();
  }
  out.landmark = typeof value.landmark === 'string' && value.landmark.length <= 160 && !/[\x00-\x1f<>|]/.test(value.landmark) ? value.landmark.trim() : '';
  return out;
}
function plain(value) {
  return String(value || '').replace(/<[^>]*>/g,'').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&nbsp;/g,' ').replace(/&#(\d+);/g,(_,n)=>+n<0x110000?String.fromCodePoint(+n):'').replace(/\s+/g,' ').trim();
}
function safeURL(value, hosts) {
  try { const url = new URL(value); return url.protocol==='https:' && hosts.includes(url.hostname) && !url.username && !url.password ? url.href : ''; } catch { return ''; }
}
const nonPhoto = /\b(map|locator|location map|flag|coat of arms|seal|logo|diagram|portrait|headshot|signature|nude|naked)\b/i;
function candidate(page, target, place, kind) {
  if (!page?.coordinates?.length || page.pageprops?.disambiguation !== undefined) return false;
  const title = normalize(page.title), name = normalize(target);
  // A full place-name boundary, not an incidental mention in an unrelated article.
  if (!(title===name || title.startsWith(name+' '))) return false;
  const evidence = page.title+' '+(page.extract || '').slice(0,1100);
  const region = place.region.split(',')[0].trim();
  const regionEvidence = contains(evidence,region) || ({USA:'United States',UK:'United Kingdom'}[region] && contains(evidence,{USA:'United States',UK:'United Kingdom'}[region]));
  return Boolean(regionEvidence && (kind==='city' || contains(evidence,place.city)));
}
function photoFromInfo(page, file, kind, place, target) {
  const info = file?.imageinfo?.[0], meta = info?.extmetadata;
  if (!info || !meta || !['image/jpeg','image/png','image/webp'].includes(info.mime) || info.width<500 || info.height<280 || info.width/info.height>3.5 || info.height/info.width>2) return null;
  if (nonPhoto.test((file.title||'').replace(/[_-]/g,' ')) || /portraits of|maps of|logos of/i.test(plain(meta.Categories?.value))) return null;
  if (plain(meta.Restrictions?.value) || plain(meta.LicenseShortName?.value).match(/non.?commercial|no derivatives|fair use|GFDL only/i)) return null;
  const license = plain(meta.LicenseShortName?.value);
  let licenseUrl = safeURL(String(meta.LicenseUrl?.value||'').replace(/^http:/,'https:').replace(/\/deed\.[a-z-]+$/i,'/'),['creativecommons.org']);
  const allowed = /^https:\/\/creativecommons\.org\/(licenses\/(by|by-sa)\/(1\.0|2\.0|2\.5|3\.0|4\.0)(\/[a-z-]+)?\/?|publicdomain\/(zero\/1\.0|mark\/1\.0)\/?)$/;
  if (license==='Public domain' && !licenseUrl) licenseUrl='https://creativecommons.org/publicdomain/mark/1.0/';
  if (!allowed.test(licenseUrl)) return null;
  const author = plain(meta.Artist?.value);
  if (!author || author.length>1200) return null;
  const src = safeURL(info.thumburl,['upload.wikimedia.org','thumb.wikimedia.org']);
  const sourceUrl = safeURL(info.descriptionurl,['commons.wikimedia.org']);
  if (!src || !sourceUrl || !new URL(src).pathname.startsWith('/wikipedia/commons/')) return null;
  const description = plain(meta.ImageDescription?.value).slice(0,400);
  return {src,sourceUrl,author,license,licenseUrl,credit:plain(meta.Credit?.value).slice(0,1200),title:plain(meta.ObjectName?.value || file.title).slice(0,300),alt:description || page.title,kind,label:kind==='city'?'City view: '+place.city:kind==='landmark'?'Landmark: '+target:'Photo of '+place.match,articleUrl:'https://en.wikipedia.org/wiki/'+encodeURIComponent(page.title),cropped:true};
}
function createPhotoLookup({fetchImpl=fetch,now=Date.now,timeout=12000}={}) {
  const cache=new Map(),pending=new Map();
  let minute=0,requests=0;
  async function lookup(raw) {
    const place=input(raw),key=JSON.stringify(place),old=cache.get(key);
    if(old && old.expires>now()) return old.value;
    if(pending.has(key)) return pending.get(key);
    const window=Math.floor(now()/60000);
    if(window!==minute){minute=window;requests=0;}
    // Per-instance backstop; CDN caching is the main repeated-request protection.
    if(pending.size>=8 || requests++>=60) throw Object.assign(new Error('Photo lookup busy.'),{status:429});
    const work=(async()=>{
      const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeout);
      let count=0;
      async function api(host,params) {
        if(++count>8) throw Error('Lookup budget exceeded');
        const url=host+'?'+new URLSearchParams({action:'query',format:'json',formatversion:'2',...params});
        const response=await fetchImpl(url,{signal:controller.signal,headers:{'User-Agent':USER_AGENT},redirect:'error'});
        if(!response.ok) throw Error('Photo source unavailable');
        const data=await response.json();if(data.error)throw Error('Photo source unavailable');return data.query?.pages||[];
      }
      async function find(target,kind) {
        const phrase=s=>s.replace(/["\\]/g,' ');
        const query='"'+phrase(target)+'" '+phrase(place.city+' '+place.region.split(',')[0]);
        const pages=await api(WIKI,{generator:'search',gsrsearch:query,gsrlimit:'3',gsrnamespace:'0',prop:'pageimages|extracts|coordinates|pageprops|images',piprop:'name',pilicense:'free',exintro:'1',explaintext:'1',exchars:'1100',imlimit:'6'});
        const page=pages.sort((a,b)=>a.index-b.index).find(p=>candidate(p,target,place,kind));
        if(!page)return null;
        const files=[page.pageimage && 'File:'+page.pageimage,...(page.images||[]).map(i=>i.title)].filter(Boolean).filter(name=>/\.(jpe?g|png|webp)$/i.test(name) && !nonPhoto.test(name.replace(/[_-]/g,' ')));
        const names=[...new Set(files)].slice(0,3);if(!names.length)return null;
        const infos=await api(COMMONS,{titles:names.join('|'),prop:'imageinfo',iiprop:'url|size|mime|extmetadata',iiurlwidth:'960',iiextmetadatalanguage:'en'});
        // Page image first, then an article illustration; never arbitrary search images.
        for(const name of names){const file=infos.find(f=>normalize(f.title)===normalize(name));const photo=photoFromInfo(page,file,kind,place,target);if(photo)return photo;}
        return null;
      }
      try {
        let photo=await find(place.match,'place');
        if(!photo && place.landmark)photo=await find(place.landmark,'landmark');
        const value={ok:true,photo};
        if(cache.size>=500)cache.delete(cache.keys().next().value);
        cache.set(key,{value,expires:now()+(photo?86400000:900000)});return value;
      } finally {clearTimeout(timer);}
    })();
    pending.set(key,work);try{return await work;}finally{pending.delete(key);}
  }
  return {lookup};
}
module.exports={input,plain,candidate,photoFromInfo,createPhotoLookup};
