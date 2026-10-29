# Historical research alerts

Account sync is now implemented: sign in and explicitly merge browser rules into your private account, then restore them in another browser. Rules are stored in the separate workspace database, guarded by ownership and revision checks. Browser copies remain shared by users of that browser. See [account security and sync](ACCOUNT_SECURITY_AND_SYNC.md).

`/app/alerts` replaces the placeholder. Add up to 20 browser-local rules using one of six comparison pairs, absolute z-score or absolute spread percent, a positive threshold up to 100 and an optional explicit expiry. Empty expiry uses the existing date-based eligible-contract selector.

Browser rules evaluate on page open or Refresh results. No live feed, polling, email, push notification, notification-permission request or background job is implemented. Dataset date and snapshot provenance remain visible. Browser rules are shared by users of that browser; account synchronization uses separate private storage only after an explicit action. Browser removal does not silently delete an account copy; account removal is a separate control.

Magnitude comparisons use an inclusive threshold and preserve the signed observation. Missing/nonfinite statistics, stale observations relative to the dataset date, absent expiries and failed quality/liquidity checks remain unavailable. No alert is manufactured from zero, missing data or another expiry. Analytical maturity matches retain their non-executable label.

Defaults match existing snapshot requests: purity off, 10-session window, minimum 5 observations, 2,000 g volume threshold and maturity matching on. Each distinct pair is requested once; one failed pair does not suppress other results. Current result state is hidden during refresh. Transport outages can use exact existing local snapshots; HTTP errors remain errors.

Browser storage is validated. Invalid stores are not overwritten merely by opening the page; writes happen only on an explicit Add/Remove action. If storage is blocked/full, in-session rules work with a persistence warning. Duplicate rules are rejected.

Checks: `node --test tests/alerts.test.mjs` covers thresholds, missing/stale/quality cases, nonfinite values, mismatched settings, explicit expiry, date validation and persistence. `node scripts/verify-alerts.mjs` requires existing local services and a dedicated Chrome session on CDP 9223; it uses only that test profile's rule store.
