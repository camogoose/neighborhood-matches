// pages/api/like.js
// v0.6.0 — images via Wikipedia; broader travel/food/hotel news; JSON mode + retry.
// Runtime: Node.js (Next.js API Route)

import OpenAI from "openai";

export const config = { runtime: "nodejs", api: { bodyParser: true } };

// ---- CORS: allow Squarespace preview + your domains ----
function setCors(req, res) {
  const allowedOrigins = [
    "https://www.vorrasi.com",
    "https://vorrasi.com",
    "https://contrabass-dog-6klj.squarespace.com", // preview
    "https://contrabass-dog-6kj.squarespace.com",  // (older preview just in case)
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
function domainOf(u=""){ try { return new URL(u).host.replace(/^www\./,""); } catch { return ""; } }

// ---- Wikipedia image lookup (best-effort) ----
async function fetchPlaceImage(q) {
  try {
    // Search title
    const s = await fetch(
      "https://en.wikipedia.org/w/api.php?action=opensearch&origin=*&format=json&limit=1&namespace=0&search=" + encodeURIComponent(q)
    );
    const arr = await s.json();
    const title = arr?.[1]?.[0];
    if (!title) return null;

    // Summary with thumbnail
    const r = await fetch("https://en.wikipedia.org/api/rest_v1/page/summary/" + encodeURIComponent(title));
    const j = await r.json();
    const url = j?.thumbnail?.source || j?.originalimage?.source;
    if (!url) return null;

    return {
      url,
      attribution: j?.content_urls?.desktop?.page || ("https://en.wikipedia.org/wiki/" + encodeURIComponent(title))
    };
  } catch { return null; }
}

// ---- travel/news filtering ----
const NEGATIVE_KEYWORDS = [
  "murder","homicide","shooting","stabbing","assault","kidnapping",
  "rape","bomb","terror","massacre","deadly","death","fatal","police","arrest"
];

function isPreferredDomain(u=""){
  const h = domainOf(u);
  if (!h) return false;
  // Travel + city tourism + food + hotels
  return /lonelyplanet|cntraveler|travelandleisure|afar|timeout|atlasobscura|frommers|fodors|roughguides|nationalgeographic|guardian|nytimes|bbc|washingtonpost|eater|theinfatuation|michelinguide|bonappetit|thrillist|cond[ée]nast|visit|tourism|city|municipality|gov|hotel|hotels|forbestravelguide/i.test(h);
}

function hasNegative(text=""){
  const t = text.toLowerCase();
  return NEGATIVE_KEYWORDS.some(k => t.includes(k));
}

// ---- improved travel/food/hotel news fetch ----
async function fetchTravelNews(q) {
  const make = async (query) => {
    const url = "https://news.google.com/rss/search?hl=en-US&gl=US&ceid=US:en&q=" + encodeURIComponent(query);
    const r = await fetch(url);
    const xml = await r.text();

    const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].map(m => m[1]).slice(0, 12);
    let fallback = null;

    for (const item of items) {
      const title = clean(pick(item, /<title>([\s\S]*?)<\/title>/i));
      const link  = clean(pick(item, /<link>([\s\S]*?)<\/link>/i));
      const desc  = clean(pick(item, /<description>([\s\S]*?)<\/description>/i));
      const img   = pick(item, /<media:content[^>]*url="([^"]+)"/i)
                 || pick(item, /<enclosure[^>]*url="([^"]+)"/i) || "";

      if (!link) continue;
      if (hasNegative((title||"") + " " + (desc||""))) continue;

      const news = {
        title: title || "",
        url: link,
        image: img || "",
        snippet: (desc || "").replace(/<[^>]+>/g, "").slice(0, 180) + ((desc && desc.length > 180) ? "…" : "")
      };

      if (isPreferredDomain(link)) return news;   // prefer travel/food/hotel domains
      if (!fallback) fallback = news;             // safe general fallback
    }
    return fallback;
  };

  try {
    // Pass 1: broad travel/food/hotel intent
    const primary = await make(q + " (travel OR tourism OR visit OR guide OR restaurant OR dining OR food OR cafe OR bar OR hotel OR hotels OR \"where to eat\" OR \"where to stay\" OR \"best restaurants\" OR \"hotel review\")");
    if (primary) return primary;

    // Pass 2: target popular sites directly
    const targeted = await make(q + " (site:timeout.com OR site:lonelyplanet.com OR site:cntraveler.com OR site:travelandleisure.com OR site:afar.com OR site:eater.com OR site:theinfatuation.com OR site:michelinguide.com)");
    return targeted || null;
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

  const fallbackPrompt = `Return ONLY strict JSON for 3 matches inside "${region}" that feel like "${place}". Keep fields minimal and factual. Same schema as before.`;

  const prompt = attempt === 1 ? basePrompt : fallbackPrompt;

  const resp = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.6,
    max_tokens: 700,
    response_format: { type: "json_object" },
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
      version: "0.6.0",
      sections: ["resultsOnly"],
      news_filter: "travel/food/hotel (negatives excluded)",
      mode: process.env.OPENAI_API_KEY ? "openai" : "missing_api_key"
    });
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "GET,POST,OPTIONS");
    return res.status(405).json({ ok: false, error: `Method ${req.method} Not Allowed` });
  }

  try {
    const { place, region, includeNews, items, newsOnly } = req.body || {};

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

    // Get matches (JSON mode + retry)
    let parsed = await getMatchesJSON(place, region, 1);
    let normalized = normalizeResults(parsed, place, region);
    if (!normalized.length) {
      parsed = await getMatchesJSON(place, region, 2);
      normalized = normalizeResults(parsed, place, region);
    }

    // Attach images (best-effort, in parallel)
    const withImages = await Promise.all(normalized.map(async (item) => {
      const q1 = `${item.match} ${item.city} ${item.region}`;
      const q2 = `${item.city} ${item.region}`;
      const image = (await fetchPlaceImage(q1)) || (await fetchPlaceImage(q2)) || null;
      return { ...item, image };
    }));

    // Attach news if requested
    const withNews = includeNews
      ? await Promise.all(withImages.map(async (item) => {
          const nq = `${item.match} ${item.city} ${item.region}`;
          const news = await fetchTravelNews(nq);
          return { ...item, news: news || null };
        }))
      : withImages;

    return res.status(200).json({ ok: true, place, region, results: withNews, version: "0.6.0" });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: "Server error", detail: String(err?.message || err) });
  }
} // EOF v0.6.0
