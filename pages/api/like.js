// pages/api/like.js
// v0.8.0 — No images, hotel-first articles w/ timeout, always 3 results.
// Runtime: Node.js (Next.js API Route)

import OpenAI from "openai";

export const config = { runtime: "nodejs", api: { bodyParser: true } };

// ---- CORS ----
function setCors(req, res) {
  const allowedOrigins = [
    "https://www.vorrasi.com",
    "https://vorrasi.com",
    "https://contrabass-dog-6klj.squarespace.com",
    "https://contrabass-dog-6kj.squarespace.com",
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

// ---- news filtering (hotel first) ----
const NEGATIVE = ["murder","homicide","shooting","stabbing","assault","kidnapping","rape","bomb","terror","massacre","deadly","death","fatal","police","arrest"];
function hasNeg(s=""){ const t=(s||"").toLowerCase(); return NEGATIVE.some(k=>t.includes(k)); }
function scoreArticle(title="", url=""){
  const t = (title||"").toLowerCase();
  const h = domainOf(url).toLowerCase();
  let score = 0;
  if (/\b(hotel|hotels|where to stay|stay|airbnb|bnb|guesthouse|accommodation)\b/i.test(t)) score += 6;
  if (/forbestravelguide|cntraveler|travelandleisure|timeout|lonelyplanet|afar/.test(h)) score += 3;
  if (/booking|hotels\.com|marriott|hyatt|ihg|accor|airbnb|vrbo/.test(h)) score += 2;
  if (/\b(best restaurants|where to eat|food guide|dining)\b/i.test(t)) score += 1;
  return score;
}
async function fetchWithTimeout(url, { timeoutMs = 6000 } = {}) {
  const ctrl = new AbortController(); const t = setTimeout(()=>ctrl.abort(), timeoutMs);
  try { const r = await fetch(url, { signal: ctrl.signal }); return r; } finally { clearTimeout(t); }
}
async function fetchTravelNews(q) {
  const run = async (query) => {
    const url = "https://news.google.com/rss/search?hl=en-US&gl=US&ceid=US:en&q=" + encodeURIComponent(query);
    const r = await fetchWithTimeout(url);
    const xml = await r.text();
    const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].map(m => m[1]).slice(0, 12);
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
    good.sort((a,b)=>b.score-a.score);
    return good[0] || null;
  };
  try {
    const hotelFirst = await run(q + ' (hotel OR "where to stay" OR stay OR airbnb OR accommodation)');
    if (hotelFirst) return hotelFirst;
    const foodTravel = await run(q + ' (restaurant OR "best restaurants" OR dining OR food OR travel OR tourism OR visit OR guide)');
    return foodTravel;
  } catch { return null; }
}

// ---- OpenAI ----
async function ask(place, region, excludeList = []) {
  const excl = excludeList.length ? `\nAlready chosen: ${excludeList.join(" | ")}. Do NOT repeat these.` : "";
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

Inputs: source="${place}", scope="${region}" (prefer neighborhoods, similar scale, accurate).${excl}
Return EXACTLY 3 candidates if possible.`;
  const resp = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.55,
    max_tokens: 650,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: "Return strictly valid JSON for a neighborhood-matching API. Keep content concise." },
      { role: "user", content: prompt },
    ],
  });
  try { return JSON.parse((resp.choices?.[0]?.message?.content || "{}").trim()); } catch { return {}; }
}

function normalize(parsed, place, region) {
  const base = Array.isArray(parsed?.results) ? parsed.results.slice(0,3) : [];
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
      version: "0.8.0",
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

    // First pass
    let parsed = await ask(place, region);
    let list = normalize(parsed, place, region);

    // Top-up once if fewer than 3
    if (list.length < 3) {
      const taken = list.map(x => `${x.match}, ${x.city}`.trim());
      const parsed2 = await ask(place, region, taken);
      const list2 = normalize(parsed2, place, region);
      const seen = new Set(taken.map(s=>s.toLowerCase()));
      for (const r of list2) {
        const key = `${r.match}, ${r.city}`.trim().toLowerCase();
        if (!seen.has(key)) list.push(r);
        if (list.length >= 3) break;
      }
      list = list.slice(0,3);
    }

    // Attach hotel-first news with timeout, in parallel
    const final = await Promise.all(list.map(async (item) => {
      const nq = `${item.match} ${item.city} ${item.region}`;
      const news = await fetchTravelNews(nq);
      return { ...item, news: news || null };
    }));

    return res.status(200).json({ ok: true, place, region, results: final, version: "0.8.0" });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: "Server error", detail: String(err?.message || err) });
  }
}
