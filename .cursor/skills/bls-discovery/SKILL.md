---
name: bls-discovery
description: Discovers monthly CES updates from BLS Public API v2 and builds month-level detail content.
---

# BLS Discovery

## Scope
- Entry page: `https://www.bls.gov/ces/`
- Feed ID: `website:bls`
- Data source: `https://api.bls.gov/publicAPI/v2/timeseries/data/` (POST JSON)

## Adapter behavior
- List: fetches CES monthly values for a target year (page 1 = current year, page 2 = previous year)
- Item ID: `YYYY-MM`
- Detail: refetches the same year, aggregates key CES series for the month, and renders `content_html`
- Timezone: `published_at` normalized to ISO8601 in `Asia/Shanghai`

## Notes
- BLS web pages are Akamai-protected in some environments; this skill uses the official public API endpoint directly.
- No RSS/Atom is used.
