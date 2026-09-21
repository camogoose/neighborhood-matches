// pages/api/like.js
// v0.6.0 — 3 matches (results-only) + hotel roundups ("where to stay / best hotels") + tiny static map box
// Excludes newsy/negative items. Adds gmaps link + OSM static map (no API key).
// Runtime: Node.js (not Edge)

import OpenAI from "openai";

export const config = { runtime: "nodejs", api: { bodyParser: true } };

// ---- CORS ----
function setCors(req, res) {
  const allowedOrigins = [
    "https://www.vorrasi.com",
    "https://vorrasi.com",
    "https://thisplaceisjustlikethatplace.com",
    "https://www.thisplaceisjustlikethatplace.com",
    "https://mike-vorrasi.squarespace.com",
  ];
  const SQS_REGEX = /^https:\/\/[a-z0-9-]+\.squarespace\.com$/i;
  const origin = req.headers.origin;
  if (origin && (allowedOrigins.includes(origin) || SQS_REGEX.test(origin))) {
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
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ");
}
function stripTags(html) { return String(html || "").replace(/<[^>]+>/g, ""); }
function readInput(value, maxLength = 120) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLength);
}
const MATCH_PRIORITIES = new Set([
  "food and restaurants",
  "nightlife",
  "arts and creative scene",
  "architecture and atmosphere",
  "local and less touristy",
  "walkability",
  "affordable",
  "gritty",
  "polished",
]);
function readPriorities(value) {
  const values = Array.isArray(value) ? value : [];
  return [...new Set(values
    .map((item) => readInput(item, 50).toLowerCase())
    .filter((item) => MATCH_PRIORITIES.has(item))
  )].slice(0, 3);
}

// -------------
// News (roundups)
// -------------
const POSITIVE_PHRASES = [
  "where to stay","best hotels","top hotels","hotel guide",
  "best places to stay","best areas to stay","best neighborhoods to stay"
];
const POSITIVE_SITES = [
  "site:cntraveler.com","site:travelandleisure.com","site:afar.com",
  "site:lonelyplanet.com","site:timeout.com","site:nytimes.com",
  "site:planetware.com","site:theculturetrip.com"
].join(" OR ");
const NEGATIVE_TERMS = [
  "sue","sues","lawsuit","legal","court","trial",
  "crash","crashes","collision","killed","dies","shooting",
  "police","arrest","homicide","crime","assault",
  "foreclosure","bankruptcy","closure","closing","demolition","eviction",
  "scandal","protest","boycott","strike","fraud","raid","fire","explosion",
  "merger","acquisition","deal","bought","purchased"
];
function buildNewsQuery(q) {
  const positives =
    `(intitle:"where to stay" OR intitle:"best hotels" OR intitle:"top hotels" OR ` +
    `intitle:"best places to stay" OR intitle:"best areas to stay" OR intitle:"best neighborhoods to stay" OR "hotel guide")`;
  const negatives = NEGATIVE_TERMS.map(x => `-${x}`).join(" ");
  return `${q} ${positives} (${POSITIVE_SITES}) ${negatives}`;
}
async function fetchTravelNews(q) {
  const url = "https://news.google.com/rss/search?hl=en-US&gl=US&ceid=US:en&q=" +
    encodeURIComponent(buildNewsQuery(q));
  try {
    const r = await fetch(url);
    const xml = await r.text();
    const items = [];
    const re = /<item>([\s\S]*?)<\/item>/gi;
    let m; while ((m = re.exec(xml)) && items.length < 12) items.push(m[1]);

    const hasNegative = (text) =>
      NEGATIVE_TERMS.some(bad => new RegExp(`\\b${bad}\\b`, "i").test(text));
    const looksLikeRoundup = (title, desc) => {
      const inTitle = POSITIVE_PHRASES.some(p => new RegExp(p, "i").test(title));
      const inDesc  = POSITIVE_PHRASES.some(p => new RegExp(p, "i").test(desc));
      return (inTitle || inDesc);
    };

    for (const raw of items) {
      const title = clean(pick(raw, /<title>([\s\S]*?)<\/title>/i));
      const link  = clean(pick(raw, /<link>([\s\S]*?)<\/link>/i));
      const descH = clean(pick(raw, /<description>([\s\S]*?)<\/description>/i));
      const desc  = stripTags(descH);
      const haystack = `${title} ${desc}`;
      if (!looksLikeRoundup(title, desc)) continue;
      if (hasNegative(haystack)) continue;
      return {
        title: title || "",
        url: link || "",
        image: "",
        snippet: desc.slice(0, 200) + (desc.length > 200 ? "…" : "")
      };
    }
    return null;
  } catch { return null; }
}

// -------------
// Geocode + static map (no key)
// -------------
async function geocode(query) {
  const u = "https://nominatim.openstreetmap.org/search?format=json&limit=1&q=" +
            encodeURIComponent(query);
  try {
    const r = await fetch(u, {
      headers: { "User-Agent": "thisplaceisjustlikethatplace/1.0 (+https://thisplaceisjustlikethatplace.com)" }
    });
    const arr = await r.json();
    if (!Array.isArray(arr) || !arr.length) return null;
    const { lat, lon } = arr[0];
    const latNum = parseFloat(lat), lonNum = parseFloat(lon);
    if (Number.isNaN(latNum) || Number.isNaN(lonNum)) return null;
    return { lat: latNum, lon: lonNum };
  } catch { return null; }
}
function staticMap(lat, lon) {
  // Courtesy OSM staticmap — fine for light use
  return `https://staticmap.openstreetmap.de/staticmap.php?center=${lat},${lon}&zoom=13&size=600x300&markers=${lat},${lon},lightblue1`;
}
function gmapsLink(q) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}

