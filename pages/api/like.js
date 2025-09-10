// pages/api/like.js
// v0.5.4 — 3 matches (results-only) + hotel-first travel news (negatives excluded)
// Runtime: Node.js (not Edge)

import OpenAI from "openai";

export const config = { runtime: "nodejs", api: { bodyParser: true } };

// ---- CORS: allow your preview + live Squarespace domains (edit as needed) ----
function setCors(req, res) {
  const allowedOrigins = [
    // Your personal site (optional)
    "https://www.vorrasi.com",
    "https://vorrasi.com",

    // Squarespace preview domain for THIS project (keep while testing)
    // NOTE: this subdomain can change. Update if your preview URL differs.
    "https://contrabass-dog-6klj.squarespace.com",

    // Your live custom domain (both www + bare)
    "https://thisplaceisjustlikethatplace.com",
    "https://www.thisplaceisjustlikethatplace.com",

    // Squarespace editor (sometimes used during previews)
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

// Prefer hotel/where-to-stay first; then food/tourism; exclude negative news
function buildNewsQuery(q) {
  const positiveSites = [
    "site:cntraveler.com",
    "site:travelandleisure.com",
    "site:timeout.com",
    "site:nytimes.com",
    "site:eater.com",
    "site:bonappetit.com",
    "site:thrillist.com",
    "site:airbnb.com",
    "site:afar.com",
    "site:lonelyplanet.com"
  ].join(" OR ");

  const positives = '("where to stay" OR hotel OR hotels OR lodging OR airbnb OR travel OR tourism OR guide OR neighborhood)';
  const negatives = "-police -murder -death -shooting -killed -dies -arrest -homicide -crime -assault -lawsuit";
  return `${q} (${positives}) (${positiveSites}) ${negatives}`;
}

async function fetchTravelNews(q) {
  const url = "https://news.google.com/rss/search?hl=en-US&gl=US&ceid=US:en&q="
    + encodeURIComponent(buildNewsQuery(q));
  try {
    const r = await fetch(url);
    const xml = await r.text();
    const item = pick(xml, /<item>([\s\S]*?)<\/item>/i);
    if (!item) return null;
    const title = clean(pick(item, /<title>([\s\S]*?)<\/title>/i));
    const link  = clean(pick(item, /<link>([\s\S]*?)<\/link>/i));
    const desc  = clean(pick(item, /<description>([\s\S]*?)<\/description>/i));
    return {
      title: title || "",
      url: link || "",
      image: "", // not used in embed now
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
      version: "0.5.4",
      sections: ["resultsOnly"],
      news_filter: "travel/hotel-first (negatives excluded)",
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

    // Attach hotel-first travel news (best-effort)
    const withNews = await Promise.all(normalized.map(async (item) => {
      const nq = `${item.match} ${item.city} ${item.region}`;
      const news = await fetchTravelNews(nq);
      return { ...item, news: news || null };
    }));

    return res.status(200).json({
      ok: true,
      place, region,
      results: withNews,
      version: "0.5.4"
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: "Server error", detail: String(err?.message || err) });
  }
}
