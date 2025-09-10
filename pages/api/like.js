// pages/api/like.js
// v0.5.4 — JSON mode + one retry; results-only; 3 landmarks; travel-only news w/ negative filter.
// Runtime: Node.js (Next.js API Route)

import OpenAI from "openai";

export const config = { runtime: "nodejs", api: { bodyParser: true } };

// ---- CORS: allow Squarespace preview + your domains ----
function setCors(req, res) {
  const allowedOrigins = [
    "https://www.vorrasi.com",
    "https://vorrasi.com",
    "https://contrabass-dog-6klj.squarespace.com", // your preview site
    "https://thisplaceisjustlikethatplace.com",
    "https://www.thisplaceisjustlikethatplace.com",
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

// ---- tiny helpers ----
function pick(s, re) { const m = re.exec(s); return m ? m[1].trim() : ""; }
function clean(str) {
  return String(str || "")
    .replace(/<!\[CDATA\[(.*?)\]\]>/gs, "$1")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

// ---- travel/news filtering ----
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

    if (!isTravelDomain(link)) return null;
    if (hasNegative((title||"") + " " + (desc||""))) return null;

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

// ---- OpenAI call helpers (JSON mode + retry) ----
async function getMatchesJSON(place, region, attempt=1) {
  const basePrompt = `
You are a neighborhood-matching engine.

INPUTS:
- source place: "${place}"
- find exactly 3 best matches within: "${region}" (treat this as a city, state, or country as appropriate)

RETURN *ONLY* strict JSON (no prose):

{
  "results": [
    {
      "rank": 1,
      "match": "Neighborhood",
      "city": "City",
      "region": "Region/State/Country",
      "blurb": "1–2 concise sentences on why it matches",
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
}`;

  const fallbackPrompt = `
Return ONLY strict JSON for 3 matches inside "${region}" that feel like "${place}".
Keep fields minimal and factual. Same schema as before.`;

  const prompt = attempt === 1 ? basePrompt : fallbackPrompt;

  const resp = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.6,
    max_tokens: 700,
    response_format: { type: "json_object" }, // force valid JSON
    messages: [
      { role: "system", content: "Return strictly valid JSON for a neighborhood-matching API. Never include extra text." },
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
    whatMakesItSpecial: Array.isArray(r?.whatMakesItSpecial) ? r.whatMakesItSpecial.slice(0, 5) : [],
    landmarks: Array.isArray(r?.landmarks) ? r.landmarks.slice(0, 3).map(l => ({
      name: String(l?.name || "").slice(0, 80),
      why: String(l?.why || "").slice(0, 160)
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
      version: "0.5.4",
      sections: ["resultsOnly"],
      news_filter: "travel-only (negatives excluded)",
      mode: process.env.OPENAI_API_KEY ? "openai" : "missing_api_key"
    });
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "GET,POST,OPTIONS");
    return res.status(405).json({ ok: false, error: `Method ${req.method} Not Allowed` });
  }

  try {
    const { place, region, includeNews, newsOnly, items } = req.body || {};

    // News-only (not used by the page right now, but handy)
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

    // Try once (JSON mode), then retry with simpler prompt if empty
    let parsed = await getMatchesJSON(place, region, 1);
    let normalized = normalizeResults(parsed, place, region);
    if (!normalized.length) {
      parsed = await getMatchesJSON(place, region, 2);
      normalized = normalizeResults(parsed, place, region);
    }

    // Optionally attach news (slower)
    if (includeNews && normalized.length) {
      const withNews = await Promise.all(normalized.map(async (item) => {
        const nq = `${item.match} ${item.city} ${item.region}`;
        const news = await fetchTravelNews(nq);
        return { ...item, news: news || null };
      }));
      return res.status(200).json({ ok: true, place, region, results: withNews, version: "0.5.4" });
    }

    return res.status(200).json({ ok: true, place, region, results: normalized, version: "0.5.4" });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: "Server error", detail: String(err?.message || err) });
  }
} // EOF v0.5.4
