# Day Dots

Shows the day dot each product gets if it's thawed, opened or prepped **right
now**, based on the Jamba Shelf-Life Chart. Standalone copy of the Day Dots tab
from the Jamba Planner (`../cleaning-rota`).

## Run

```bash
cd daydots && python3 -m http.server 8000
```

Then open http://localhost:8000. A server is needed because browsers block
`fetch()` of local JSON files opened via `file://`. Any static host works too
(including a subdirectory of a domain, since every path is relative).

## Using it

- The strip at the top shows today's sticker colour and the next 7 days'.
- Each row reads left to right: the first dot (e.g. **Thawed** in the walk-in)
  is replaced by the next (e.g. **Opened**). Dates assume the step happens now.
- Tap a row for the step, shelf life, exact expiry time and any notes.
- Filter by Fridge / Dry / Freezer, or search. Search ignores accents
  ("acai"), handles plurals ("strawberry" = "strawberries"), matches flavours
  ("apple" finds Hand Mixed Juices) and store nicknames ("pango", "oj").

## Data

Everything is in `data/daydots.json`, checked by `schemas/daydots.schema.json`:

- `dotColors`: sticker colour per weekday.
- `categories`: group order on the page.
- `searchNicknames`: shorthand → full name, e.g. `"pango": "passion mango"`.
- `items`: each product, with `steps` (label, shelf life in hours/days/months,
  optional note). Optional `detail` (shown when expanded) and `aliases`
  (extra search words).
- Hide anything the store doesn't use with `"disabled": true` on an item or a
  single step, rather than deleting it.

Day-based shelf lives run through the end of today + N days; hour-based ones
expire at the exact time; months land on the same date N months later.

This folder has its own copy of the data. Changes here don't affect the
Planner's Day Dots tab, and vice versa.
