# Consumer Library — Installation & Handover Guide

This guide is for the people who will set up and look after the library
system. No technical background is needed.

## What you are receiving

One folder named `hospital-library-inventory` containing a small web
application. It runs entirely inside a web browser (Chrome, Edge, Firefox or
Safari). There is nothing to install, no account to create and no internet
connection required.

```
hospital-library-inventory/
  index.html        <- open this file to start the application
  css/              styling
  js/               the program
  sample-data.json  example data for practising
  README.md         full feature reference
  INSTALL.md        this guide
```

## Choose where it will run

Pick the option that fits your situation. You can change later; your data
moves with a single export/import (see "Moving or backing up data").

### Option A — One library computer or kiosk (simplest, recommended)

1. Copy the whole folder onto the computer, for example to
   `C:\Library\hospital-library-inventory` or the Desktop.
2. Open the folder and double-click **`index.html`**. It opens in the default
   browser.
3. Bookmark the page, or right-click `index.html` and create a desktop
   shortcut named "Library".
4. Optional kiosk setup: ask IT to open the page in the browser's kiosk or
   full-screen mode at login so consumers only see the library.

All data is saved automatically **in that browser on that computer**.

### Option B — Shared network drive

1. Copy the folder to a shared drive, for example
   `\\hospital-files\Library\hospital-library-inventory`.
2. On each computer, open `index.html` from the share and bookmark it.

Note: the *program* is shared, but the *data* is still stored separately in
each computer's browser. Use export/import to keep computers in sync, or use
Option A on a single computer if only one place does check-outs.

### Option C — Hospital intranet website

Give the folder to IT and ask them to publish it as a static website on the
intranet (any web server will do: IIS, Apache, nginx, SharePoint site assets
are *not* suitable). Staff and consumers then open an address such as
`https://intranet.hospital.org/library/`.

As with Option B, each browser keeps its own copy of the data. If several
computers must share one live set of data, see "Limits to know about".

### Option D — Public website hosting

The folder can be uploaded to any static web host (GitHub Pages, Netlify,
Cloudflare Pages, an existing hospital website). Treat this as a
convenience only: anyone with the address can open the page, and data still
lives in each visitor's browser, not on the website.

## First-time setup (10 minutes)

1. Open the application and click **Admin** (top right).
2. Log in with the default password **`admin`**.
3. Go to **Settings**:
   - Set the library name.
   - Replace the list of **Hospital units** with your real unit names.
   - Adjust **Sections** to match how the shelves are organised.
   - Set the loan period and the maximum items per patron.
   - **Change the admin password** (bottom of the page). Write it down and
     store it where the library staff can find it; it cannot be recovered.
4. Go to **Collection** and add your books. For many books at once use
   **Bulk add** and paste one book per line:
   `Title | Author | Section | Format | ISBN`.
5. Go to **Labels**, choose your label stock (Avery 5160 sheets are the
   default), click **Print**, and stick the labels on the books.
6. Go to **Data → Download JSON backup** and store the file somewhere safe.

## Daily use

- **Consumers** use the **Library** view: browse by section or search, then
  tap **Check out**, enter their name and choose their unit. To return, scan
  the barcode or tap **Return**. A barcode scanner is optional; any USB
  scanner works with no setup.
- **Staff** use the **Admin** view to see who has what, handle overdue items,
  renew, mark items lost, and add new books. The admin view logs out by
  itself after 15 minutes without activity.

## Moving or backing up data

Everything (books, loans, settings, password) is in one file:

- **Backup**: Admin → Data → **Download JSON backup**. Do this at least
  weekly and after adding many books. Keep the file on a network drive.
- **Restore / move to another computer**: open the application there,
  Admin → Data → choose the backup file → **Replace** → Import.
- **Combine two computers**: import the other computer's file with **Merge**.

The CSV export on the Circulation tab produces a spreadsheet of loans for
reporting.

## Limits to know about

- Data is stored in the browser on each computer. Clearing browser data,
  using a different browser, or a different Windows login means a different
  (possibly empty) library. The JSON backup is the safety net.
- Several computers cannot share one live database. If that becomes a
  requirement, the application needs a small server component; the data
  format is already designed to make that a straightforward addition.
- The password protects the admin screens only; it does not encrypt the
  data. Do not record clinical or sensitive information in the notes fields.

## Getting help

The `README.md` in the folder documents every feature and setting, and the
program files are heavily commented for any developer who maintains it.
