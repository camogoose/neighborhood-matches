# Budget-conscious matching (0.6.2)

This proposal starts from main 0.6.1, not research-first draft PR #4. No Squarespace paste or design change is required.

## Behavior

- Retains one gpt-4o-mini Chat Completions call for a new search, existing input fields, result-card schema and Google Maps destination links.
- Prioritizes settlement scale, natural setting, signature activities, metro relationship and pace before incidental shops, galleries or nightlife.
- Retains country-wide consideration without city-diversity quotas and city-specific scope when requested.
- Allows zero to three plausible results rather than requiring three weak ones; exact duplicates are removed.
- No paid web-search tool, extra research call, model upgrade, automatic SDK retry or new visitor question.
- Removes unrelated Google News hotel roundup requests and server-side Nominatim/static-map enrichment. Map links remain, but static image/coordinates are empty. Verify the existing frontend's link/iframe fallback before release.
- Six-hour, 128-entry warm-process result cache. Equivalent case/spacing and reordered priorities share results; changed destinations/preferences do not. Simultaneous identical requests share one call. Failed calls are not cached.
- Two simultaneous uncached calls per process, 25-second SDK timeout, 2,200 output-token limit and 4 KB request-body limit.
- MATCHING_PAUSED=true disables new and cached POST searches. It does not alter the default live configuration automatically.

## Honest limits

This is NOT free: new model calls still cost money. Caching and concurrency are per warm process, not durable/shared, and do not prevent account-wide overspend or distributed abuse. Hosting remains independently billable. No hard dollar cap or global rate limiter is implemented. A timeout may occur after billable work has started.

Matching is still model-knowledge-based, not live-researched or fact-verified. Prompt improvements are not proof of better real-world matches. No new free-data API has been integrated: adding broad, unreliable lookups would increase latency and failure paths. Reviewed reusable place profiles can be added later with explicit provenance and coverage.

## Verification

Run `node --test tests/budget-match.test.cjs`. Tests use fake responses and never call a paid provider. They verify request count/settings, identity-first instructions, caching/coalescing/expiry/bounds, input and result validation, fewer results, duplicate removal, pause behavior and safe errors.

No paid acceptance tests authorized or performed. Before merging, review the preview build and frontend compatibility; a separately approved small model test should compare Narrowsburg → Denmark, Hood River → Denmark and Lower East Side → Denmark. Check source scale/setting/activities, major differences, geographic scope and time to result. Do not merge research-first PR #4 for this lower-cost approach.
