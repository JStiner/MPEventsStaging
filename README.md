## Live Site
- `https://jstiner.github.io/MP_CommunityEvents/`

# Community Events Calendar Demo

Static GitHub Pages starter for a community events app.

## Included
- Home page calendar with month / week / day views
- Separate event pages
- Separate JSON data files per event
- Shared styling and reusable JS
- Christmas on Vinegar Hill flyer section rendered from JSON data
- Reference source files stored in `assets/docs/`

## Event Data Files
- `data/fall-fest-2026.json`
- `data/second-fridays-2026.json`
- `data/christmas-on-vinegar-hill-2026.json`

## Christmas on Vinegar Hill structure
The Christmas page now supports:
- grouped locations
- multi-vendor location modals
- vendor lists per host location
- a flyer tab rendered from data
- downloadable source reference files

## Reference Files
- `assets/docs/christmas-on-vinegar-hill-2025-pamphlet.docx`
- `assets/docs/christmas-on-vinegar-hill-vendor-reference.xlsx`

- Month view stays in a true 7-column grid, including on smaller screens via horizontal scrolling.


## Added in v5
- General bucket pages and data files:
  - `community-events.html`
  - `high-school-events.html`
  - `town-services.html`
- Home calendar filter chips for event buckets
- Proper light month-view calendar grid with color-coded event chips

- Location modal vendor lists now render only for locations marked `multiVendor: true`.


## Added in v7
- Non-multi-vendor location cards no longer show a vendor count.
- Added Excel template for gathering event data:
  - `assets/docs/vendor-intake-template.xlsx`

### Template sheets
- `Instructions`
- `Locations`
- `Vendors`
- `Schedule`

- Added `Event Submissions` sheet to the vendor intake workbook for raw intake and review tracking.

- Updated `data/fall-fest-2026.json` with 2025 Fall Festival schedule content transcribed from the flyer and added theme metadata.

- Demo data dates have been normalized to 2026 across the included event JSON files.


## Local Testing Note
This site loads event data from JSON files using `fetch()`. If you open the HTML directly from a ZIP or local folder with a `file://` path, browsers often block the JSON loads and the pages will look empty.

Use one of these instead:
- GitHub Pages
- a local web server such as `python -m http.server`
