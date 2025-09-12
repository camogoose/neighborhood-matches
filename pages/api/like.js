<!-- This Is Just Like That — single-card layout: description + map + mustard article tile -->
<div id="like-that-ish" style="max-width:980px;margin:0 auto;font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;line-height:1.5;">

  <h2 style="font-size:1.9rem;font-weight:800;margin:0 0 10px;color:#111;">Find your favorite neighborhood, anywhere.</h2>
  <p id="subHeadline" style="font-size:.95rem;color:#444;margin:0 0 16px;">
    Type in a city or neighborhood you love — like <em>SoHo, NYC</em> — and discover places just like it in the region you’re curious about.
  </p>

  <!-- Form -->
  <div style="display:grid;grid-template-columns:1fr;gap:10px;margin:14px 0;">
    <label style="font-size:.82rem;color:#333;">This place
      <input id="sourcePlace" type="text" placeholder="a neighborhood, city, or town"
             style="width:100%;padding:12px 14px;border:1px solid #dde5ea;border-radius:10px;box-shadow:0 1px 0 rgba(55,100,110,.35);outline:none;"/>
    </label>
    <label style="font-size:.82rem;color:#333;">Is just like that place in
      <input id="regionInput" type="text" placeholder="your destination"
             style="width:100%;padding:12px 14px;border:1px solid #dde5ea;border-radius:10px;box-shadow:0 1px 0 rgba(55,100,110,.35);outline:none;"/>
    </label>
    <div>
      <button id="findBtn"
        style="background:#3f6c75;color:#fff;border:none;border-radius:10px;padding:10px 16px;font-weight:700;cursor:pointer;box-shadow:0 1px 0 rgba(55,100,110,.35);">
        Let's go
      </button>
    </div>
  </div>

  <!-- Status -->
  <div id="status" style="min-height:22px;font-size:.9rem;color:#b00020;margin:4px 0 10px;"></div>

  <!-- Results -->
  <div id="results" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:18px;margin:10px 0;"></div>
</div>

