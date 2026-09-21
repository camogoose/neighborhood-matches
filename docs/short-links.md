# Short shared-result links — setup gate

Not active until storage is connected, backend deployed and frontend installed. Do not merge/deploy the frontend before a real storage round-trip test.

## Behavior
- POST /api/share validates and stores a snapshot only when Share is clicked. GET /api/share?id=… retrieves it. Neither imports or calls OpenAI.
- Canonical link: https://www.thisplaceisjustlikethatplace.com/?share=<24 hex chars>.
- Content-addressed immutable records deduplicate identical result snapshots. Links are unlisted, NOT private or authenticated. Anyone with a link can read its snapshot. No private information should be entered.
- The sharing API accepts user-submitted results; a saved result is not proof of AI provenance or factual accuracy.
- No stored-link expiry, no overwrites, no application deletion of older results. Provider account retention policies still apply.
- Atomic save limits: 20 KiB per snapshot, 20,000 records, 96 MiB JSON payload, 500 new records/day. These conservative limits intentionally leave free-tier headroom; accepted creates stop at the limits.
- Provider operations and database metadata have additional overhead. These limits do NOT cap all request traffic or hosting costs. CORS is not authentication; public API abuse/edge rate limiting needs review before promotion.
- Provider Free plan must be explicitly verified; no paid upgrade or billing settings are changed by this code. At provider limits, sharing fails safely rather than re-running AI.
- If clipboard permissions prevent copying after an asynchronous save, a copyable prompt displays the short URL.
- Existing #d= links remain supported. Malformed stored links never auto-trigger AI. Plain ?this=…&that=… links retain prior search behavior.

## Owner setup
1. Create a dedicated persistent Upstash Redis database on the Free plan (not a temporary 72-hour database). Disable eviction so old links cannot disappear to make room. Verify no auto-upgrade/pay-as-you-go is enabled. Do not add payment details for this feature.
2. Put UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN in the Vercel project's environment settings, not frontend code, GitHub, or chat. Use separate databases for preview and production; the caps assume a dedicated database. Set SHARING_ENABLED=true only after checking the plan.
3. Deploy this branch to preview. Exercise real create/read/duplicate/concurrent and capacity checks using synthetic data (no paid AI searches). The offline transport mock does not execute Redis Lua.
4. Check current live Squarespace code against frontend/squarespace-short-links.html (based on saved V9). Preserve any intervening site edits. Replace only after backend readiness. Current endpoint CORS accepts the two public site domains; preview form testing must use same-origin requests or an explicitly reviewed origin.
5. Verify new short links on desktop/mobile and in a fresh browser; verify existing long links. Confirm maps, contact, and ordinary searches are unchanged.

## Test commands
node --test tests/share.test.cjs tests/share-frontend.test.cjs tests/budget-match.test.cjs

## Source
Upstash REST interface: https://upstash.com/docs/redis/features/restapi
Free tier details: https://upstash.com/pricing/redis

## Rollback
Reinstall the prior Squarespace block to restore long-link creation. Previously created short links need the short-link reader and storage to remain available. To stop new saves without breaking reads, use a deployment change to block POST only; SHARING_ENABLED=false stops both.
