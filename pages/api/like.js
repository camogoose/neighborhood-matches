version: "0.5.4",
      sections: ["resultsOnly"],
      news_filter: "travel-only (negatives excluded)",
      mode:
      mode: process.env.OPENAI_API_KEY ? "openai" : "missing_api_key"
    });
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "GET,POST,OPTIONS");
    return res.status(405).json({ ok: false, error: `Method ${req.method} Not Allowed` });
  }

  try {
    const { place, region, includeNews, newsOnly, items } = req.body || {};

    // News-only path
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
} // end handler

// EOF v0.5.4
