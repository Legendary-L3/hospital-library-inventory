/**
 * store.js
 * ---------------------------------------------------------------------------
 * The single source of truth for all library data, plus persistence.
 *
 * RESPONSIBILITIES
 *   - Define the data model (see "DATA MODEL" below).
 *   - Keep the in-memory state and notify the UI (app.js) when it changes.
 *   - Auto-save to localStorage after every change, so a browser refresh or
 *     an accidental tab close loses nothing.
 *   - Export the complete state to JSON and import it back (replace or merge),
 *     which is how data is moved between computers/browsers and backed up.
 *   - Implement the business rules: barcode generation, check-out/check-in,
 *     renewals, loan limits, password hashing, activity logging.
 *
 * The UI (app.js) never mutates `state` directly; it calls the functions
 * exported at the bottom of this file. That keeps all rules in one place.
 *
 * DATA MODEL (what the JSON export looks like)
 * {
 *   schemaVersion: 1,                 // bump when the shape changes; see migrate()
 *   exportedAt: "2026-10-20T15:04:05.000Z",
 *   settings: {
 *     libraryName: "Consumer Library",
 *     adminPasswordHash: "<sha256 hex of salt + ':' + password>",
 *     passwordSalt: "<random string>",
 *     usingDefaultPassword: true,      // show a warning until the password is changed
 *     loanPeriodDays: 14,
 *     maxLoansPerPatron: 3,            // enforced for consumer check-outs; admin may override
 *     autoLogoutMinutes: 15,           // admin session idle timeout
 *     barcodePrefix: "LIB",
 *     barcodeDigits: 6,                // LIB000001
 *     barcodeSymbology: "code128",     // or "code39"
 *     barcodeModuleWidth: 2,
 *     labelLayout: "sheet30",          // default print layout
 *     sections: ["Fiction", ...],      // order = order of consumer buttons
 *     units: ["Unit A", ...],          // hospital units patrons may reside in
 *     formats: ["Book", "Large Print", ...]
 *   },
 *   items: [{
 *     id, barcode, title, author, section, format, isbn, year, publisher,
 *     description, tags: [], location,  // e.g. "Shelf 3"
 *     status: "available" | "checked_out" | "lost" | "withdrawn",
 *     condition: "", notes: "",
 *     addedAt, updatedAt, labelPrintedAt
 *   }],
 *   loans: [{
 *     id, itemId, barcode, titleSnapshot,
 *     patronName, unit, roomOrBed,
 *     checkedOutAt, dueAt, returnedAt (null while active),
 *     checkedOutVia: "consumer" | "admin", returnedVia,
 *     staffInitials, notes, returnCondition, renewals: 0,
 *     outcome: "returned" | "lost" | null
 *   }],
 *   activityLog: [{ at, type, message, data }],   // newest last, capped
 *   nextBarcodeSeq: 1
 * }
 *
 * Each physical copy is its own item with its own barcode. Two copies of the
 * same title are two items; this keeps check-out tracking unambiguous.
 * ---------------------------------------------------------------------------
 */
