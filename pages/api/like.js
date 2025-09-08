// pages/api/like.js
// ChatGPT-powered matches (Node.js runtime)

import OpenAI from "openai";

export const config = {
  runtime: "nodejs",
  api: { bodyParser: true },
};

function setCors(req, res) {
  const allowedOrigin = "https://www.vorrasi.com"; // 👈 your Squarespace domain
  const origin = req.headers.origin;

  if (origin === allowedOrigin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}


const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY, // set this in Vercel → Project → Settings → Environment Variables
});

export default async function handler(req, res) {
  setCors(req, res);

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method === "GET") {
    return res.status(200).json({
      ok: true,
      service: "This Is Just Like That",
      version: "0.2.0",
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
      return res
        .status(400)
        .json({ ok: false, error: 'Missing JSON: { "place": "...", "region": "..." }' });
    }
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({
        ok: false,
        error: "OPENAI_API_KEY is not set",
      });
    }

    // Prompt: ask the model for 3 JSON results only
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

    // Use Chat Completions (Node.js)
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.7,
      messages: [
        { role: "system", content: "You return only JSON for a neighborhood-matching API." },
        { role: "user", content: userPrompt },
      ],
    });

    let text = completion.choices?.[0]?.message?.content || "{}";

    // Clean possible code fences and parse JSON
    text = text.trim().replace(/^```json\s*/i, "").replace(/```$/i, "");
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      // last-resort: wrap results if model returned an array
      parsed = { results: Array.isArray(text) ? text : [] };
    }

    const results = Array.isArray(parsed?.results) ? parsed.results.slice(0, 3) : [];

    if (results.length === 0) {
      return res.status(200).json({
        ok: true,
        place,
        region,
        results: [],
        note: "Model returned no results.",
      });
    }

    // Normalize and ensure required fields
    const normalized = results.map((r, i) => ({
      rank: typeof r.rank === "number" ? r.rank : i + 1,
      match: r.match || r.neighborhood || "Unknown",
      city: r.city || "",
      region: r.region || String(region),
      blurb: r.blurb || `Feels similar to ${place}.`,
      tags: Array.isArray(r.tags) ? r.tags.slice(0, 5) : [],
      score: typeof r.score === "number" ? r.score : 0.75,
      source: "openai",
    }));

    return res.status(200).json({
      ok: true,
      count: normalized.length,
      place,
      region,
      results: normalized,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      ok: false,
      error: "Server error",
      detail: String(err?.message || err),
    });
  }
}
