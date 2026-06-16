---
name: Movement region codes
description: The cow_movement and cmdb tables use different region value formats — always check which table before writing a filter.
---

# Region field formats by table

## cow_movement (region_from, region_to)
Uses 2-letter uppercase abbreviations:
- `WR` — Western Region
- `CR` — Central Region
- `ER` — Eastern Region
- `SR` — Southern Region

Filter with exact match: `.or("region_from.eq.WR,region_to.eq.WR")`  
Do NOT use ilike — `%west%` will not match `WR`.

## cmdb (region column)
Uses mixed-case English words:
- `West`, `Central`, `EAST`, `South`

Filter with ilike: `.ilike("region", "%west%")` (case-insensitive, matches "West" and "WEST")

## Bot implementation
`extractTextFilters()` returns three values:
- `region` — the DB code for movement exact match (e.g. "WR")
- `regionLabel` — human-readable display name (e.g. "Western")
- `regionSearch` — lowercase root word for CMDB ilike (e.g. "west")

**Why:** The two tables were built from different source sheets with no shared schema for region naming. Using the wrong filter type returns 0 results silently.

**How to apply:** Whenever writing a region filter, check which table you're querying and use the correct field from `extractTextFilters`.
