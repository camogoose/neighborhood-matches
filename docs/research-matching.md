# Research-first matching (0.7.0)

## Flow

1. Mandatory web search builds a source-place profile: settlement scale, natural setting,
   relationship to major cities, pace, culture, activities and seasonality. Facts without
   consulted-source URLs are discarded. Require two independent source hostnames and
   at least two defining features, including scale.
2. A second mandatory web-search request researches a 6–8-place destination shortlist
   and compares each source feature with supporting evidence. Country-wide scope does
   not impose geographic diversity on the winners.
3. Code rejects unsupported/out-of-scope candidates, missing/unknown/mismatched defining
   traits and rural-settlement-to-city/suburb/urban-neighborhood substitutions. Rank by
   defining-fit average first; preferences and supporting fit only break ties. Return
   up to three results, not three regardless of quality.

Source selection, claim support, scope classification and feature-fit assessments still
depend on the model. Checking a URL appeared in research prevents invented URLs but does
not prove its page supports a claim. The deterministic gates are not geographic truth
validation. This is a bounded research shortlist, NOT exhaustive country coverage.

## Runtime and cost

- Existing server-only OPENAI_API_KEY; default research model gpt-4.1. Optional RESEARCH_MODEL
  must support Responses web_search. Uses HTTP Responses API so existing SDK/lockfile need
  no upgrade. store:false. No credentials in frontend.
- At most two research requests per cold search; each has max_tool_calls:5 and
  max_output_tokens:6500. Source deadline 40 seconds, candidates 65 seconds. API duration
  configured 120 seconds; verify the Vercel project's plan/config accepts it.
- No automatic retries. Provider failure returns a friendly error, never guessed results.
- Source profiles cached 24 hours; results 6 hours; 128 combined entries, bounded cache,
  in-flight coalescing, four active provider calls per warm process.
- Cache and concurrency guard are process-local: they reset on cold starts and are not
  shared between serverless instances. They are NOT a distributed rate limit or budget
  cap. Set project spending alerts/limits and monitor public-endpoint usage before rollout.
- Provider costs and latency are higher than the former single gpt-4o-mini request.
  Measure preview runs before setting user-facing expectations or increasing limits.

## UI and deployment

Pair with Squarespace V10: same search boxes, Contact popup and visual theme; research
status text and clickable source links added to result cards. Source links are retained
in frozen-share snapshots. Old frozen links remain old results; use a fresh search to
evaluate the new pipeline. Sources replace unrelated hotel-roundup enrichment. Existing
Google map embeds continue to use result names; no geocode/news network fan-out needed.

DO NOT merge the draft until live preview evaluation succeeds. Install V10 before
publishing backend so research citations are visible (V10 works with the old backend).
Keep V9 and the previous backend revision for rollback. No Explore-this-match control
or extra visitor questions are included.

## Verification

Offline: `node --test tests/*.test.cjs` and Next production build.

Fixtures named Narrowsburg, Hood River and Lower East Side test ranking mechanics only;
they do not establish destination accuracy. Real preview acceptance:

- Narrowsburg NY → Denmark: profile must prioritize small river settlement/rural setting;
  assess major-city/weekend relationship from sources, not assume an exact driving time.
  City gallery districts must not replace that identity.
- Hood River OR → Denmark: confirm town disambiguation, Columbia Gorge/wind-sports
  significance and seasonality from evidence; reject shopping-only substitutes.
- Lower East Side NYC → Denmark: urban neighborhood identity preserved. Strong matches
  can all be in Copenhagen. No forced city variety.
- Inspect each linked source, blurb, caveat and comparisons. Check empty-result handling,
  repeat-search caching/latency, contact opening, mobile source links and shared results.
- No one should claim these tests passed until real requests and source review occurred.

Official integration references:
- https://developers.openai.com/api/docs/guides/tools-web-search
- https://developers.openai.com/api/docs/models/gpt-4.1
- https://vercel.com/docs/functions/configuring-functions/duration
