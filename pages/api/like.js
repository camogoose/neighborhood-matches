// pages/api/like.js
// v0.5.6 — 3 matches (results-only) + STRICT hotel roundups ("where to stay" / "best hotels")
// Excludes newsy/negative items (lawsuits, crashes, foreclosures, etc.)
// Runtime: Node.js (not Edge)

import OpenAI from "openai";

export const config = { runtime: "nodejs", api: { bodyParser: true } };

// ---- CORS: allow Squarespace preview + live domains ----
function setCors(req, res) {
  const allowedOrigins = [
    // Personal site (optional)
    "https://www.vorrasi.com",
    "https://vorrasi.com",

    // Live custom domain (both www + bare)
    "https://thisplaceisjustlikethatplace.com",
    "https://www.thisplaceisjustlikethatplace.com",

    // Squarespace editor (sometimes used during previews)
    "https://mike-vorrasi.squarespace.com",
  ];

  // Allow any *.squarespace.com preview (safer than hardcoding a single slug)
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

// ---- tiny helpers (no deps) ----
function pick(s, re) { const m = re.exec(s); return m ? m[1].trim() : ""; }
function clean(str) {
  return String(str || "")
    .replace(/<!\[CDATA\[(.*?)\]\]>/gs, "$1")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}
function stripTags(html) { return String(html || "").replace(/<[^>]+>/g, ""); }

// --------------------
// News (roundups only)
// --------------------

// Positive phrases we WANT
const POSITIVE_PHRASES = [
  "where to stay",
  "best hotels",
  "top hotels",
  "hotel guide",
  "best places to stay",
  "best areas to stay",
  "best neighborhoods to stay",
];

// Publishers we prefer (travel-focused)
const POSITIVE_SITES = [
  "site:cntraveler.com",
  "site:travelandleisure.com",
  "site:afar.com",
  "site:lonelyplanet.com",
  "site:timeout.com",
  "site:nytimes.com",          // has travel/36 hours/where to stay guides
  "site:planetware.com",
  "site:theculturetrip.com",
].join(" OR ");

// Things we want to KEEP OUT completely
const NEGATIVE_TERMS = [
  "sue","sues","lawsuit","legal","court","trial","crash","crashes","collision",
  "killed","dies","shooting","police","arrest","homicide","crime","assault",
  "foreclosure","bankruptcy","closure","closing","demolition","eviction",
  "scandal","protest","boycott","strike","fraud","raid","fire","explosion",
  "merger","acquisition","deal","bought","purchased" // real-estate/finance-y news
];

// Build a strict query that highly favors roundups/guides
function buildNewsQuery(q) {
  const positives =
    `(intitle:"where to stay" OR intitle:"best hotels" OR intitle:"top hotels" OR ` +
    `intitle:"best places to stay" OR intitle:"best areas to stay" OR intitle:"best neighborhoods to stay" OR "hotel guide")`;
  // We still include site filters, but the intitle checks do most of the work
  const negatives = NEGATIVE_TERMS.map(x => `-${x}`).join(" ");
  return `${q} ${positives} (${POSITIVE_SITES}) ${negatives}`;
}

// Parse Google News RSS and return the FIRST item that looks like a legit roundup
async function fetchTravelNews(q) {
  const url =
    "https://news.google.com/rss/search?hl=en-US&gl=US&ceid=US:en&q=" +
    encodeURIComponent(buildNewsQuery(q));

  try {
    const r = await fetch(url);
    const xml = await r.text();

    // Collect the first ~10 items and filter
    const items = [];
    const re = /<item>([\s\S]*?)<\/item>/gi;
    let m;
    while ((m = re.exec(xml)) && items.length < 12) items.push(m[1]);

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
        image: "", // not used in embed now
        snippet: desc.slice(0, 200) + (desc.length > 200 ? "…" : "")
      };
    }

    // Nothing suitable
    return null;
  } catch {
    return null;
  }
}

// --------------------
// API handler
// --------------------
export default async function handler(req, res) {
  setCors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method === "GET") {
    return res.status(200).json({
      ok: true,
      service: "This Is Just Like That",
      version: "0.5.6",
      sections: ["resultsOnly"],
      news_filter: "roundups-only (where to stay / best hotels)",
      mode: process.env.OPENAI_API_KEY ? "openai" : "missing_api_key",
    });
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "GET,POST,OPTIONS");
    return res.status(405).json({ ok: false, error: `Method ${req.method} Not Allowed` });
  }

  try {
    const { place, region } = req.body || {};
    if (!place || !region) {
      return res.status(400).json({ ok: false, error: 'Missing JSON: { "place": "...", "region": "..." }' });
    }
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ ok: false, error: "OPENAI_API_KEY is not set" });
    }

    // Prompt: return 3 matches only (with bullets + landmarks)
    const prompt = `
You are a neighborhood-matching engine.

Input:
- source place: "${place}"
- scope/region: "${region}"

Rules:
- Prefer neighborhoods (not whole cities) when possible.
- Consider scale similarity (population/density/foot-traffic) if known; otherwise infer typical scale.
- Avoid duplicates; be accurate.
- For searches across the entire United States, include the state name in each "region" field as "State, USA".

Return EXACTLY 3 candidates in strictly valid JSON:

{
  "results": [
    {
      "rank": 1,
      "match": "Neighborhood or area",
      "city": "City",
      "region": "Region/State/Country",
      "blurb": "Why this matches ${place} in 1–2 sentences.",
      "whatMakesItSpecial": [
        "Short bullet 1",
        "Short bullet 2",
        "Short bullet 3",
        "Short bullet 4",
        "Short bullet 5"
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
    let parsed;
    try { parsed = JSON.parse(text); } catch { parsed = {}; }

    // Normalize matches
    const base = Array.isArray(parsed?.results) ? parsed.results.slice(0, 3) : [];
    const normalized = base.map((r, i) => ({
      rank: typeof r.rank === "number" ? r.rank : i + 1,
      match: r.match || r.neighborhood || "Unknown",
      city: r.city || "",
      region: r.region || String(region),
      blurb: r.blurb || "",
      whatMakesItSpecial: Array.isArray(r.whatMakesItSpecial) ? r.whatMakesItSpecial.slice(0,5) : [],
      landmarks: Array.isArray(r.landmarks) ? r.landmarks.slice(0,3).map(l => ({
        name: String(l?.name || "").slice(0, 80),
        why: String(l?.why || "").slice(0, 160)
      })) : [],
      tags: Array.isArray(r.tags) ? r.tags.slice(0, 6) : [],
      score: typeof r.score === "number" ? r.score : 0.75,
      source: "openai",
    }));

    // Attach roundup-style travel article (best-effort)
    const withNews = await Promise.all(normalized.map(async (item) => {
      const nq = `${item.match} ${item.city} ${item.region}`;
      const news = await fetchTravelNews(nq);
      return { ...item, news: news || null };
    }));

    return res.status(200).json({
      ok: true,
      place, region,
      results: withNews,
      version: "0.5.6"
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: "Server error", detail: String(err?.message || err) });
  }
}
