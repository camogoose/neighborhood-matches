<!-- This Is Just Like That — results-only embed (with travel articles) -->
<div id="like-that-ish" style="max-width:960px;margin:0 auto;font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;line-height:1.5;">

  <h2 style="font-size:1.8rem;font-weight:700;margin-bottom:8px;">Find your favorite neighborhood, anywhere.</h2>
  <p id="subHeadline" style="font-size:1rem;color:#555;margin-bottom:20px;">
    Type in the place you love — like <em>East Village, NYC</em> — and discover neighborhoods just like it in the city or region you’re curious about.
  </p>

  <!-- Form -->
  <div style="display:grid;grid-template-columns:1fr;gap:12px;margin:16px 0;">
    <label style="font-size:.85rem;color:#555;">
      This place
      <input id="sourcePlace" type="text" placeholder="a neighborhood, city, or town" style="width:100%;padding:10px 12px;border:1px solid #ddd;border-radius:10px;"/>
    </label>

    <label style="font-size:.85rem;color:#555;">
      Is just like that place in
      <input id="regionInput" type="text" placeholder="your destination" style="width:100%;padding:10px 12px;border:1px solid #ddd;border-radius:10px;"/>
    </label>

    <div style="display:flex;align-items:center;gap:12px;">
      <button id="findBtn" style="background:#000;color:#fff;border:none;border-radius:10px;padding:10px 14px;font-weight:600;cursor:pointer;">Let's go</button>
    </div>
  </div>

  <!-- Status -->
  <div id="status" style="min-height:24px;font-size:.9rem;color:#b00020;margin:6px 0 10px;"></div>

  <!-- (Profile markup kept for future use, but hidden by your CSS) -->
  <div id="profile" style="display:none;border:1px solid #eee;border-radius:12px;padding:16px;background:#fff;margin:8px 0 18px;box-shadow:0 2px 6px rgba(0,0,0,0.08);">
    <div id="profileTitle" style="font-weight:700;margin-bottom:6px;"></div>
    <div id="profileSummary" style="color:#555;margin-bottom:10px;"></div>
    <div id="profileMeta" style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:12px;"></div>
    <div id="profileTraits" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;"></div>
    <div id="profileLandmarksWrap" style="margin-top:12px;display:none;">
      <div style="font-weight:600;margin-bottom:6px;">Landmarks to explore</div>
      <ul id="profileLandmarks" style="padding-left:18px;margin:0;"></ul>
    </div>
  </div>

  <!-- Matches -->
  <div id="results" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:14px;margin-bottom:0;"></div>
</div>