(function (global) {
  'use strict';

  /** localStorage key. Change it only if you intentionally want a fresh, empty library. */
  const STORAGE_KEY = 'hospitalConsumerLibrary.v1';
  const SCHEMA_VERSION = 1;
  const ACTIVITY_LOG_CAP = 2000;
  const DEFAULT_ADMIN_PASSWORD = 'admin';

  const ITEM_STATUSES = ['available', 'checked_out', 'lost', 'withdrawn'];

  /* =========================================================================
   * Defaults
   * ======================================================================= */

  /** Sections shown as the big buttons in the consumer view (editable in Settings). */
  const DEFAULT_SECTIONS = [
    'Fiction', 'Mystery & Thriller', 'Science Fiction & Fantasy', 'Romance',
    'Non-Fiction', 'Biography & Memoir', 'Self-Help & Recovery', 'Mental Health & Wellness',
    'Spirituality & Inspiration', 'Poetry', 'Graphic Novels & Comics', 'Puzzles & Games',
    'Magazines', 'Large Print', 'Spanish & Other Languages', 'Young Adult',
  ];

  /** Hospital units a patron may reside in (editable in Settings). */
  const DEFAULT_UNITS = ['Unit A', 'Unit B', 'Unit C', 'Unit D', 'Adolescent Unit', 'Geriatric Unit'];

  const DEFAULT_FORMATS = ['Book', 'Paperback', 'Hardcover', 'Large Print', 'Magazine', 'Audiobook', 'DVD', 'Puzzle', 'Game', 'Other'];

  /** Random string for the password salt / IDs. Falls back when crypto is unavailable. */
  function randomString(length) {
    const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let out = '';
    if (global.crypto && global.crypto.getRandomValues) {
      const bytes = new Uint8Array(length);
      global.crypto.getRandomValues(bytes);
      for (let i = 0; i < length; i++) out += alphabet[bytes[i] % alphabet.length];
    } else {
      for (let i = 0; i < length; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
    return out;
  }

  /** Unique ID for items/loans/log entries: time-based prefix keeps them sortable. */
  function newId(prefix) {
    return `${prefix}_${Date.now().toString(36)}_${randomString(6)}`;
  }

  function hashPassword(plain, salt) {
    return global.SHA256.hex(`${salt}:${plain}`);
  }

  /** Brand-new, empty library with the default password "admin". */
  function defaultState() {
    const salt = randomString(16);
    return {
      schemaVersion: SCHEMA_VERSION,
      exportedAt: null,
      settings: {
        libraryName: 'Consumer Library',
        adminPasswordHash: hashPassword(DEFAULT_ADMIN_PASSWORD, salt),
        passwordSalt: salt,
        usingDefaultPassword: true,
        loanPeriodDays: 14,
        maxLoansPerPatron: 3,
        autoLogoutMinutes: 15,
        barcodePrefix: 'LIB',
        barcodeDigits: 6,
        barcodeSymbology: 'code128',
        barcodeModuleWidth: 2,
        labelLayout: 'sheet30',
        sections: DEFAULT_SECTIONS.slice(),
        units: DEFAULT_UNITS.slice(),
        formats: DEFAULT_FORMATS.slice(),
      },
      items: [],
      loans: [],
      activityLog: [],
      nextBarcodeSeq: 1,
    };
  }

  /* =========================================================================
   * State, persistence, change notification
   * ======================================================================= */

  let state = null;
  const listeners = new Set();
  let lastSaveError = null;

  /** Register a callback that runs after every committed change. Returns an unsubscribe fn. */
  function subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  function notify() {
    listeners.forEach((fn) => {
      try { fn(state); } catch (e) { console.error('Store listener failed', e); }
    });
  }

  /**
   * Persist to localStorage. Failures (quota exceeded, private mode, disabled
   * storage) are recorded in lastSaveError and surfaced by the UI so staff know
   * to export a JSON backup manually.
   */
  function save() {
    try {
      global.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      lastSaveError = null;
    } catch (e) {
      lastSaveError = e;
      console.error('Could not save library data to localStorage', e);
    }
  }

  /** Call after every mutation: save, then tell the UI to re-render. */
  function commit() {
    state.exportedAt = null; // exportedAt only has meaning inside an export file
    save();
    notify();
  }

  /** Load from localStorage (or start fresh). Called once at start-up by app.js. */
  function load() {
    let loaded = null;
    try {
      const raw = global.localStorage.getItem(STORAGE_KEY);
      if (raw) loaded = JSON.parse(raw);
    } catch (e) {
      console.error('Stored library data is unreadable; starting with an empty library.', e);
    }
    state = loaded ? normalize(loaded).state : defaultState();
    reconcile();
    save();
    return state;
  }

  /* =========================================================================
   * Normalisation / validation
   * -------------------------------------------------------------------------
   * Imported JSON (and localStorage contents) may have been hand-edited, come
   * from an older version, or be partially corrupt. normalize() coerces an
   * arbitrary object into a valid state, collecting warnings and hard errors.
   * ======================================================================= */

  const str = (v, fallback = '') => (v === undefined || v === null ? fallback : String(v));
  const num = (v, fallback) => (Number.isFinite(Number(v)) ? Number(v) : fallback);
  const arr = (v) => (Array.isArray(v) ? v : []);
  const strList = (v, fallback) => {
    const list = arr(v).map((s) => str(s).trim()).filter(Boolean);
    return list.length ? Array.from(new Set(list)) : fallback.slice();
  };
  const isoOrNull = (v) => {
    if (!v) return null;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  };

  function normalizeItem(raw, defaults) {
    const status = ITEM_STATUSES.includes(raw.status) ? raw.status : 'available';
    return {
      id: str(raw.id) || newId('item'),
      barcode: str(raw.barcode).trim(),
      title: str(raw.title).trim(),
      author: str(raw.author).trim(),
      section: str(raw.section).trim() || defaults.sections[0],
      format: str(raw.format).trim() || defaults.formats[0],
      isbn: str(raw.isbn).trim(),
      year: str(raw.year).trim(),
      publisher: str(raw.publisher).trim(),
      description: str(raw.description).trim(),
      tags: arr(raw.tags).map((t) => str(t).trim()).filter(Boolean),
      location: str(raw.location).trim(),
      status,
      condition: str(raw.condition).trim(),
      notes: str(raw.notes).trim(),
      addedAt: isoOrNull(raw.addedAt) || new Date().toISOString(),
      updatedAt: isoOrNull(raw.updatedAt) || isoOrNull(raw.addedAt) || new Date().toISOString(),
      labelPrintedAt: isoOrNull(raw.labelPrintedAt),
    };
  }

  function normalizeLoan(raw) {
    return {
      id: str(raw.id) || newId('loan'),
      itemId: str(raw.itemId),
      barcode: str(raw.barcode),
      titleSnapshot: str(raw.titleSnapshot),
      patronName: str(raw.patronName).trim(),
      unit: str(raw.unit).trim(),
      roomOrBed: str(raw.roomOrBed).trim(),
      checkedOutAt: isoOrNull(raw.checkedOutAt) || new Date().toISOString(),
      dueAt: isoOrNull(raw.dueAt),
      returnedAt: isoOrNull(raw.returnedAt),
      checkedOutVia: raw.checkedOutVia === 'admin' ? 'admin' : 'consumer',
      returnedVia: raw.returnedVia === 'admin' || raw.returnedVia === 'consumer' ? raw.returnedVia : null,
      staffInitials: str(raw.staffInitials).trim(),
      notes: str(raw.notes).trim(),
      returnCondition: str(raw.returnCondition).trim(),
      renewals: Math.max(0, Math.floor(num(raw.renewals, 0))),
      outcome: raw.outcome === 'returned' || raw.outcome === 'lost' ? raw.outcome : null,
    };
  }

  /**
   * Convert an arbitrary parsed object into a valid state.
   * @returns {{state: object, errors: string[], warnings: string[]}}
   *   `errors` non-empty means the object is unusable (e.g. not an object at all).
   */
  function normalize(raw) {
    const errors = [];
    const warnings = [];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return { state: null, errors: ['The file does not contain a JSON object.'], warnings };
    }
    if (raw.schemaVersion !== undefined && num(raw.schemaVersion, 1) > SCHEMA_VERSION) {
      warnings.push(`File schemaVersion ${raw.schemaVersion} is newer than this app (${SCHEMA_VERSION}); unknown fields were ignored.`);
    }

    const fresh = defaultState();
    const s = raw.settings && typeof raw.settings === 'object' ? raw.settings : {};
    const settings = {
      libraryName: str(s.libraryName).trim() || fresh.settings.libraryName,
      adminPasswordHash: str(s.adminPasswordHash) || fresh.settings.adminPasswordHash,
      passwordSalt: str(s.passwordSalt) || fresh.settings.passwordSalt,
      usingDefaultPassword: s.usingDefaultPassword !== undefined ? Boolean(s.usingDefaultPassword) : !s.adminPasswordHash,
      loanPeriodDays: Math.max(1, Math.floor(num(s.loanPeriodDays, 14))),
      maxLoansPerPatron: Math.max(0, Math.floor(num(s.maxLoansPerPatron, 3))),
      autoLogoutMinutes: Math.max(0, Math.floor(num(s.autoLogoutMinutes, 15))),
      barcodePrefix: str(s.barcodePrefix, 'LIB').trim().toUpperCase(),
      barcodeDigits: Math.min(12, Math.max(1, Math.floor(num(s.barcodeDigits, 6)))),
      barcodeSymbology: s.barcodeSymbology === 'code39' ? 'code39' : 'code128',
      barcodeModuleWidth: Math.min(6, Math.max(1, num(s.barcodeModuleWidth, 2))),
      labelLayout: ['sheet30', 'sheet10', 'roll'].includes(s.labelLayout) ? s.labelLayout : 'sheet30',
      sections: strList(s.sections, DEFAULT_SECTIONS),
      units: strList(s.units, DEFAULT_UNITS),
      formats: strList(s.formats, DEFAULT_FORMATS),
    };
    // If the hash is present but the salt is missing we cannot verify logins; reset to default.
    if (s.adminPasswordHash && !s.passwordSalt) {
      warnings.push('Password salt missing; admin password was reset to the default.');
      settings.adminPasswordHash = fresh.settings.adminPasswordHash;
      settings.passwordSalt = fresh.settings.passwordSalt;
      settings.usingDefaultPassword = true;
    }

    const items = [];
    const seenBarcodes = new Set();
    const seenIds = new Set();
    arr(raw.items).forEach((rawItem, index) => {
      if (!rawItem || typeof rawItem !== 'object') { warnings.push(`items[${index}] is not an object and was skipped.`); return; }
      const item = normalizeItem(rawItem, settings);
      if (!item.title) { warnings.push(`items[${index}] has no title and was skipped.`); return; }
      if (seenIds.has(item.id)) { item.id = newId('item'); warnings.push(`Duplicate item id at items[${index}]; a new id was assigned.`); }
      seenIds.add(item.id);
      if (item.barcode && seenBarcodes.has(item.barcode)) {
        warnings.push(`Duplicate barcode "${item.barcode}" at items[${index}]; a new barcode will be assigned.`);
        item.barcode = '';
      }
      if (item.barcode) seenBarcodes.add(item.barcode);
      items.push(item);
    });

    const loans = [];
    const seenLoanIds = new Set();
    arr(raw.loans).forEach((rawLoan, index) => {
      if (!rawLoan || typeof rawLoan !== 'object') { warnings.push(`loans[${index}] is not an object and was skipped.`); return; }
      const loan = normalizeLoan(rawLoan);
      if (seenLoanIds.has(loan.id)) { loan.id = newId('loan'); }
      seenLoanIds.add(loan.id);
      // Resolve the item by id, then by barcode, so hand-built files still link up.
      let item = items.find((i) => i.id === loan.itemId);
      if (!item && loan.barcode) item = items.find((i) => i.barcode === loan.barcode);
      if (item) {
        loan.itemId = item.id;
        loan.barcode = loan.barcode || item.barcode;
        loan.titleSnapshot = loan.titleSnapshot || item.title;
      } else if (!loan.titleSnapshot) {
        warnings.push(`loans[${index}] refers to an unknown item and has no title; kept for history.`);
      }
      // An active loan (no returnedAt) must have a due date; default to loan period.
      if (!loan.returnedAt && !loan.dueAt) {
        loan.dueAt = addDays(new Date(loan.checkedOutAt), settings.loanPeriodDays).toISOString();
      }
      if (loan.returnedAt && !loan.outcome) loan.outcome = 'returned';
      loans.push(loan);
    });

    const activityLog = arr(raw.activityLog)
      .filter((e) => e && typeof e === 'object')
      .map((e) => ({ at: isoOrNull(e.at) || new Date().toISOString(), type: str(e.type, 'note'), message: str(e.message), data: e.data === undefined ? null : e.data }))
      .slice(-ACTIVITY_LOG_CAP);

    // Barcode sequence must be above every existing numeric suffix with our prefix.
    let nextBarcodeSeq = Math.max(1, Math.floor(num(raw.nextBarcodeSeq, 1)));
    for (const item of items) {
      const seq = sequenceFromBarcode(item.barcode, settings.barcodePrefix);
      if (seq !== null && seq >= nextBarcodeSeq) nextBarcodeSeq = seq + 1;
    }

    const normalized = { schemaVersion: SCHEMA_VERSION, exportedAt: null, settings, items, loans, activityLog, nextBarcodeSeq };
    return { state: normalized, errors, warnings };
  }

  /**
   * Make item statuses agree with the loans table and give barcodes to items
   * that lack one. Runs after load/import so the UI never sees contradictions
   * (e.g. an item "available" that has an open loan).
   */
  function reconcile() {
    const activeByItem = new Map();
    for (const loan of state.loans) {
      if (!loan.returnedAt && loan.outcome !== 'lost') activeByItem.set(loan.itemId, loan);
    }
    for (const item of state.items) {
      if (!item.barcode) item.barcode = allocateBarcode();
      if (activeByItem.has(item.id)) {
        if (item.status === 'available') item.status = 'checked_out';
      } else if (item.status === 'checked_out') {
        item.status = 'available';
      }
    }
  }

  /* =========================================================================
   * Small date helpers (also used by app.js via Store.util)
   * ======================================================================= */

  function addDays(date, days) {
    const d = new Date(date.getTime());
    d.setDate(d.getDate() + days);
    return d;
  }

  /** End of the day (23:59:59.999 local time) `days` from now, used for due dates. */
  function dueDateFromNow(days) {
    const d = addDays(new Date(), days);
    d.setHours(23, 59, 59, 999);
    return d;
  }

  /* =========================================================================
   * Barcodes
   * ======================================================================= */

  /** Build a barcode string from the prefix/digits settings and a sequence number. */
  function formatBarcode(seq, settings) {
    const s = settings || state.settings;
    return `${s.barcodePrefix}${String(seq).padStart(s.barcodeDigits, '0')}`;
  }

  /** Inverse of formatBarcode(); returns the number or null if the barcode has another shape. */
  function sequenceFromBarcode(barcode, prefix) {
    if (!barcode || !barcode.startsWith(prefix)) return null;
    const rest = barcode.slice(prefix.length);
    return /^\d+$/.test(rest) ? Number(rest) : null;
  }

  /** Reserve and return the next unused auto-generated barcode. */
  function allocateBarcode() {
    let code;
    do {
      code = formatBarcode(state.nextBarcodeSeq);
      state.nextBarcodeSeq += 1;
    } while (state.items.some((i) => i.barcode === code));
    return code;
  }

  /** Preview of the barcode the next new item will receive (no side effects). */
  function peekNextBarcode() {
    let seq = state.nextBarcodeSeq;
    let code = formatBarcode(seq);
    while (state.items.some((i) => i.barcode === code)) { seq += 1; code = formatBarcode(seq); }
    return code;
  }

  /** Scanner input often includes stray whitespace or a trailing newline; normalise it. */
  function cleanScan(text) {
    return String(text || '').trim();
  }

  function findByBarcode(barcode) {
    const code = cleanScan(barcode);
    if (!code) return null;
    // Exact match first, then case-insensitive (Code 39 scanners return upper-case).
    return state.items.find((i) => i.barcode === code) ||
      state.items.find((i) => i.barcode.toUpperCase() === code.toUpperCase()) || null;
  }

  function getItem(id) {
    return state.items.find((i) => i.id === id) || null;
  }

  /* =========================================================================
   * Activity log
   * ======================================================================= */

  function log(type, message, data) {
    state.activityLog.push({ at: new Date().toISOString(), type, message, data: data === undefined ? null : data });
    if (state.activityLog.length > ACTIVITY_LOG_CAP) {
      state.activityLog.splice(0, state.activityLog.length - ACTIVITY_LOG_CAP);
    }
  }

  /* =========================================================================
   * Items (collection management)
   * ======================================================================= */

  /**
   * Add an item. `fields` may include `barcode` to use a pre-printed label;
   * when omitted/blank a barcode is generated automatically.
   * @returns the new item
   */
  function addItem(fields) {
    const item = normalizeItem(fields || {}, state.settings);
    if (!item.title) throw new Error('Title is required.');
    if (item.barcode) {
      if (findByBarcode(item.barcode)) throw new Error(`Barcode ${item.barcode} is already in use.`);
      if (!global.Barcode.isEncodable(item.barcode, state.settings.barcodeSymbology)) {
        throw new Error(`Barcode "${item.barcode}" contains characters the ${state.settings.barcodeSymbology} symbology cannot print.`);
      }
    } else {
      item.barcode = allocateBarcode();
    }
    item.id = newId('item');
    item.status = item.status === 'checked_out' ? 'available' : item.status; // can't be born checked out
    item.addedAt = item.updatedAt = new Date().toISOString();
    item.labelPrintedAt = null;
    state.items.push(item);
    log('item.add', `Added "${item.title}" (${item.barcode})`, { itemId: item.id });
    commit();
    return item;
  }

  /** Add several items at once (used by the bulk-add text box). Returns the created items. */
  function addItems(list) {
    const created = [];
    for (const fields of list) created.push(addItemNoCommit(fields));
    commit();
    return created;
  }
  function addItemNoCommit(fields) {
    // Same as addItem() without the commit; shared by bulk operations.
    const item = normalizeItem(fields || {}, state.settings);
    if (!item.title) throw new Error('Title is required.');
    if (item.barcode && findByBarcode(item.barcode)) throw new Error(`Barcode ${item.barcode} is already in use.`);
    if (!item.barcode) item.barcode = allocateBarcode();
    item.id = newId('item');
    item.status = 'available';
    item.addedAt = item.updatedAt = new Date().toISOString();
    item.labelPrintedAt = null;
    state.items.push(item);
    log('item.add', `Added "${item.title}" (${item.barcode})`, { itemId: item.id });
    return item;
  }

  /** Update editable fields of an item. Status changes go through setItemStatus(). */
  function updateItem(id, fields) {
    const item = getItem(id);
    if (!item) throw new Error('Item not found.');
    const next = normalizeItem(Object.assign({}, item, fields, { id: item.id, status: item.status }), state.settings);
    if (!next.title) throw new Error('Title is required.');
    if (next.barcode !== item.barcode) {
      const clash = findByBarcode(next.barcode);
      if (clash && clash.id !== id) throw new Error(`Barcode ${next.barcode} is already in use.`);
      if (!global.Barcode.isEncodable(next.barcode, state.settings.barcodeSymbology)) {
        throw new Error(`Barcode "${next.barcode}" contains characters the current symbology cannot print.`);
      }
      next.labelPrintedAt = null; // a new barcode needs a new label
    }
    next.updatedAt = new Date().toISOString();
    Object.assign(item, next);
    log('item.update', `Edited "${item.title}" (${item.barcode})`, { itemId: id });
    commit();
    return item;
  }

  /**
   * Change an item's status to available / lost / withdrawn. Closing an open
   * loan as "lost" is done here so the loan history stays accurate.
   */
  function setItemStatus(id, status, note) {
    if (!['available', 'lost', 'withdrawn'].includes(status)) throw new Error('Invalid status.');
    const item = getItem(id);
    if (!item) throw new Error('Item not found.');
    const active = activeLoanForItem(id);
    if (active) {
      if (status === 'lost') {
        active.returnedAt = new Date().toISOString();
        active.outcome = 'lost';
        active.returnedVia = 'admin';
        active.returnCondition = note || 'Reported lost';
      } else {
        throw new Error('Return the item before changing its status.');
      }
    }
    item.status = status;
    if (note) item.notes = item.notes ? `${item.notes}\n${note}` : note;
    item.updatedAt = new Date().toISOString();
    log('item.status', `"${item.title}" marked ${status}`, { itemId: id, note: note || '' });
    commit();
    return item;
  }

  /** Permanently delete an item. Its loan history is kept (titleSnapshot survives). */
  function removeItem(id) {
    const index = state.items.findIndex((i) => i.id === id);
    if (index === -1) throw new Error('Item not found.');
    const [item] = state.items.splice(index, 1);
    // Close any open loan so it does not linger as "active" for a ghost item.
    for (const loan of state.loans) {
      if (loan.itemId === id && !loan.returnedAt) {
        loan.returnedAt = new Date().toISOString();
        loan.outcome = 'returned';
        loan.returnedVia = 'admin';
        loan.notes = `${loan.notes ? loan.notes + '\n' : ''}Closed because the item was deleted.`;
      }
    }
    log('item.remove', `Deleted "${item.title}" (${item.barcode})`, { item });
    commit();
    return item;
  }

  /** Record that labels were printed for these items (so "not yet printed" filters work). */
  function markLabelsPrinted(ids) {
    const now = new Date().toISOString();
    let count = 0;
    for (const id of ids) {
      const item = getItem(id);
      if (item) { item.labelPrintedAt = now; count++; }
    }
    if (count) {
      log('labels.print', `Printed ${count} label(s)`, { itemIds: ids });
      commit();
    }
  }

  /* =========================================================================
   * Loans (circulation)
   * ======================================================================= */

  function activeLoanForItem(itemId) {
    return state.loans.find((l) => l.itemId === itemId && !l.returnedAt) || null;
  }

  function activeLoans() {
    return state.loans.filter((l) => !l.returnedAt);
  }

  /** Active loans belonging to a patron (name match is case/whitespace-insensitive, scoped to unit). */
  function activeLoansForPatron(patronName, unit) {
    const key = normalizePatronKey(patronName);
    return activeLoans().filter((l) => normalizePatronKey(l.patronName) === key && (!unit || l.unit === unit));
  }

  function normalizePatronKey(name) {
    return String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
  }

  function isOverdue(loan, now) {
    return !loan.returnedAt && loan.dueAt && new Date(loan.dueAt) < (now || new Date());
  }

  /**
   * Check an item out to a patron.
   * @param {object} p
   * @param {string} p.itemId
   * @param {string} p.patronName   required
   * @param {string} p.unit         required - the hospital unit the patron resides in
   * @param {string} [p.roomOrBed]
   * @param {string} [p.dueAt]      ISO date; defaults to loanPeriodDays from now
   * @param {'consumer'|'admin'} p.via
   * @param {string} [p.staffInitials]
   * @param {string} [p.notes]
   * @param {boolean} [p.overrideLimit]  admin only: ignore maxLoansPerPatron
   * @returns the new loan
   */
  function checkOut(p) {
    const item = getItem(p.itemId);
    if (!item) throw new Error('Item not found.');
    if (item.status !== 'available') {
      throw new Error(item.status === 'checked_out' ? 'This item is already checked out.' : `This item is ${item.status} and cannot be checked out.`);
    }
    const patronName = str(p.patronName).trim();
    const unit = str(p.unit).trim();
    if (!patronName) throw new Error('Please enter the name of the person checking this out.');
    if (!unit) throw new Error('Please choose the unit the person resides in.');

    const limit = state.settings.maxLoansPerPatron;
    if (limit > 0 && !p.overrideLimit) {
      const current = activeLoansForPatron(patronName, unit).length;
      if (current >= limit) {
        throw new Error(`${patronName} already has ${current} item(s) checked out (limit ${limit}). Please return one first or ask staff.`);
      }
    }

    const now = new Date();
    const dueAt = p.dueAt ? new Date(p.dueAt) : dueDateFromNow(state.settings.loanPeriodDays);
    if (Number.isNaN(dueAt.getTime())) throw new Error('Due date is not valid.');

    const loan = {
      id: newId('loan'),
      itemId: item.id,
      barcode: item.barcode,
      titleSnapshot: item.title,
      patronName,
      unit,
      roomOrBed: str(p.roomOrBed).trim(),
      checkedOutAt: now.toISOString(),
      dueAt: dueAt.toISOString(),
      returnedAt: null,
      checkedOutVia: p.via === 'admin' ? 'admin' : 'consumer',
      returnedVia: null,
      staffInitials: str(p.staffInitials).trim(),
      notes: str(p.notes).trim(),
      returnCondition: '',
      renewals: 0,
      outcome: null,
    };
    state.loans.push(loan);
    item.status = 'checked_out';
    item.updatedAt = now.toISOString();
    log('loan.out', `"${item.title}" checked out to ${patronName} (${unit}) via ${loan.checkedOutVia}`, { loanId: loan.id });
    commit();
    return loan;
  }

  /**
   * Return an item. Works from either the item id or the loan id.
   * @param {object} p
   * @param {string} [p.itemId]
   * @param {string} [p.loanId]
   * @param {'consumer'|'admin'} p.via
   * @param {string} [p.condition]   e.g. "Good", "Damaged - cover torn"
   * @param {string} [p.notes]
   * @param {string} [p.staffInitials]
   * @returns the closed loan
   */
  function checkIn(p) {
    let loan = p.loanId ? state.loans.find((l) => l.id === p.loanId) : activeLoanForItem(p.itemId);
    if (!loan) throw new Error('This item is not checked out.');
    if (loan.returnedAt) throw new Error('This loan is already closed.');
    const now = new Date().toISOString();
    loan.returnedAt = now;
    loan.outcome = 'returned';
    loan.returnedVia = p.via === 'admin' ? 'admin' : 'consumer';
    loan.returnCondition = str(p.condition).trim();
    if (p.notes) loan.notes = loan.notes ? `${loan.notes}\n${str(p.notes).trim()}` : str(p.notes).trim();
    if (p.staffInitials) loan.staffInitials = str(p.staffInitials).trim();
    const item = getItem(loan.itemId);
    if (item) {
      item.status = 'available';
      item.updatedAt = now;
      if (loan.returnCondition && !/^(good|ok|fine)$/i.test(loan.returnCondition)) item.condition = loan.returnCondition;
    }
    log('loan.in', `"${loan.titleSnapshot}" returned by ${loan.patronName} (${loan.unit}) via ${loan.returnedVia}`, { loanId: loan.id });
    commit();
    return loan;
  }

  /** Extend an active loan by the loan period (or to an explicit ISO date). Admin only. */
  function renewLoan(loanId, newDueAt) {
    const loan = state.loans.find((l) => l.id === loanId);
    if (!loan || loan.returnedAt) throw new Error('Loan is not active.');
    const due = newDueAt ? new Date(newDueAt) : addDays(new Date(Math.max(Date.now(), new Date(loan.dueAt).getTime())), state.settings.loanPeriodDays);
    if (Number.isNaN(due.getTime())) throw new Error('Due date is not valid.');
    loan.dueAt = due.toISOString();
    loan.renewals += 1;
    log('loan.renew', `"${loan.titleSnapshot}" renewed for ${loan.patronName}; due ${due.toLocaleDateString()}`, { loanId });
    commit();
    return loan;
  }

  /* =========================================================================
   * Settings & password
   * ======================================================================= */

  function updateSettings(fields) {
    const merged = Object.assign({}, state.settings, fields);
    // Re-run normalisation so bad values are clamped exactly as on import.
    const { state: normalized } = normalize({ settings: merged, items: [], loans: [] });
    // Preserve credential fields unless explicitly changed through setPassword().
    normalized.settings.adminPasswordHash = state.settings.adminPasswordHash;
    normalized.settings.passwordSalt = state.settings.passwordSalt;
    normalized.settings.usingDefaultPassword = state.settings.usingDefaultPassword;
    state.settings = normalized.settings;
    log('settings.update', 'Settings changed', { keys: Object.keys(fields) });
    commit();
    return state.settings;
  }

  function verifyPassword(plain) {
    return hashPassword(String(plain), state.settings.passwordSalt) === state.settings.adminPasswordHash;
  }

  function setPassword(newPlain) {
    const pw = String(newPlain);
    if (pw.length < 4) throw new Error('Password must be at least 4 characters.');
    const salt = randomString(16);
    state.settings.passwordSalt = salt;
    state.settings.adminPasswordHash = hashPassword(pw, salt);
    state.settings.usingDefaultPassword = pw === DEFAULT_ADMIN_PASSWORD;
    log('settings.password', 'Admin password changed');
    commit();
  }

  /* =========================================================================
   * Export / import
   * ======================================================================= */

  /** Full snapshot as pretty-printed JSON text (what gets downloaded). */
  function exportJSON() {
    const snapshot = Object.assign({}, state, { exportedAt: new Date().toISOString() });
    return JSON.stringify(snapshot, null, 2);
  }

  /** Suggested file name for an export, e.g. library-backup-2026-10-20-1504.json */
  function exportFileName() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `library-backup-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.json`;
  }

  /**
   * Parse and validate JSON text WITHOUT applying it. The UI shows the
   * resulting summary and asks for confirmation before calling importJSON().
   */
  function previewImport(text) {
    let parsed;
    try { parsed = JSON.parse(text); } catch (e) { return { ok: false, errors: [`Not valid JSON: ${e.message}`], warnings: [] }; }
    const { state: normalized, errors, warnings } = normalize(parsed);
    if (errors.length) return { ok: false, errors, warnings };
    return {
      ok: true,
      errors: [],
      warnings,
      summary: {
        libraryName: normalized.settings.libraryName,
        exportedAt: parsed.exportedAt || null,
        items: normalized.items.length,
        loans: normalized.loans.length,
        activeLoans: normalized.loans.filter((l) => !l.returnedAt).length,
        logEntries: normalized.activityLog.length,
      },
      normalized,
    };
  }

  /**
   * Apply an import.
   * @param {string} text   JSON text
   * @param {'replace'|'merge'} mode
   *   replace - the file becomes the whole library (settings, password, everything).
   *   merge   - items/loans from the file are added; existing records with the
   *             same id (or same barcode for items) are updated from the file.
   *             Sections/units/formats are unioned. Other settings and the
   *             password are kept as they are on this computer.
   * @returns {{warnings:string[], added:number, updated:number}}
   */
  function importJSON(text, mode) {
    const preview = previewImport(text);
    if (!preview.ok) throw new Error(preview.errors.join(' '));
    const incoming = preview.normalized;
    let added = 0, updated = 0;

    if (mode === 'replace') {
      state = incoming;
      reconcile();
      log('data.import', `Replaced library from file (${incoming.items.length} items, ${incoming.loans.length} loans)`);
    } else {
      const byId = new Map(state.items.map((i) => [i.id, i]));
      const byBarcode = new Map(state.items.map((i) => [i.barcode, i]));
      for (const inc of incoming.items) {
        const existing = byId.get(inc.id) || byBarcode.get(inc.barcode);
        if (existing) {
          const keepStatus = existing.status;
          Object.assign(existing, inc, { id: existing.id, status: keepStatus });
          updated++;
        } else {
          if (byBarcode.has(inc.barcode)) inc.barcode = allocateBarcode();
          state.items.push(inc);
          byId.set(inc.id, inc);
          byBarcode.set(inc.barcode, inc);
          added++;
        }
      }
      const loanIds = new Set(state.loans.map((l) => l.id));
      for (const loan of incoming.loans) {
        if (loanIds.has(loan.id)) {
          Object.assign(state.loans.find((l) => l.id === loan.id), loan);
        } else {
          // Re-link to the local item id when matched by barcode.
          const localItem = byId.get(loan.itemId) || byBarcode.get(loan.barcode);
          if (localItem) loan.itemId = localItem.id;
          state.loans.push(loan);
        }
      }
      const union = (a, b) => Array.from(new Set([...a, ...b]));
      state.settings.sections = union(state.settings.sections, incoming.settings.sections);
      state.settings.units = union(state.settings.units, incoming.settings.units);
      state.settings.formats = union(state.settings.formats, incoming.settings.formats);
      state.nextBarcodeSeq = Math.max(state.nextBarcodeSeq, incoming.nextBarcodeSeq);
      reconcile();
      log('data.import', `Merged file: ${added} item(s) added, ${updated} updated`);
    }
    commit();
    return { warnings: preview.warnings, added, updated };
  }

  /** Wipe everything and start over (keeps nothing - the UI requires typed confirmation). */
  function resetAll() {
    state = defaultState();
    log('data.reset', 'Library reset to empty');
    commit();
  }

  /* =========================================================================
   * Reports (read-only aggregations used by the admin Reports tab)
   * ======================================================================= */

  function loansByUnit() {
    const map = new Map();
    for (const unit of state.settings.units) map.set(unit, { unit, active: 0, total: 0, overdue: 0 });
    for (const loan of state.loans) {
      if (!map.has(loan.unit)) map.set(loan.unit, { unit: loan.unit, active: 0, total: 0, overdue: 0 });
      const row = map.get(loan.unit);
      row.total++;
      if (!loan.returnedAt) { row.active++; if (isOverdue(loan)) row.overdue++; }
    }
    return Array.from(map.values()).sort((a, b) => b.total - a.total || a.unit.localeCompare(b.unit));
  }

  function itemsBySection() {
    const map = new Map();
    for (const section of state.settings.sections) map.set(section, { section, total: 0, available: 0, checkedOut: 0, other: 0 });
    for (const item of state.items) {
      if (!map.has(item.section)) map.set(item.section, { section: item.section, total: 0, available: 0, checkedOut: 0, other: 0 });
      const row = map.get(item.section);
      row.total++;
      if (item.status === 'available') row.available++;
      else if (item.status === 'checked_out') row.checkedOut++;
      else row.other++;
    }
    return Array.from(map.values());
  }

  function mostBorrowed(limit) {
    const counts = new Map();
    for (const loan of state.loans) {
      const key = loan.itemId || loan.titleSnapshot;
      const row = counts.get(key) || { title: loan.titleSnapshot, barcode: loan.barcode, count: 0 };
      row.count++;
      counts.set(key, row);
    }
    return Array.from(counts.values()).sort((a, b) => b.count - a.count).slice(0, limit || 10);
  }

  /* =========================================================================
   * Public API
   * ======================================================================= */
  global.Store = {
    STORAGE_KEY,
    DEFAULT_ADMIN_PASSWORD,
    load, subscribe, getState: () => state,
    getLastSaveError: () => lastSaveError,
    // items
    addItem, addItems, updateItem, setItemStatus, removeItem, getItem, findByBarcode,
    peekNextBarcode, markLabelsPrinted, cleanScan,
    // loans
    checkOut, checkIn, renewLoan, activeLoans, activeLoanForItem, activeLoansForPatron, isOverdue,
    // settings
    updateSettings, verifyPassword, setPassword,
    // data
    exportJSON, exportFileName, previewImport, importJSON, resetAll,
    // reports
    loansByUnit, itemsBySection, mostBorrowed,
    // helpers shared with the UI
    util: { addDays, dueDateFromNow, newId },
  };
})(window);
