// pages/api/like.js
// v0.7.0 — Panel-ready results, strong Wikipedia image fallback, hotel-first articles.
// Runtime: Node.js (Next.js API Route)

import OpenAI from "openai";

export const config = { runtime: "nodejs", api: { bodyParser: true } };

// ---- CORS ----
function setCors(req, res) {
  const allowedOrigins = [
    "https://www.vorrasi.com",
    "https://vorrasi.com",
    "https://contrabass-dog-6klj.squarespace.com", // your preview
    "https://contrabass-dog-6kj.squarespace.com",  // (older preview kept)
    "https://thisplaceisjustlikethatplace.com",
    "https://www.thisplaceisjustlikethatplace.com",
    "https://mike-vorrasi.squarespace.com",
  ];
  const origin = req.headers.origin;
  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ---- helpers ----
function pick(s, re) { const m = re.exec(s); return m ? m[1].trim() : ""; }
function clean(str) {
  return String(str || "")
    .replace(/<!\[CDATA\[(.*?)\]\]>/gs, "$1")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}
function domainOf(u=""){ try { return new URL(u).host.replace(/^www\./,""); } catch { return ""; } }

// ---- Wikipedia image lookup (multi-pass, HTTPS, 640px thumbs) ----
async function fetchPlaceImageFromTitle(title){
  // pass A: pageimages for explicit title
  try {
    const u = "https://en.wikipedia.org/w/api.php?origin=*&format=json&action=query&prop=pageimages&piprop=thumbnail&pithumbsize=640&titles=" + encodeURIComponent(title);
    const r = await fetch(u); const j = await r.json();
    const pages = j?.query?.pages || {};
    for (const k in pages) {
      const t = pages[k]?.thumbnail?.source;
      if (t) return { url: t, attribution: "https://en.wikipedia.org/wiki/" + encodeURIComponent(title) };
    }
  } catch {}
  // pass B: REST summary may still have a thumb/original
  try {
    const r = await fetch("https://en.wikipedia.org/api/rest_v1/page/summary/" + encodeURIComponent(title));
    const j = await r.json();
    const url = j?.thumbnail?.source || j?.originalimage?.source;
    if (url) return { url, attribution: j?.content_urls?.desktop?.page || ("https://en.wikipedia.org/wiki/" + encodeURIComponent(title)) };
  } catch {}
  return null;
}

async function fetchPlaceImage(query){
  try {
    // 1) Find best title via opensearch
    const s = await fetch("https://en.wikipedia.org/w/api.php?origin=*&format=json&action=opensearch&limit=1&namespace=0&search=" + encodeURIComponent(query));
    const arr = await s.json();
    const title1 = arr?.[1]?.[0];
    if (title1) {
      const a = await fetchPlaceImageFromTitle(title1);
      if (a) return a;
    }
    // 2) Generator search (top few hits), first with images wins
    const g = await fetch("https://en.wikipedia.org/w/api.php?origin=*&format=json&action=query&generator=search&gsrsearch=" + encodeURIComponent(query) + "&gsrlimit=5&prop=pageimages&piprop=thumbnail&pithumbsize=640");
    const j2 = await g.json();
    const pages = j2?.query?.pages || {};
    const sorted = Object.values(pages).sort((a,b)=>(b.index||0)-(a.index||0));
    for (const p of sorted) {
      const t = p?.thumbnail?.source;
      if (t) return { url: t, attribution: "https://en.wikipedia.org/wiki/" + encodeURIComponent(p.title) };
    }
  } catch {}
  return null;
}

// ---- news filtering (hotel first) ----
const NEGATIVE = ["murder","homicide","shooting","stabbing","assault","kidnapping","rape","bomb","terror","massacre","deadly","death","fatal","police","arrest"];
function hasNeg(s=""){ const t=(s||"").toLowerCase(); return NEGATIVE.some(k=>t.includes(k)); }

function scoreArticle(title="", url=""){
  const t = (title||"").toLowerCase();
  const h = domainOf(url).toLowerCase();

  // Very strong hotel intent
  let score = 0;
  if (/\b(hotel|hotels|where to stay|stay|airbnb|bnb|guesthouse|accommodation)\b/i.test(t)) score += 6;

  // Domain boosts (stay > travel > food)
  if (/forbestravelguide|cntraveler|travelandleisure|timeout|lonelyplanet|afar/.test(h)) score += 3;
  if (/booking|hotels\.com|marriott|hyatt|ihg|accor|airbnb|vrbo/.test(h)) score += 2;        // OK if it has editorial roundups
  if (/eater|theinfatuation|michelinguide|bonappetit|thrillist|atlasobscura/.test(h)) score += 1;

  // Food-only phrases lower than hotel if both exist
  if (/\b(best restaurants|where to eat|food guide|dining)\b/i.test(t)) score += 1;

  return score;
}

async function fetchTravelNews(q) {
  const run = async (query) => {
    const url = "https://news.google.com/rss/search?hl=en-US&gl=US&ceid=US:en&q=" + encodeURIComponent(query);
    const r = await fetch(url); const xml = await r.text();
    const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].map(m => m[1]).slice(0, 14);
    const good = [];
    for (const it of items) {
      const title = clean(pick(it, /<title>([\s\S]*?)<\/title>/i));
      const link  = clean(pick(it, /<link>([\s\S]*?)<\/link>/i));
      const desc  = clean(pick(it, /<description>([\s\S]*?)<\/description>/i));
      const img   = pick(it, /<media:content[^>]*url="([^"]+)"/i) || pick(it, /<enclosure[^>]*url="([^"]+)"/i) || "";
      if (!link) continue;
      if (hasNeg(`${title} ${desc}`)) continue;
      good.push({
        title, url: link, image: img,
        snippet: (desc || "").replace(/<[^>]+>/g, "").slice(0, 180) + ((desc && desc.length > 180) ? "…" : ""),
        score: scoreArticle(title, link)
      });
    }
    // Pick best by score, fallback to first safe
    good.sort((a,b)=>b.score-a.score);
    return good[0] || null;
  };

  try {
    // Pass 1: hotel / where-to-stay preference
    const hotelFirst = await run(q + ' (hotel OR "where to stay" OR stay OR airbnb OR accommodation)');
    if (hotelFirst) return hotelFirst;

    // Pass 2: food + travel
    const foodTravel = await run(q + ' (restaurant OR "best restaurants" OR dining OR food OR travel OR tourism OR visit OR guide)');
    return foodTravel;
  } catch { return null; }
}

