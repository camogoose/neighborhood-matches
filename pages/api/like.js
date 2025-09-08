// pages/api/like.js
// ChatGPT-powered matches + Travel-only news snippet (Node.js runtime)

import OpenAI from "openai";

export const config = {
  runtime: "nodejs",
  api: { bodyParser: true },
};

// ✅ CORS: allow Squarespace editor + www + non-www
function setCors(req, res) {
  const allowedOrigins = [
    "https://www.vorrasi.com",
    "https://vorrasi.com",
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

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// --- Simple RSS parsing helpers (no extra deps) ---
function firstMatch(re, text) {
  const m = re.exec(text);
  return m ? m[1].trim() : "";
}

function sanitize(str) {
  return String(str || "")
    .replace(/<!\[CDATA\[(.*?)\]\]>/gs, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

async function fetchNews(query) {
  // Travel-focused Google News RSS
  const url =
    "https://news.google.com/rss/search?hl=en-US&gl=US&ceid=US:en&q=" +
    encodeURIComponent(query + " (travel OR tourism OR visit OR guide)");

  try {
    const r = await fetch(url, { method: "GET" });
    const xml = await r.text();
    const item = firstMatch(/<item>([\s\S]*?)<\/item>/i, xml);
    if (!item) return null;

    const title = sanitize(firstMatch(/<title>([\s\S]*?)<\/title>/i, item));
    const link = sanitize(firstMatch(/<link>([\s\S]*?)<\/link>/i, item));
    const desc = sanitize(firstMatch(/<description>([\s\S]*?)<\/description>/i, item));
    const media =
      firstMatch(/<media:content[^>]*url="([^"]+)"/i, item) ||
      firstMatch(/<enclosure[^>]*url="([^"]+)"/i, item) ||
      "";

    return {
      title: title || "",
      url: link || "",
      image: media || "",
      snippet:
        (desc || "").replace(/<[^>]+>/g, "").slice(0, 180) +
        ((desc && desc.length > 180) ? "…" : ""),
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
      version: "0.3.2",
      mode: process.env.OPENAI_API_KEY ? "openai" : "missing_api_key",
      news_filter: "travel-only",
    });
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "GET,POST,OPTIONS");
    return res.status(405).json({ ok: false, error: `Method ${req.method} Not Allowed` });
  }

  try {
    const { place, region } = req.body || {};
    if (!place || !region) {
      return res
        .status(400)
        .json({ ok: false, error: 'Missing JSON: { "place": "...", "region": "..." }' });
    }
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ ok: false, error: "OPENAI_API_KEY is not set" });
    }

    // Ask the model for 3 JSON results only
    const userPrompt = `
You are a neighborhood-matching engine.
Given:
- place: "${place}"
- scope/region to search within: "${region}"

Return exactly 3 candidates as STRICT JSON (no prose).
Schema:
{
  "results": [
    {
      "rank": 1,
      "match": "Neighborhood name",
      "city": "City name",
      "region": "Region/State/Country",
      "blurb": "1-2 sentence reason this is like ${place}.",
      "tags": ["short","comma-free","tags"],
      "score": 0.0
    }
  ]
}

Rules:
- Only output JSON matching the schema above.
- "score" is 0.60–0.95 (confidence).
- Keep "tags" short (1–2 words each), 3–5 tags.
- If the scope is a country, you can pick cities within it; if it's a state, pick cities in that state, etc.
- Be accurate and avoid duplicates.
`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.7,
      messages: [
        { role: "system", content: "You return only JSON for a neighborhood-matching API." },
        { role: "user", content: userPrompt },
      ],
    });

    let text = completion.choices?.[0]?.message?.content || "{}";
    text = text.trim().replace(/^```json\s*/i, "").replace(/```$/i, "");

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { results: [] };
    }

    const raw = Array.isArray(parsed?.results) ? parsed.results.slice(0, 3) : [];
    if (raw.length === 0) {
      return res.status(200).json({ ok: true, place, region, results: [], note: "No results." });
    }

    const normalized = raw.map((r, i) => ({
      rank: typeof r.rank === "number" ? r.rank : i + 1,
      match: r.match || r.neighborhood || "Unknown",
      city: r.city || "",
      region: r.region || String(region),
      blurb: r.blurb || `Feels similar to ${place}.`,
      tags: Array.isArray(r.tags) ? r.tags.slice(0, 5) : [],
      score: typeof r.score === "number" ? r.score : 0.75,
      source: "openai",
    }));

    // Attach 1 travel news item per match (best-effort)
    const withNews = await Promise.all(
      normalized.map(async (item) => {
        const q = `${item.match} ${item.city} ${item.region}`;
        const news = await fetchNews(q);
        return { ...item, news: news || null };
      })
    );

    return res.status(200).json({
      ok: true,
      count: withNews.length,
      place,
      region,
      results: withNews,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: "Server error", detail: String(err?.message || err) });
  }
}
