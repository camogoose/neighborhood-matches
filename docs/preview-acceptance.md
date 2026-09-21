# Preview acceptance — 2026-09-21

Tested deployed version 0.6.2 on the budget-identity-matching preview. Do not merge: semantic acceptance failed despite passing offline checks/build.

- Narrowsburg, NY → Denmark: completed in 9 seconds. Returned Sønderho, Mölle and Ebeltoft. FAIL: coastal substitutions do not preserve river-hamlet identity; Mölle is in Sweden but was labeled Denmark. Verified against Visit Sweden (https://visitsweden.com/what-to-do/curated-journeys/road-trips/road-trip-skane-blekinge-one-week/).
- Hood River, Oregon → United States of America: completed in 7 seconds. Returned Bend, White Salmon and Sandy. FAIL: only White Salmon's explanation meaningfully preserves wind sports; generic outdoor recreation displaced the signature activity in the other two. Did not recommend Hood River itself.
- One intervening UI input-setting mistake submitted United States of America → Denmark (8 seconds). Excluded from intended quality assessment. Three submissions total; no further paid retries. Lower East Side test deferred to stay within the three-call test limit.

Conclusion: prompt instructions alone did not reliably enforce signature activities or geography. Keep live production unchanged. Next revision needs explicit candidate eligibility checks for defining activities and destination geography; do not claim this version solves those issues. No claim of exact charges: billing was not inspected.
