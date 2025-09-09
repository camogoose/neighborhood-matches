// pages/api/like.js
// v0.5.0 — Faster-first results (news lazy-loaded), results-only (no source profile),
//           per-result landmarks (3), travel-only article with negative-word filter,
//           updated CORS allowlist.
// Runtime: Node.js (not Edge)

import OpenAI from "openai";

export const config = { runtime: "nodejs", api: { bodyParser: true } };

// ---- CORS: allow your preview + live Squarespace domains (edit as needed) ----
function setCors(req, res) {
  const allowedOrigins = [
    // Your personal site (optional — keep if you still embed there)
    "https://www.vorrasi.com",
    "https://vorrasi.com",

    // Squarespace preview domain for THIS project (keep while testing)
    "https://contrabass-dog-6klj.squarespace.com",

    // Your live custom domain (both www + bare)
    "https://thisplaceisjustlikethatplace.com",
    "https://www.thisplaceisjustlikethatplace.com",

    // Squarespace editor login domain (sometimes used during previews)
    "https://mike-vorrasi.squarespace.com"
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

// ---- tiny helpers (no deps) ----
function pick(s, re) { const m = re.exec(s); return m ? m[1].trim() : ""; }
function clean(str) {
  return String(str || "")
    .replace(/<!\[CDATA\[(.*?)\]\]>/gs, "$1")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

// ---- travel/news filtering (domains + negative terms) ----
const NEGATIVE_KEYWORDS = [
  "murder","homicide","shooting","stabbing","assault","kidnapping",
  "rape","bomb","terror","massacre","deadly","death","fatal","police","arrest"
];
function domainOf(u=""){ try { return new URL(u).host.replace(/^www\./,""); } catch { return ""; } }
function isTravelDomain(u=""){
  const h = domainOf(u);
  if (!h) return false;
  return /lonelyplanet|cntraveler|afar|atlasobscura|timeout|thrillist|travelandleisure|nationalgeographic|guardian|nytimes|bbc|washingtonpost|eater|curbed|visit|tourism|city|municipality|gov/i.test(h);
}
function hasNegative(text=""){
  const t = text.toLowerCase();
  return NEGATIVE_KEYWORDS.some(k => t.includes(k));
}

// ---- fetch travel news RSS (best-effort, filtered) ----
async function fetchTravelNews(q) {
  const url = "https://news.google.com/rss/search?hl=en-US&gl=US&ceid=US:en&q="
    + encodeURIComponent(q + " (travel OR tourism OR visit OR guide)");
  try {
    const r = await fetch(url);
    const xml = await r.text();
    const item = pick(xml, /<item>([\s\S]*?)<\/item>/i);
    if (!item) return null;
    const title = clean(pick(item, /<title>([\s\S]*?)<\/title>/i));
    const link  = clean(pick(item, /<link>([\s\S]*?)<\/link>/i));
    const desc  = clean(pick(item, /<description>([\s\S]*?)<\/description>/i));
    const img   = pick(item, /<media:content[^>]*url="([^"]+)"/i)
               || pick(item, /<enclosure[^>]*url="([^"]+)"/i) || "";

    if (!isTravelDomain(link)) return null;          // travel-ish publishers only
    if (hasNegative(title + " " + desc)) return null; // exclude negative terms

    return {
      title: title || "",
      url: link || "",
      image: img || "",
      snippet: (desc || "").replace(/<[^>]+>/g, "").slice(0, 180) + ((desc && desc.length > 180) ? "…" : "")
    };
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  setCors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method === "GET") {
    return res.status(200).json({
      ok: true,
      service: "This Is Just Like That",
      version: "0.5.0",
      sections: ["resultsOnly"],
      news_filter: "travel-only (negatives excluded)",
      mode: process.env.OPENAI_API_KEY ? "openai" : "missing_api_key",
    });
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "GET,POST,OPTIONS");
    return res.status(405).json({ ok: false, error: `Method ${req.method} Not Allowed` });
  }

  try {
    const { place, region, includeNews, newsOnly, items } = req.body || {};

    // Fast news-only path: fetch news for items already rendered on the client
    if (newsOnly) {
      const list = Array.isArray(items) ? items.slice(0, 3) : [];
      const news = await Promise.all(list.map(async (i) => {
        const q = [i.match, i.city, i.region].filter(Boolean).join(" ");
        return await fetchTravelNews(q);
      }));
      return res.status(200).json({ ok: true, news });
    }

    if (!place || !region) {
      return res.status(400).json({ ok: false, error: 'Missing JSON: { "place": "...", "region": "..." }' });
    }
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ ok: false, error: "OPENAI_API_KEY is not set" });
    }

    // Slim prompt → faster model response, results only
    const prompt = `
You are a neighborhood-matching engine.

INPUTS:
- source place: "${place}"
- find 3 best matches within: "${region}"

OUTPUT: strictly valid JSON with exactly 3 items in "results".
Each result MUST include:
  - "rank": 1..3
  - "match": neighborhood or district name (destination)
  - "city": city name
  - "region": state/region/country
  - "blurb": 1–2 concise sentences on why it matches
  - "whatMakesItSpecial": 3–5 short bullets
  - "landmarks": exactly 3 items: [{ "name": "...", "why": "1 short sentence" }]
  - "tags": 3–6 short tags
  - "score": 0.0–1.0

Return ONLY:
{ "results": [ ... ] }`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.6,
      max_tokens: 650, // keep bounded for speed
      messages: [
        { role: "system", content: "Return strictly valid JSON for a neighborhood-matching API." },
        { role: "user", content: prompt },
      ],
    });

    let text = completion.choices?.[0]?.message?.content || "{}";
    text = text.trim().replace(/^```json\s*/i, "").replace(/```$/i, "");
    let parsed; try { parsed = JSON.parse(text); } catch { parsed = {}; }

    // Normalize matches
    const base = Array.isArray(parsed?.results) ? parsed.results.slice(0, 3) : [];
    const normalized = base.map((r, i) => ({
      rank: typeof r.rank === "number" ? r.rank : i + 1,
      match: r.match || r.neighborhood || "Unknown",
      city: r.city || "",
      region: r.region || String(region),
      blurb: r.blurb || `Feels similar to ${place}.`,
      whatMakesItSpecial: Array.isArray(r?.whatMakesItSpecial) ? r.whatMakesItSpecial.slice(0, 5) : [],
      landmarks: Array.isArray(r?.landmarks) ? r.landmarks.slice(0, 3).map(l => ({
        name: String(l?.name || "").slice(0, 80),
        why: String(l?.why || "").slice(0, 160)
      })) : [],
      tags: Array.isArray(r.tags) ? r.tags.slice(0, 6) : [],
      score: typeof r.score === "number" ? r.score : 0.75,
      source: "openai",
    }));

    // Optionally include news here (slower) — default is FAST (no news)
    if (includeNews) {
      const withNews = await Promise.all(normalized.map(async (item) => {
        const nq = `${item.match} ${item.city} ${item.region}`;
        const news = await fetchTravelNews(nq);
        return { ...item, news: news || null };
      }));
      return res.status(200).json({ ok: true, place, region, results: withNews, version: "0.5.0" });
    }

    // FAST path: return matches only
    return res.status(200).json({ ok: true, place, region, results: normalized, version: "0.5.0" });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false,