// ---- OpenAI helpers ----
async function getMatchesJSON(place, region) {
  const prompt = `
Return ONLY strict JSON:

{
  "results": [
    {
      "rank": 1,
      "match": "Neighborhood",
      "city": "City",
      "region": "Region/State/Country",
      "blurb": "1–2 sentences why it matches \\"${place}\\"",
      "whatMakesItSpecial": ["3 to 5 short bullets"],
      "landmarks": [
        { "name": "spot", "why": "1 short sentence" },
        { "name": "spot", "why": "1 short sentence" },
        { "name": "spot", "why": "1 short sentence" }
      ],
      "tags": ["3–6 tags"],
      "score": 0.0
    }
  ]
}

Inputs: source="${place}", scope="${region}" (prefer neighborhoods, accurate scale).`;
  const resp = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.6,
    max_tokens: 700,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: "Return strictly valid JSON for a neighborhood-matching API." },
      { role: "user", content: prompt },
    ],
  });
  const text = (resp.choices?.[0]?.message?.content || "{}").trim();
  try { return JSON.parse(text); } catch { return {}; }
}

function normalizeResults(parsed, place, region) {
  const base = Array.isArray(parsed?.results) ? parsed.results.slice(0, 3) : [];
  return base.map((r, i) => ({
    rank: typeof r.rank === "number" ? r.rank : i + 1,
    match: r.match || r.neighborhood || "Unknown",
    city: r.city || "",
    region: r.region || String(region),
    blurb: r.blurb || "",
    whatMakesItSpecial: Array.isArray(r?.whatMakesItSpecial) ? r.whatMakesItSpecial.slice(0,5) : [],
    landmarks: Array.isArray(r?.landmarks) ? r.landmarks.slice(0,3).map(l => ({
      name: String(l?.name || "").slice(0, 80),
      why: String(l?.why || "").slice(0, 160),
    })) : [],
    tags: Array.isArray(r.tags) ? r.tags.slice(0, 6) : [],
    score: typeof r.score === "number" ? r.score : 0.75,
    source: "openai",
  }));
}

export default async function handler(req, res) {
  setCors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method === "GET") {
    return res.status(200).json({
      ok: true,
      service: "This Is Just Like That",
      version: "0.7.0",
      sections: ["resultsOnly"],
      news_filter: "hotel-first; then food/tourism (negatives excluded)",
      mode: process.env.OPENAI_API_KEY ? "openai" : "missing_api_key"
    });
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "GET,POST,OPTIONS");
    return res.status(405).json({ ok: false, error: `Method ${req.method} Not Allowed` });
  }

  try {
    const { place, region } = req.body || {};
    if (!place || !region) return res.status(400).json({ ok: false, error: 'Missing JSON: { "place": "...", "region": "..." }' });
    if (!process.env.OPENAI_API_KEY) return res.status(500).json({ ok: false, error: "OPENAI_API_KEY is not set" });

    const parsed = await getMatchesJSON(place, region);
    const base = normalizeResults(parsed, place, region);

    // Attach image + hotel-first article for each card
    const withAssets = await Promise.all(base.map(async (item) => {
      const q1 = `${item.match} ${item.city} ${item.region}`;
      const q2 = `${item.city} ${item.region}`;
      const image = (await fetchPlaceImage(q1)) || (await fetchPlaceImage(q2)) || null;

      const news = await fetchTravelNews(q1);
      return { ...item, image, news: news || null };
    }));

    return res.status(200).json({ ok: true, place, region, results: withAssets, version: "0.7.0" });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: "Server error", detail: String(err?.message || err) });
  }
}