<script>
(function(){
  const examples = ["SoHo, NYC","Shoreditch, London","Le Marais, Paris","Kreuzberg, Berlin","Södermalm, Stockholm"];
  const subHeadline = document.getElementById("subHeadline");
  subHeadline.innerHTML = `Type in a city or neighborhood you love — like <em>${examples[Math.floor(Math.random()*examples.length)]}</em> — and discover places just like it in the region you’re curious about.`;

  const API_URL = "https://neighborhood-matches.vercel.app/api/like";

  const $ = (id) => document.getElementById(id);
  const placeEl = $("sourcePlace"), regionEl = $("regionInput"), btn = $("findBtn");
  const statusEl = $("status"), resultsEl = $("results");

  function esc(s){return String(s||"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));}
  function setStatus(m,e=false){statusEl.style.color=e?"#b00020":"#555";statusEl.textContent=m||"";}
  function setLoading(v){btn.disabled=v;btn.textContent=v?"Finding…":"Let's go";}

  // Input focus style
  [placeEl, regionEl].forEach(inp=>{
    inp.addEventListener("focus", ()=>{ inp.style.boxShadow="0 0 0 3px rgba(63,108,117,.15)"; });
    inp.addEventListener("blur",  ()=>{ inp.style.boxShadow="0 1px 0 rgba(55,100,110,.35)"; });
  });

  function chip(text){
    return `<span style="display:inline-block;background:#fff;border:1px solid rgba(55,100,110,.15);border-radius:999px;padding:4px 8px;font-size:.74rem;color:#344;">${esc(text)}</span>`;
  }

  function formatTitle(item){
    const parts = [];
    const m = (item.match||"").trim();
    let c = (item.city||"").trim();
    let r = (item.region||"").trim();
    if (c && r && c.toLowerCase() === r.toLowerCase()) r = "";
    if (m) parts.push(m);
    if (c && (!m || !m.toLowerCase().includes(c.toLowerCase()))) parts.push(c);
    if (r) parts.push(r);
    return parts.join(", ");
  }

  function mapSection(item){
    const q = [item.match,item.city,item.region].filter(Boolean).join(", ");
    if(!q) return "";
    const iframe = `https://www.google.com/maps?q=${encodeURIComponent(q)}&output=embed`;
    const link   = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
    return `<div style="margin-top:10px;">
      <div style="font-weight:700;color:#111;margin:0 0 6px;">Map</div>
      <div style="overflow:hidden;border-radius:10px;">
        <iframe src="${iframe}" width="100%" height="120" style="border:0;" loading="lazy" referrerpolicy="no-referrer-when-downgrade"></iframe>
      </div>
      <a href="${link}" target="_blank" rel="noopener" style="display:inline-block;margin-top:6px;color:#1a1a1a;text-decoration:underline;font-size:.9rem;">Open in Google Maps</a>
    </div>`;
  }

  // PALE MUSTARD ARTICLE TILE
  function articleSection(news){
    if(!news||(!news.title&&!news.url))return "";
    const title = esc(news.title||"Where to stay");
    const url = esc(news.url||"#");
    const snippet = news.snippet
      ? `<div style="font-size:.9rem;color:#333;margin-top:4px;line-height:1.35;">${esc(news.snippet)}</div>`
      : "";
    return `<div style="background:#F7E6A6;border:1px solid rgba(55,100,110,.18);border-radius:12px;padding:10px 12px;margin-top:10px;">
      <a href="${url}" target="_blank" rel="noopener" style="text-decoration:none;color:#1a1a1a;">
        <div style="font-weight:800;line-height:1.25;">${title}</div>${snippet}
      </a>
    </div>`;
  }

  function card(item){
    const title = esc(formatTitle(item));
    const blurb = esc(item.blurb||"");
    const bullets = (item.whatMakesItSpecial||[]).map(b=>`<li>${esc(b)}</li>`).join("");
    const lms = (item.landmarks||[]).map(l=>`<li><strong>${esc(l.name||"")}</strong> — ${esc(l.why||"")}</li>`).join("");
    const tags = (Array.isArray(item.tags)?item.tags:[]).slice(0,6).map(chip).join(" ");

    return `<article style="background:#ffefed;border:none;border-radius:14px;padding:14px;">
      <div style="font-size:1.15rem;font-weight:800;margin:0 0 6px;color:#1a1a1a;">${title}</div>
      <p style="margin:0 0 8px;color:#333;">${blurb}</p>

      <div style="font-weight:700;margin:8px 0 4px;color:#111;">What makes it special</div>
      <ul style="margin:0 0 6px 18px;padding:0;color:#333;">${bullets}</ul>

      ${lms ? `<div style="font-weight:700;margin:8px 0 4px;color:#111;">Landmarks</div>
      <ul style="margin:0 6px 8px 18px;padding:0;color:#333;">${lms}</ul>` : ""}

      <div style="display:flex;gap:6px;flex-wrap:wrap;margin:8px 0 6px;">${tags}</div>

      ${mapSection(item)}
      ${articleSection(item.news)}
    </article>`;
  }

  function skeleton(){
    return `<article style="background:#ffefed;border:none;border-radius:14px;padding:14px;">
      <div style="height:18px;background:rgba(0,0,0,.06);border-radius:6px;width:60%;margin-bottom:8px;"></div>
      <div style="height:12px;background:rgba(0,0,0,.05);border-radius:6px;width:90%;margin:6px 0;"></div>
      <div style="height:12px;background:rgba(0,0,0,.05);border-radius:6px;width:80%;"></div>
    </article>`;
  }

  async function callAPI(place, region){
    const r = await fetch(API_URL,{
      method:"POST", headers:{ "Content-Type":"application/json" },
      body: JSON.stringify({ place, region })
    });
    const j = await r.json(); if(!r.ok || !j.ok) throw new Error(j.error || "Request failed");
    return j;
  }

  function render(list){
    resultsEl.innerHTML = Array.isArray(list)&&list.length
      ? list.map(card).join("")
      : `<div style="color:#666;">No matches found.</div>`;
  }

  $("findBtn").addEventListener("click", async () => {
    const place = (placeEl.value||"").trim();
    const region = (regionEl.value||"").trim();
    if(!place || !region){ setStatus("Please fill both fields.", true); return; }
    setStatus(""); setLoading(true);
    resultsEl.innerHTML = skeleton()+skeleton()+skeleton();
    try {
      const data = await callAPI(place, region);
      render(data.results||[]);
      if(!data.results?.length) setStatus("No results available.", true);
    } catch(e){ console.error(e); setStatus(e.message||"Something went wrong.", true); }
    finally { setLoading(false); }
  });
})();
</script>
