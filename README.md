# Consumer Library — Inventory & Circulation System

A self-contained HTML/JavaScript application for managing a consumer (patient)
library on an inpatient mental-health unit. It runs entirely in the browser:
no server, no database, no internet connection and no installation.

```
library-inventory/
├── index.html          page structure (open this file)
├── css/styles.css      styling, including label print layouts
├── js/sha256.js        password hashing
├── js/barcode.js       Code 128 / Code 39 barcode generator (SVG)
├── js/store.js         data model, rules, localStorage + JSON import/export
├── js/app.js           user interface
├── js/sample-data.js   example library for the "Load sample data" button
└── sample-data.json    the same example as a JSON file (for testing Import)
```

## Quick start

1. Copy the `library-inventory` folder to the kiosk computer (or a shared drive).
2. Open `index.html` in Chrome, Edge or Firefox.
3. Click **Admin**, log in with the default password **`admin`**, and change it
   immediately under **Settings**.
4. Optionally load the sample data (**Data → Load sample data**) to explore.
5. Add your collection under **Collection** (one at a time or **Bulk add**),
   then print labels under **Labels**.
6. **Export a JSON backup** (Data tab) whenever you finish a session of changes.

The app saves automatically to the browser's `localStorage`, so closing the tab
or restarting the computer does not lose data. Browser storage is still
per-computer and per-browser-profile and can be wiped by IT policies, so the
JSON export is the authoritative backup.

## Features

### Consumer view (no password)
- Large **section buttons** (Fiction, Self-Help & Recovery, Puzzles & Games, …)
  with item counts. The list and order are editable in Settings.
- **Catalog search** by title, author, subject/tag, ISBN or section, with
  availability filter and sort.
- **Check out** by tapping an item or scanning its barcode. The patron enters
  their **name** and chooses the **hospital unit** they reside in (plus an
  optional room/bed). The due date is set by the loan-period policy.
- **Return** by scanning or tapping a checked-out item.
- Consumers see whether an item is out and when it is due, but never who has it.
- A per-patron loan limit (default 3) is enforced; staff can override it.
- A scan box is always ready: USB barcode scanners "type" the code and press
  Enter, and typing anywhere on the kiosk focuses the scan box automatically.

### Admin view (password protected)
- **Dashboard**: counts, overdue list, recent activity.
- **Collection**: add/edit/delete items, bulk add from pasted text, mark items
  lost or withdrawn, filter/search, multi-select for label printing or CSV export.
- **Circulation**: scan to check out or return with full control — due-date
  override, staff initials, notes, condition on return, renew, mark lost — plus
  active-loan and full loan-history tables with unit/date filters and CSV export.
- **Labels**: automatic barcode generation (`LIB000001`, `LIB000002`, …),
  on-screen preview, and printing on Avery 5160/8160 (30 per sheet), Avery
  5163/8163 (10 per sheet) or roll/thermal label printers.
- **Reports**: loans by hospital unit, collection by section, most-borrowed
  titles, full activity log.
- **Settings**: library name, loan period, loan limit, auto-logout, barcode
  prefix/digits/symbology/width, sections, units, formats, password.
- **Data**: export/import JSON (replace or merge), copy to clipboard, sample
  data, full reset.

### Data captured at check-out
Every loan records: item (id, barcode, title snapshot), patron name, hospital
unit, room/bed (optional), check-out time, due date, return time, outcome
(returned/lost), whether it was done at the kiosk or by staff, staff initials,
condition on return, renewals and notes. All of it is in the JSON export and
in the CSV export on the Circulation tab.

## Barcodes and scanners
- Barcodes are generated automatically when an item is added. To reuse labels
  you already have, type that barcode into the **Barcode** field when adding.
- Default symbology is **Code 128**; **Code 39** is available in Settings for
  scanners that struggle. Both were verified against an independent decoder.
- If scans fail: try the other symbology, increase **Bar width** in Settings,
  print at 100 % scale (no "fit to page"), and use a laser printer or a thermal
  label printer rather than an inkjet on glossy labels.
- Any USB/Bluetooth scanner in "keyboard wedge" mode works. Make sure it is
  configured to send **Enter** after each scan (the factory default for most).

## Moving data between computers
1. On the old computer: **Admin → Data → Download JSON backup**.
2. On the new computer: open the app, **Admin → Data → choose the file →
   Replace → Import**.

Use **Merge** instead when two computers were used independently and you want
to combine them: items and loans are matched by id (or barcode) and added or
updated; the receiving computer's settings and password are kept.

## Security notes
- The password only protects the admin *screens*. The data is stored
  unencrypted in the browser and in export files. Do not store information
  that must be confidential beyond what is necessary for circulation.
- The admin session logs out automatically after 15 minutes of inactivity
  (configurable) so a kiosk left on the admin view cannot be misused.
- Each browser profile has its own storage. Running the kiosk in a dedicated
  browser profile (or kiosk mode) keeps consumers away from browser settings.

## For developers / future support
- There is no build step. Edit the files and reload the page.
- `store.js` contains the full data model in its header comment, plus every
  business rule. `app.js` is purely UI and never mutates data directly.
- `schemaVersion` in the export is `1`. If you change the shape of the data,
  bump it and extend `normalize()` in `store.js` so old files still import.
- Barcode pattern tables have a start-up self-test (`Barcode.selfTest()`), and
  the generator was verified by rendering labels and decoding them with the
  zxing library. A quick manual check: open the browser console and run
  `SHA256.hex('abc')` — it must start with `ba7816bf`.
- To regenerate `sample-data.json` after editing `js/sample-data.js`:
  `node -e "global.window={};require('./js/sample-data.js');console.log(JSON.stringify(window.SampleData,null,2))" > sample-data.json`
- Tested in Chromium (Playwright) covering login, sample load, add item with
  auto barcode, duplicate-barcode rejection, kiosk and staff check-out/return,
  loan-limit enforcement, label printing, export/import round-trip, invalid
  JSON handling, password change and settings.