// -------------
// API
// -------------
export default async function handler(req, res) {
  setCors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method === "GET") {
    return res.status(200).json({
      ok: true,
      service: "This Is Just Like That",
      version: "0.6.0",
      sections: ["resultsOnly"],
      news_filter: "hotel roundups only",
      mode: process.env.OPENAI_API_KEY ? "openai" : "missing_api_key",
    });
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "GET,POST,OPTIONS");
    return res.status(405).json({ ok: false, error: `Method ${req.method} Not Allowed` });
  }

  try {
    const place = readInput(req.body?.place);
    const region = readInput(req.body?.region);
    const priorities = readPriorities(req.body?.priorities);
    if (!place || !region) {
      return res.status(400).json({
        ok: false,
        error: 'Provide non-empty text values for "place" and "region"'
      });
    }
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ ok: false, error: "OPENAI_API_KEY is not set" });
    }

    const prompt = `
You are a neighborhood-matching engine.

Input:
- source place: "${place}"
- scope/region: "${region}"
- visitor priorities: ${priorities.length ? priorities.join(", ") : "none supplied; infer a balanced profile"}

Rules:
- First identify the source place's geographic level: block/corridor, neighborhood,
  district/borough, or city. Match at the SAME level whenever the target region has one.
- A neighborhood-sized source must return specific neighborhoods, not a whole city,
  broad side of a city, or large administrative district. Use the smallest commonly
  recognized local name that accurately describes the match.
- Compare candidates across these dimensions: street energy, density/walkability,
  nightlife rhythm, independent food and retail, arts/creative culture, architecture,
  tourism level, relative price, and grit-versus-polish.
- When visitor priorities are supplied, give those dimensions extra weight without
  ignoring geographic scale or inventing a match that does not fit the source place.
- Strong shared character matters more than fame or superficial demographic similarity.
- Do not choose three near-duplicates. Candidate 1 should be the closest overall match;
  candidates 2 and 3 should be equally specific alternatives that emphasize different
  strong facets of the source place.
- In each blurb, name 2–3 concrete similarities and one useful difference or caveat.
- Avoid vague claims such as "similar vibe" unless the specific shared traits follow.
- For region = "United States" (nationwide), include the state as "State, USA" in "region".
- Return strictly valid JSON ONLY.

Return EXACTLY 3 candidates:

{
  "results": [
    {
      "rank": 1,
      "match": "Neighborhood or area",
      "city": "City",
      "region": "Region/State/Country",
      "blurb": "Why this matches ${place} in 1–2 sentences.",
      "whatMakesItSpecial": [
        "Bullet 1","Bullet 2","Bullet 3","Bullet 4","Bullet 5"
      ],
      "landmarks": [
        { "name": "Spot name", "why": "why it matters in 1 short sentence" }
      ],
      "tags": ["1–3 words","3–6 tags total"],
      "score": 0.0
    }
  ]
}
`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.6,
      messages: [
        { role: "system", content: "You return strictly valid JSON for a neighborhood-matching API. No commentary." },
        { role: "user", content: prompt },
      ],
    });

    let text = completion.choices?.[0]?.message?.content || "{}";
    text = text.trim().replace(/^```json\s*/i, "").replace(/```$/i, "");
    let parsed; try { parsed = JSON.parse(text); } catch { parsed = {}; }

    const base = Array.isArray(parsed?.results) ? parsed.results.slice(0, 3) : [];
    const normalized = base.map((r, i) => ({
      rank: typeof r.rank === "number" ? r.rank : i + 1,
      match: r.match || r.neighborhood || "Unknown",
      city: r.city || "",
      region: r.region || String(region),
      blurb: r.blurb || "",
      whatMakesItSpecial: Array.isArray(r.whatMakesItSpecial) ? r.whatMakesItSpecial.slice(0,5) : [],
      landmarks: Array.isArray(r.landmarks) ? r.landmarks.slice(0,3).map(l => ({
        name: String(l?.name || "").slice(0,80),
        why: String(l?.why || "").slice(0,160)
      })) : [],
      tags: Array.isArray(r.tags) ? r.tags.slice(0,6) : [],
      score: typeof r.score === "number" ? r.score : 0.75,
      source: "openai",
    }));

    // Attach roundup article + map
    const enriched = await Promise.all(normalized.map(async (item) => {
      const query = `${item.match} ${item.city} ${item.region}`;
      const [news, geo] = await Promise.all([
        fetchTravelNews(query),
        geocode(query)
      ]);
      const map = geo ? {
        lat: geo.lat, lon: geo.lon,
        image: staticMap(geo.lat, geo.lon),
        gmaps: gmapsLink(query)
      } : { lat: null, lon: null, image: "", gmaps: gmapsLink(query) };
      return { ...item, news: news || null, map };
    }));

    return res.status(200).json({
      ok: true,
      place, region, priorities,
      results: enriched,
      version: "0.6.0"
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: "Server error", detail: String(err?.message || err) });
  }
}