<script>
(function(){
  // Rotate a random example
  const examples = ["East Village, NYC","SoHo, NYC","Shoreditch, London","Le Marais, Paris","Silver Lake, Los Angeles","Kreuzberg, Berlin","Södermalm, Stockholm"];
  const subHeadline = document.getElementById("subHeadline");
  subHeadline.innerHTML = `Type in the place you love — like <em>${examples[Math.floor(Math.random()*examples.length)]}</em> — and discover neighborhoods just like it in the city or region you’re curious about.`;

  // Your API
  const API_URL = "https://neighborhood-matches.vercel.app/api/like";

  const $ = (id) => document.getElementById(id);
  const placeEl = $("sourcePlace"), regionEl = $("regionInput"), btn = $("findBtn");
  const statusEl = $("status"), profile = $("profile"), resultsEl = $("results");

  function esc(s){return String(s||"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));}
  function setStatus(m,e=false){statusEl.style.color=e?"#b00020":"#555";statusEl.textContent=m||"";}
  function setLoading(v){btn.disabled=v;btn.textContent=v?"Finding…":"Let's go";}

  // Small input normalizer for common shorthands (helps model quality)
  function normalizeInput(s){
    const m = {
      "nyc":"New York City","new york":"New York City","new york city":"New York City",
      "la":"Los Angeles","l.a.":"Los Angeles",
      "sf":"San Francisco","s.f.":"San Francisco",
      "dc":"Washington, DC","d.c.":"Washington, DC"
    };
    const key = String(s||"").trim().toLowerCase();
    return m[key] || s;
  }

  // Chips + news
  function chip(text){return `<span class="chip" style="display:inline-block;border:1px solid #e5e5e5;border-radius:999px;padding:4px 8px;font-size:.75rem;">${esc(text)}</span>`;}
  function newsBlock(news){
    if(!news||(!news.title&&!news.url))return"";
    const img=news.image?`<img src="${esc(news.image)}" alt="" style="width:64px;height:64px;object-fit:cover;border-radius:8px;flex:0 0 64px;">`:"";
    const title=news.title?esc(news.title):"Related article";
    const url=news.url?esc(news.url):"#";
    const snippet=news.snippet?`<div style="font-size:.8rem;color:#666;margin-top:2px;">${esc(news.snippet)}</div>`:"";
    return `<div style="display:flex;gap:10px;align-items:flex-start;background:#fafafa;border:1px solid #eee;border-radius:10px;padding:8px 10px;margin-top:10px;">
      ${img}<div style="min-width:0;flex:1;"><a href="${url}" target="_blank" rel="noopener" style="text-decoration:none;font-weight:600;">${title}</a>${snippet}</div>
    </div>`;
  }

  // Build "Neighborhood, City" without duplicates like "Berlin, Berlin"
  function formatTitle(item){
    const rawMatch = String(item.match || "");
    const city = String(item.city || "");
    const parts = rawMatch.split(",").concat(city).map(s => s.trim()).filter(Boolean);
    const seen = new Set(), dedup = [];
    for (const p of parts){ const k = p.toLowerCase(); if(!seen.has(k)){ seen.add(k); dedup.push(p); } }
    return dedup.slice(0,2).join(", ");
  }

  // Card
  function matchCard(item){
    const title = formatTitle(item);
    const blurb = esc(item.blurb||"");
    const tags  = (Array.isArray(item.tags)?item.tags:[]).slice(0,6).map(chip).join(" ");
    const news  = newsBlock(item.news);

    const specials = Array.isArray(item.whatMakesItSpecial)&&item.whatMakesItSpecial.length
      ? `<div style="margin:10px 0 2px;font-weight:700;">What makes it special</div>
         <ul style="padding-left:18px;margin:6px 0 0;">
           ${item.whatMakesItSpecial.slice(0,5).map(s=>`<li style="color:#444;">${esc(s)}</li>`).join("")}
         </ul>`
      : "";

    const landmarks = Array.isArray(item.landmarks)&&item.landmarks.length
      ? `<div style="margin:12px 0 2px;font-weight:700;">Landmarks</div>
         <ul style="padding-left:18px;margin:6px 0 0;">
           ${item.landmarks.slice(0,3).map(l=>`<li><strong>${esc(l.name||"")}</strong> — ${esc(l.why||"")}</li>`).join("")}
         </ul>`
      : "";

    return `<article style="border:1px solid #eee;border-radius:12px;padding:14px 16px;background:#fff;margin:4px 0;display:flex;flex-direction:column;height:100%;box-shadow:0 2px 6px rgba(0,0,0,0.08);">
      <h3 style="margin:0 0 6px;font-size:1.05rem;">${esc(title)}</h3>
      ${blurb ? `<p style="margin:0 0 8px;color:#555;">${blurb}</p>` : ``}
      ${specials}
      ${landmarks}
      <div style="margin-top:auto;">${tags}${news}</div>
    </article>`;
  }

  // Renderers
  function renderProfile(sp, place){ /* kept for future; hidden by CSS */ }
  function renderMatches(list){
    if(!Array.isArray(list) || !list.length){
      resultsEl.innerHTML = `<div style="color:#666;">No matches found.</div>`; return;
    }
    resultsEl.innerHTML = list.map(x => matchCard(x)).join("");
  }

  // CALL API — articles ON
  async function callAPI(place, region){
    const r = await fetch(API_URL, {
      method:"POST",
      headers:{ "Content-Type":"application/json" },
      body: JSON.stringify({ place, region, includeNews: true }) // ← articles enabled
    });
    const j = await r.json();
    if(!r.ok || !j.ok) throw new Error(j.error || "Request failed");
    return j;
  }

  // Click handler
  btn.addEventListener("click", async () => {
    const place  = normalizeInput((placeEl.value||"").trim());
    const region = normalizeInput((regionEl.value||"").trim());
    if(!place || !region){ setStatus("Please fill both fields.", true); return; }
    setStatus(""); setLoading(true); resultsEl.innerHTML = ""; profile.style.display="none";
    try {
      const data = await callAPI(place, region);
      renderMatches(data.results);
      if(!data.results?.length) setStatus("No results available.", true);
    } catch(e){ console.error(e); setStatus(e.message || "Something went wrong.", true); }
    finally { setLoading(false); }
  });
})();
</script>
