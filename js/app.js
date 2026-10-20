/**
 * app.js
 * ---------------------------------------------------------------------------
 * User interface controller. Everything that touches the DOM lives here.
 * Business rules and persistence live in store.js; barcodes in barcode.js.
 *
 * HOW RENDERING WORKS
 *   - `ui` holds transient UI state (current view, active tab, filters,
 *     selections). It is NOT saved; the library data is in Store.
 *   - render() redraws whichever view is visible from Store.getState() + ui.
 *     It is cheap (template strings + innerHTML) so we simply call it after
 *     every change instead of patching individual elements.
 *   - Store.subscribe(render) means any data change re-renders automatically.
 *   - Clicks on elements with a `data-action` attribute are handled by ONE
 *     delegated listener (see handleAction) so re-rendered markup keeps
 *     working without re-binding events.
 *
 * SECTIONS IN THIS FILE
 *   1. Helpers (DOM, formatting, toast, modal, downloads)
 *   2. UI state & view switching, admin session
 *   3. Consumer view
 *   4. Check-out / return dialogs (shared by consumer and admin)
 *   5. Admin: dashboard, collection, circulation, labels, reports, settings, data
 *   6. Delegated actions & start-up
 * ---------------------------------------------------------------------------
 */
(function () {
  'use strict';

  /* =========================================================================
   * 1. Helpers
   * ======================================================================= */

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  /** Escape text for safe insertion into HTML templates. ALWAYS use for user data. */
  function esc(value) {
    return String(value === undefined || value === null ? '' : value)
      .replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  const DATE_OPTS = { year: 'numeric', month: 'short', day: 'numeric' };
  const DATETIME_OPTS = { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' };
  function fmtDate(iso) { return iso ? new Date(iso).toLocaleDateString(undefined, DATE_OPTS) : ''; }
  function fmtDateTime(iso) { return iso ? new Date(iso).toLocaleString(undefined, DATETIME_OPTS) : ''; }
  /** YYYY-MM-DD in local time, for <input type="date"> values. */
  function toDateInputValue(date) {
    const d = new Date(date);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  /** Convert a <input type="date"> value to the end of that local day (ISO). */
  function fromDateInputValue(value) {
    if (!value) return null;
    const [y, m, d] = value.split('-').map(Number);
    return new Date(y, m - 1, d, 23, 59, 59, 999).toISOString();
  }
  function daysBetween(a, b) {
    return Math.floor((new Date(b) - new Date(a)) / 86400000);
  }
  function statusLabel(status) {
    return { available: 'Available', checked_out: 'Checked out', lost: 'Lost', withdrawn: 'Withdrawn' }[status] || status;
  }
  function statusBadge(status) {
    return `<span class="badge badge-${esc(status)}">${esc(statusLabel(status))}</span>`;
  }
  function optionList(values, selected) {
    return values.map((v) => `<option value="${esc(v)}"${v === selected ? ' selected' : ''}>${esc(v)}</option>`).join('');
  }

  /** Small transient message at the bottom of the screen. type: 'info' | 'success' | 'error' */
  function toast(message, type) {
    const el = document.createElement('div');
    el.className = `toast toast-${type || 'info'}`;
    el.textContent = message;
    $('#toast-root').appendChild(el);
    setTimeout(() => el.remove(), type === 'error' ? 6000 : 3500);
  }

  /* ---- Modal dialogs --------------------------------------------------- */
  let modalCleanup = null;

  /**
   * Open a modal. Only one modal is open at a time (opening another replaces it).
   * @param {object} o
   * @param {string} o.title
   * @param {string} o.body        HTML
   * @param {Array<{label:string, className?:string, onClick?:(modalEl)=>void|false, submit?:boolean}>} [o.buttons]
   *        onClick returning false keeps the modal open.
   * @param {boolean} [o.wide]
   * @param {(modalEl)=>void} [o.onOpen]  run after the modal is in the DOM (focus fields, bind events)
   * @param {()=>void} [o.onClose]
   * @returns {HTMLElement} the .modal element
   */
  function openModal(o) {
    closeModal();
    const root = $('#modal-root');
    root.innerHTML = `
      <div class="modal-backdrop">
        <div class="modal${o.wide ? ' modal-wide' : ''}" role="dialog" aria-modal="true" aria-labelledby="modal-title">
          <div class="modal-head">
            <h2 id="modal-title">${esc(o.title)}</h2>
            <button type="button" class="modal-close" aria-label="Close" data-modal-close>&times;</button>
          </div>
          <form class="modal-form" novalidate>
            <div class="modal-body">${o.body}</div>
            <div class="modal-foot"></div>
          </form>
        </div>
      </div>`;
    const modalEl = $('.modal', root);
    const form = $('.modal-form', modalEl);
    const foot = $('.modal-foot', modalEl);

    (o.buttons || [{ label: 'Close' }]).forEach((b) => {
      const btn = document.createElement('button');
      btn.type = b.submit ? 'submit' : 'button';
      btn.className = `btn ${b.className || ''}`;
      btn.textContent = b.label;
      if (!b.submit) {
        btn.addEventListener('click', () => {
          const keepOpen = b.onClick ? b.onClick(modalEl) === false : false;
          if (!keepOpen) closeModal();
        });
      } else {
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          const keepOpen = b.onClick ? b.onClick(modalEl) === false : false;
          if (!keepOpen) closeModal();
        });
      }
      foot.appendChild(btn);
    });

    const onKey = (e) => { if (e.key === 'Escape') closeModal(); };
    document.addEventListener('keydown', onKey);
    $('.modal-backdrop', root).addEventListener('click', (e) => { if (e.target.classList.contains('modal-backdrop')) closeModal(); });
    $('[data-modal-close]', root).addEventListener('click', closeModal);
    modalCleanup = () => { document.removeEventListener('keydown', onKey); if (o.onClose) o.onClose(); };

    if (o.onOpen) o.onOpen(modalEl);
    else { const first = $('input, select, textarea, button.btn', modalEl); if (first) first.focus(); }
    return modalEl;
  }

  function closeModal() {
    if (modalCleanup) { const fn = modalCleanup; modalCleanup = null; fn(); }
    $('#modal-root').innerHTML = '';
  }

  /** Yes/no confirmation. Resolves true when confirmed. `typed` requires the user to type that word. */
  function confirmModal({ title, message, confirmLabel, danger, typed }) {
    return new Promise((resolve) => {
      let confirmed = false;
      openModal({
        title,
        body: `<p>${message}</p>${typed ? `<label for="confirm-typed">Type <strong>${esc(typed)}</strong> to confirm</label><input type="text" id="confirm-typed" autocomplete="off">` : ''}`,
        buttons: [
          { label: 'Cancel' },
          {
            label: confirmLabel || 'Confirm', className: danger ? 'btn-danger' : 'btn-primary', submit: true,
            onClick: (m) => {
              if (typed && $('#confirm-typed', m).value.trim() !== typed) { toast(`Please type ${typed} to confirm.`, 'error'); return false; }
              confirmed = true;
            },
          },
        ],
        onClose: () => resolve(confirmed),
      });
    });
  }

  /** Inline error inside the open modal (element with class .modal-error). */
  function modalError(modalEl, message) {
    let el = $('.modal-error', modalEl);
    if (!el) { el = document.createElement('p'); el.className = 'form-error modal-error'; $('.modal-body', modalEl).appendChild(el); }
    el.textContent = message || '';
  }

  /* ---- Downloads --------------------------------------------------------- */
  function downloadText(filename, text, mime) {
    const blob = new Blob([text], { type: mime || 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  /** Build CSV text from an array of objects using the given [header, key] columns. */
  function toCSV(rows, columns) {
    const cell = (v) => { const s = String(v === undefined || v === null ? '' : v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const lines = [columns.map(([h]) => cell(h)).join(',')];
    for (const r of rows) lines.push(columns.map(([, k]) => cell(typeof k === 'function' ? k(r) : r[k])).join(','));
    return lines.join('\r\n');
  }

  /* =========================================================================
   * 2. UI state, views, admin session
   * ======================================================================= */

  const ui = {
    view: 'consumer',           // 'consumer' | 'admin-login' | 'admin'
    adminTab: 'dashboard',
    adminLoggedIn: sessionStorage.getItem('libraryAdminSession') === '1',
    lastActivity: Date.now(),
    consumer: { section: null, query: '', availability: 'all', sort: 'title' },
    collection: { query: '', section: 'all', status: 'all', selected: new Set() },
    loans: { query: '', unit: 'all', overdueOnly: false },
    history: { query: '', unit: 'all', from: '', to: '' },
    labels: { scope: 'unprinted', layout: null, includeTitle: true },
    settingsPopulated: false,
    importPreview: null,        // result of Store.previewImport for the chosen file
    importText: null,
  };

  function showView(view) {
    if (view === 'admin' && !ui.adminLoggedIn) view = 'admin-login';
    ui.view = view;
    $('#view-consumer').classList.toggle('hidden', view !== 'consumer');
    $('#view-admin-login').classList.toggle('hidden', view !== 'admin-login');
    $('#view-admin').classList.toggle('hidden', view !== 'admin');
    $('#nav-consumer').classList.toggle('active', view === 'consumer');
    $('#nav-admin').classList.toggle('active', view !== 'consumer');
    $('#btn-logout').classList.toggle('hidden', !(view === 'admin' && ui.adminLoggedIn));
    render();
    if (view === 'consumer') $('#consumer-scan').focus();
    if (view === 'admin-login') { $('#login-error').textContent = ''; $('#login-password').value = ''; $('#login-password').focus(); }
    if (view === 'admin' && ui.adminTab === 'circulation') $('#admin-scan').focus();
  }

  function showAdminTab(tab) {
    ui.adminTab = tab;
    $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === tab));
    $$('.tab-panel').forEach((p) => p.classList.toggle('hidden', p.id !== `tab-${tab}`));
    render();
    if (tab === 'circulation') $('#admin-scan').focus();
  }

  function login(password) {
    if (!Store.verifyPassword(password)) return false;
    ui.adminLoggedIn = true;
    ui.lastActivity = Date.now();
    sessionStorage.setItem('libraryAdminSession', '1');
    ui.settingsPopulated = false;
    showView('admin');
    return true;
  }

  function logout(reason) {
    ui.adminLoggedIn = false;
    sessionStorage.removeItem('libraryAdminSession');
    closeModal();
    showView('consumer');
    if (reason) toast(reason, 'info');
  }

  /** Auto-logout: checked every 30 s against settings.autoLogoutMinutes. */
  function checkIdleTimeout() {
    const minutes = Store.getState().settings.autoLogoutMinutes;
    if (!ui.adminLoggedIn || !minutes) return;
    if (Date.now() - ui.lastActivity > minutes * 60000) logout('Logged out after inactivity.');
  }

  /* =========================================================================
   * 3. Consumer view
   * ======================================================================= */

  /** Items visible to consumers: everything except withdrawn/lost copies. */
  function consumerVisibleItems() {
    return Store.getState().items.filter((i) => i.status === 'available' || i.status === 'checked_out');
  }

  /** Generic text search used by both consumer and admin lists. */
  function matchesQuery(item, query) {
    if (!query) return true;
    const q = query.toLowerCase();
    const hay = [item.title, item.author, item.section, item.isbn, item.barcode, item.publisher, item.description, item.tags.join(' ')]
      .join(' ').toLowerCase();
    return q.split(/\s+/).every((word) => hay.includes(word));
  }

  function sortItems(items, sort) {
    const byText = (k) => (a, b) => a[k].localeCompare(b[k], undefined, { sensitivity: 'base' }) || a.title.localeCompare(b.title);
    if (sort === 'author') return items.sort(byText('author'));
    if (sort === 'newest') return items.sort((a, b) => b.addedAt.localeCompare(a.addedAt));
    return items.sort(byText('title'));
  }

  function renderConsumer() {
    const state = Store.getState();
    const visible = consumerVisibleItems();

    // Section buttons with counts.
    const counts = {};
    visible.forEach((i) => { counts[i.section] = (counts[i.section] || 0) + 1; });
    const sections = state.settings.sections.slice();
    // Sections that exist on items but were removed from settings still get a button.
    Object.keys(counts).forEach((s) => { if (!sections.includes(s)) sections.push(s); });
    const btn = (label, value, count) =>
      `<button type="button" class="section-btn${ui.consumer.section === value ? ' active' : ''}" data-action="consumer-section" data-section="${esc(value === null ? '' : value)}">
         <span>${esc(label)}</span><span class="count">${count}</span></button>`;
    $('#section-buttons').innerHTML = btn('All sections', null, visible.length) + sections.map((s) => btn(s, s, counts[s] || 0)).join('');

    // Catalog.
    let items = visible.filter((i) => (ui.consumer.section === null || i.section === ui.consumer.section) && matchesQuery(i, ui.consumer.query));
    if (ui.consumer.availability !== 'all') items = items.filter((i) => i.status === ui.consumer.availability);
    items = sortItems(items, ui.consumer.sort);

    $('#consumer-result-count').textContent = items.length === visible.length
      ? `${items.length} item${items.length === 1 ? '' : 's'} in the collection`
      : `${items.length} of ${visible.length} items shown`;

    if (!items.length) {
      $('#consumer-results').innerHTML = `<div class="empty-state">${visible.length ? 'No items match your search.' : 'The catalog is empty. Staff can add items in the Admin view.'}</div>`;
      return;
    }
    $('#consumer-results').innerHTML = items.map((item) => {
      const loan = item.status === 'checked_out' ? Store.activeLoanForItem(item.id) : null;
      const overdue = loan && Store.isOverdue(loan);
      const action = item.status === 'available'
        ? `<button type="button" class="btn btn-primary" data-action="checkout" data-id="${esc(item.id)}">Check out</button>`
        : `<button type="button" class="btn" data-action="return" data-id="${esc(item.id)}">Return</button>`;
      // Consumers see that an item is out and when it is due, never who has it.
      const availability = item.status === 'available'
        ? statusBadge('available')
        : `<span class="badge badge-checked_out">Due ${esc(fmtDate(loan && loan.dueAt))}</span>${overdue ? ' <span class="badge badge-overdue">Overdue</span>' : ''}`;
      return `
        <article class="item-card">
          <div class="title">${esc(item.title)}</div>
          ${item.author ? `<div class="author">${esc(item.author)}</div>` : ''}
          <div class="meta">
            <span>${esc(item.section)}</span><span>${esc(item.format)}</span>
            ${item.year ? `<span>${esc(item.year)}</span>` : ''}${item.location ? `<span>${esc(item.location)}</span>` : ''}
          </div>
          ${item.description ? `<div class="desc">${esc(item.description)}</div>` : ''}
          <div class="card-actions">${availability}${action}</div>
        </article>`;
    }).join('');
  }

  /**
   * A barcode was scanned or typed. Decide what to do with it based on the
   * item's status. `mode` controls how much the dialog shows/allows.
   */
  function handleScan(rawCode, mode) {
    const code = Store.cleanScan(rawCode);
    if (!code) return;
    const item = Store.findByBarcode(code);
    if (!item) { toast(`No item with barcode "${code}".`, 'error'); return; }
    if (item.status === 'available') openCheckoutModal(item, mode);
    else if (item.status === 'checked_out') openReturnModal(item, mode);
    else toast(`"${item.title}" is marked ${statusLabel(item.status).toLowerCase()} and cannot be checked out.`, 'error');
  }

  /* =========================================================================
   * 4. Check-out / return dialogs
   * ======================================================================= */

  function itemSummaryHtml(item) {
    const s = Store.getState().settings;
    return `
      <div class="item-summary">
        ${Barcode.svg(item.barcode, { symbology: s.barcodeSymbology, moduleWidth: 2, height: 40, fontSize: 12 })}
        <div>
          <div class="title">${esc(item.title)}</div>
          <div class="muted">${esc(item.author)}${item.author && item.section ? ' · ' : ''}${esc(item.section)}</div>
        </div>
      </div>`;
  }

  /**
   * Check-out dialog.
   * mode 'consumer': name + unit (+ optional room). Due date is fixed by policy.
   * mode 'admin'   : additionally due date, staff initials, notes, limit override.
   */
  function openCheckoutModal(item, mode) {
    const s = Store.getState().settings;
    const isAdmin = mode === 'admin';
    const defaultDue = Store.util.dueDateFromNow(s.loanPeriodDays);
    const body = `
      ${itemSummaryHtml(item)}
      <div class="form-grid">
        <div class="full">
          <label for="co-name">Your name</label>
          <input type="text" id="co-name" class="big-input" autocomplete="off" required placeholder="First and last name">
        </div>
        <div>
          <label for="co-unit">Unit you are staying on</label>
          <select id="co-unit" class="big-select" required>
            <option value="">Choose a unit...</option>${optionList(s.units)}
          </select>
        </div>
        <div>
          <label for="co-room">Room / bed (optional)</label>
          <input type="text" id="co-room" class="big-input" autocomplete="off">
        </div>
        ${isAdmin ? `
        <div>
          <label for="co-due">Due date</label>
          <input type="date" id="co-due" value="${toDateInputValue(defaultDue)}">
        </div>
        <div>
          <label for="co-staff">Staff initials</label>
          <input type="text" id="co-staff" autocomplete="off" maxlength="10">
        </div>
        <div class="full">
          <label for="co-notes">Notes</label>
          <input type="text" id="co-notes" autocomplete="off">
        </div>
        <div class="full">
          <label class="checkbox-label"><input type="checkbox" id="co-override"> Allow more than ${s.maxLoansPerPatron || 'the usual number of'} items for this patron</label>
        </div>` : `
        <div class="full"><p class="muted">Due back by <strong>${esc(fmtDate(defaultDue))}</strong> (${s.loanPeriodDays} days). Please return it to the library or hand it to staff on your unit.</p></div>`}
      </div>`;

    openModal({
      title: 'Check out',
      body,
      buttons: [
        { label: 'Cancel' },
        {
          label: 'Check out', className: 'btn-primary btn-large', submit: true,
          onClick: (m) => {
            try {
              const loan = Store.checkOut({
                itemId: item.id,
                patronName: $('#co-name', m).value,
                unit: $('#co-unit', m).value,
                roomOrBed: $('#co-room', m).value,
                dueAt: isAdmin ? fromDateInputValue($('#co-due', m).value) : null,
                via: mode,
                staffInitials: isAdmin ? $('#co-staff', m).value : '',
                notes: isAdmin ? $('#co-notes', m).value : '',
                overrideLimit: isAdmin && $('#co-override', m).checked,
              });
              showCheckoutSuccess(loan, mode);
              return false; // success screen replaces the form; keep modal open
            } catch (e) {
              modalError(m, e.message);
              return false;
            }
          },
        },
      ],
      onOpen: (m) => $('#co-name', m).focus(),
      onClose: () => focusScanBox(),
    });
  }

  /** Replace the check-out form with a confirmation; auto-closes on the kiosk. */
  function showCheckoutSuccess(loan, mode) {
    const seconds = 8;
    openModal({
      title: 'Enjoy your book!',
      body: `
        <div class="success-box">
          <p><strong>${esc(loan.titleSnapshot)}</strong> is checked out to <strong>${esc(loan.patronName)}</strong> (${esc(loan.unit)}).</p>
          <p>Please return it by</p>
          <p class="due">${esc(fmtDate(loan.dueAt))}</p>
          ${mode === 'consumer' ? `<p class="muted">This message closes in <span id="co-countdown">${seconds}</span> seconds.</p>` : ''}
        </div>`,
      buttons: [{ label: 'Done', className: 'btn-primary btn-large' }],
      onOpen: (m) => {
        if (mode !== 'consumer') return;
        let left = seconds;
        const t = setInterval(() => {
          left -= 1;
          const el = $('#co-countdown', m);
          if (el) el.textContent = String(left);
          if (left <= 0 || !el) { clearInterval(t); if (el) closeModal(); }
        }, 1000);
      },
      onClose: () => focusScanBox(),
    });
  }

  /**
   * Return dialog.
   * mode 'consumer': simple confirmation (patron identity is not shown).
   * mode 'admin'   : full loan details, condition, notes, renew & mark-lost.
   */
  function openReturnModal(item, mode) {
    const loan = Store.activeLoanForItem(item.id);
    if (!loan) { toast('This item is not checked out.', 'error'); return; }
    const overdue = Store.isOverdue(loan);
    const isAdmin = mode === 'admin';

    const details = isAdmin ? `
      <dl class="detail-list">
        <dt>Checked out to</dt><dd>${esc(loan.patronName)} - ${esc(loan.unit)}${loan.roomOrBed ? `, ${esc(loan.roomOrBed)}` : ''}</dd>
        <dt>Checked out</dt><dd>${esc(fmtDateTime(loan.checkedOutAt))} (${esc(loan.checkedOutVia)}${loan.staffInitials ? `, ${esc(loan.staffInitials)}` : ''})</dd>
        <dt>Due</dt><dd>${esc(fmtDate(loan.dueAt))}${overdue ? ` <span class="badge badge-overdue">${daysBetween(loan.dueAt, new Date())} day(s) overdue</span>` : ''}${loan.renewals ? ` · renewed ${loan.renewals}x` : ''}</dd>
        ${loan.notes ? `<dt>Notes</dt><dd>${esc(loan.notes)}</dd>` : ''}
      </dl>
      <div class="form-grid">
        <div>
          <label for="ri-condition">Condition on return</label>
          <select id="ri-condition">
            <option value="Good">Good</option><option value="Worn">Worn</option>
            <option value="Damaged">Damaged</option><option value="Pages missing">Pages missing</option><option value="Other">Other (see notes)</option>
          </select>
        </div>
        <div>
          <label for="ri-staff">Staff initials</label>
          <input type="text" id="ri-staff" maxlength="10" autocomplete="off">
        </div>
        <div class="full">
          <label for="ri-notes">Notes</label>
          <input type="text" id="ri-notes" autocomplete="off">
        </div>
      </div>` : `
      <p>This item is checked out${overdue ? ' and <strong>overdue</strong>' : ''}, due ${esc(fmtDate(loan.dueAt))}.</p>
      <p>Press <strong>Return</strong> to check it back in. Thank you!</p>`;

    const buttons = [{ label: 'Cancel' }];
    if (isAdmin) {
      buttons.push({
        label: 'Renew', onClick: () => {
          try { Store.renewLoan(loan.id); toast('Loan renewed.', 'success'); } catch (e) { toast(e.message, 'error'); }
        },
      });
      buttons.push({
        label: 'Mark lost', className: 'btn-danger', onClick: (m) => {
          try { Store.setItemStatus(item.id, 'lost', $('#ri-notes', m).value || 'Reported lost at return'); toast('Item marked lost.', 'info'); }
          catch (e) { toast(e.message, 'error'); }
        },
      });
    }
    buttons.push({
      label: 'Return', className: 'btn-primary btn-large', submit: true,
      onClick: (m) => {
        try {
          Store.checkIn({
            itemId: item.id, via: mode,
            condition: isAdmin ? $('#ri-condition', m).value : '',
            notes: isAdmin ? $('#ri-notes', m).value : '',
            staffInitials: isAdmin ? $('#ri-staff', m).value : '',
          });
          toast(`"${item.title}" returned. Thank you!`, 'success');
        } catch (e) { modalError(m, e.message); return false; }
      },
    });

    openModal({ title: 'Return item', body: itemSummaryHtml(item) + details, buttons, onClose: () => focusScanBox() });
  }

  /** After a dialog closes, put the cursor back in the scan box for the next scan. */
  function focusScanBox() {
    const box = ui.view === 'consumer' ? $('#consumer-scan') : (ui.adminTab === 'circulation' ? $('#admin-scan') : null);
    if (box) { box.value = ''; box.focus(); }
  }

  /* =========================================================================
   * 5. Admin
   * ======================================================================= */

  function renderAdmin() {
    const state = Store.getState();
    $('#default-password-warning').classList.toggle('hidden', !state.settings.usingDefaultPassword);
    switch (ui.adminTab) {
      case 'dashboard': renderDashboard(); break;
      case 'collection': renderCollection(); break;
      case 'circulation': renderCirculation(); break;
      case 'labels': renderLabels(); break;
      case 'reports': renderReports(); break;
      case 'settings': renderSettings(); break;
      case 'data': renderData(); break;
      default: break;
    }
  }

  /* ---- 5a. Dashboard ----------------------------------------------------- */
  function renderDashboard() {
    const state = Store.getState();
    const active = Store.activeLoans();
    const overdue = active.filter((l) => Store.isOverdue(l));
    const stats = [
      ['Items in collection', state.items.length],
      ['Available', state.items.filter((i) => i.status === 'available').length],
      ['Checked out', active.length],
      ['Overdue', overdue.length, overdue.length ? 'danger' : ''],
      ['Lost / withdrawn', state.items.filter((i) => i.status === 'lost' || i.status === 'withdrawn').length],
      ['Loans all time', state.loans.length],
      ['Labels to print', state.items.filter((i) => !i.labelPrintedAt && i.status !== 'withdrawn').length],
    ];
    $('#dashboard-stats').innerHTML = stats.map(([label, value, cls]) =>
      `<div class="stat ${cls || ''}"><div class="value">${value}</div><div class="label">${esc(label)}</div></div>`).join('');

    $('#dashboard-overdue').innerHTML = overdue.length ? `<table class="data-table"><thead><tr><th>Title</th><th>Patron</th><th>Unit</th><th>Due</th><th></th></tr></thead><tbody>${
      overdue.sort((a, b) => a.dueAt.localeCompare(b.dueAt)).map((l) => `<tr class="overdue">
        <td>${esc(l.titleSnapshot)}</td><td>${esc(l.patronName)}</td><td>${esc(l.unit)}</td>
        <td>${esc(fmtDate(l.dueAt))} (${daysBetween(l.dueAt, new Date())}d)</td>
        <td class="actions"><button type="button" class="btn btn-small" data-action="return-loan" data-id="${esc(l.id)}">Return</button>
            <button type="button" class="btn btn-small" data-action="renew" data-id="${esc(l.id)}">Renew</button></td></tr>`).join('')
    }</tbody></table>` : '<p class="muted">Nothing is overdue.</p>';

    const recent = state.activityLog.slice(-12).reverse();
    $('#dashboard-activity').innerHTML = recent.length
      ? `<ul class="log-list">${recent.map((e) => `<li><time>${esc(fmtDateTime(e.at))}</time>${esc(e.message)}</li>`).join('')}</ul>`
      : '<p class="muted">No activity yet.</p>';
  }

  /* ---- 5b. Collection ---------------------------------------------------- */
  function collectionFilteredItems() {
    const f = ui.collection;
    let items = Store.getState().items.filter((i) => matchesQuery(i, f.query));
    if (f.section !== 'all') items = items.filter((i) => i.section === f.section);
    if (f.status !== 'all') items = items.filter((i) => i.status === f.status);
    return sortItems(items, 'title');
  }

  function renderCollection() {
    const state = Store.getState();
    const sectionFilter = $('#admin-section-filter');
    const allSections = Array.from(new Set([...state.settings.sections, ...state.items.map((i) => i.section)]));
    sectionFilter.innerHTML = `<option value="all">All sections</option>${optionList(allSections, ui.collection.section)}`;
    sectionFilter.value = allSections.includes(ui.collection.section) ? ui.collection.section : 'all';

    const items = collectionFilteredItems();
    const sel = ui.collection.selected;
    // Drop selections for items that no longer exist.
    for (const id of Array.from(sel)) if (!Store.getItem(id)) sel.delete(id);

    $('#admin-items-table tbody').innerHTML = items.length ? items.map((item) => {
      const loan = item.status === 'checked_out' ? Store.activeLoanForItem(item.id) : null;
      const circ = item.status === 'available'
        ? `<button type="button" class="btn btn-small" data-action="checkout-admin" data-id="${esc(item.id)}">Check out</button>`
        : item.status === 'checked_out' ? `<button type="button" class="btn btn-small" data-action="return-admin" data-id="${esc(item.id)}">Return</button>` : '';
      return `<tr${loan && Store.isOverdue(loan) ? ' class="overdue"' : ''}>
        <td><input type="checkbox" data-select-id="${esc(item.id)}"${sel.has(item.id) ? ' checked' : ''} aria-label="Select"></td>
        <td class="mono">${esc(item.barcode)}</td>
        <td><strong>${esc(item.title)}</strong>${item.isbn ? `<br><span class="muted mono">${esc(item.isbn)}</span>` : ''}</td>
        <td>${esc(item.author)}</td>
        <td>${esc(item.section)}</td>
        <td>${esc(item.format)}</td>
        <td>${statusBadge(item.status)}${loan ? `<br><span class="muted">${esc(loan.patronName)} · ${esc(loan.unit)}<br>due ${esc(fmtDate(loan.dueAt))}</span>` : ''}</td>
        <td>${item.labelPrintedAt ? `<span title="${esc(fmtDateTime(item.labelPrintedAt))}">&#10003;</span>` : '<span class="muted">not printed</span>'}</td>
        <td class="actions">
          <button type="button" class="btn btn-small" data-action="edit" data-id="${esc(item.id)}">Edit</button>
          ${circ}
          <button type="button" class="btn btn-small" data-action="label-one" data-id="${esc(item.id)}" title="Print one label">Label</button>
        </td></tr>`;
    }).join('') : `<tr><td colspan="9" class="empty-state">${state.items.length ? 'No items match the filters.' : 'No items yet. Click "+ Add item" or "Bulk add".'}</td></tr>`;

    $('#admin-items-count').textContent = `${items.length} of ${state.items.length} items shown`;
    $('#admin-selection-count').textContent = sel.size ? `${sel.size} selected` : '';
    $('#btn-print-selected').disabled = sel.size === 0;
    $('#btn-export-selected-csv').disabled = sel.size === 0;
    $('#admin-select-all').checked = items.length > 0 && items.every((i) => sel.has(i.id));
  }

  /** Add / edit item dialog. `item` undefined = add. */
  function openItemForm(item) {
    const s = Store.getState().settings;
    const isEdit = Boolean(item);
    const v = item || { title: '', author: '', section: s.sections[0], format: s.formats[0], isbn: '', year: '', publisher: '', location: '', tags: [], description: '', condition: '', notes: '', barcode: '' };
    const sections = Array.from(new Set([...s.sections, v.section].filter(Boolean)));
    const formats = Array.from(new Set([...s.formats, v.format].filter(Boolean)));
    const body = `
      <div class="form-grid">
        <div class="full"><label for="if-title">Title *</label><input type="text" id="if-title" value="${esc(v.title)}" required></div>
        <div class="full"><label for="if-author">Author</label><input type="text" id="if-author" value="${esc(v.author)}"></div>
        <div><label for="if-section">Section</label><select id="if-section">${optionList(sections, v.section)}</select></div>
        <div><label for="if-format">Format</label><select id="if-format">${optionList(formats, v.format)}</select></div>
        <div><label for="if-isbn">ISBN</label><input type="text" id="if-isbn" value="${esc(v.isbn)}"></div>
        <div><label for="if-year">Year</label><input type="text" id="if-year" value="${esc(v.year)}"></div>
        <div><label for="if-publisher">Publisher</label><input type="text" id="if-publisher" value="${esc(v.publisher)}"></div>
        <div><label for="if-location">Shelf / location</label><input type="text" id="if-location" value="${esc(v.location)}"></div>
        <div class="full"><label for="if-tags">Subjects / tags (comma separated)</label><input type="text" id="if-tags" value="${esc(v.tags.join(', '))}"></div>
        <div class="full"><label for="if-description">Description</label><textarea id="if-description" rows="3">${esc(v.description)}</textarea></div>
        <div><label for="if-condition">Condition</label><input type="text" id="if-condition" value="${esc(v.condition)}"></div>
        <div><label for="if-barcode">Barcode</label>
          <input type="text" id="if-barcode" value="${esc(v.barcode)}" placeholder="${isEdit ? '' : `Leave blank to generate ${esc(Store.peekNextBarcode())}`}" autocomplete="off">
        </div>
        <div class="full"><label for="if-notes">Staff notes (not shown to consumers)</label><textarea id="if-notes" rows="2">${esc(v.notes)}</textarea></div>
        ${isEdit ? `<div class="full">
          <p class="muted">Status: ${statusBadge(item.status)} · added ${esc(fmtDate(item.addedAt))} · label ${item.labelPrintedAt ? `printed ${esc(fmtDate(item.labelPrintedAt))}` : 'not printed'}</p>
          <div class="form-actions">
            ${item.status === 'available' ? `<button type="button" class="btn btn-small" data-action="status" data-status="lost" data-id="${esc(item.id)}">Mark lost</button>
            <button type="button" class="btn btn-small" data-action="status" data-status="withdrawn" data-id="${esc(item.id)}">Withdraw from collection</button>` : ''}
            ${item.status === 'lost' || item.status === 'withdrawn' ? `<button type="button" class="btn btn-small" data-action="status" data-status="available" data-id="${esc(item.id)}">Return to collection</button>` : ''}
            <button type="button" class="btn btn-small btn-danger" data-action="delete" data-id="${esc(item.id)}">Delete permanently</button>
          </div></div>` : ''}
      </div>`;

    openModal({
      title: isEdit ? 'Edit item' : 'Add item',
      wide: true,
      body,
      buttons: [
        { label: 'Cancel' },
        {
          label: isEdit ? 'Save changes' : 'Add item', className: 'btn-primary', submit: true,
          onClick: (m) => {
            const fields = {
              title: $('#if-title', m).value, author: $('#if-author', m).value, section: $('#if-section', m).value,
              format: $('#if-format', m).value, isbn: $('#if-isbn', m).value, year: $('#if-year', m).value,
              publisher: $('#if-publisher', m).value, location: $('#if-location', m).value,
              tags: $('#if-tags', m).value.split(',').map((t) => t.trim()).filter(Boolean),
              description: $('#if-description', m).value, condition: $('#if-condition', m).value,
              notes: $('#if-notes', m).value, barcode: $('#if-barcode', m).value.trim(),
            };
            try {
              if (isEdit) { Store.updateItem(item.id, fields); toast('Item saved.', 'success'); }
              else { const created = Store.addItem(fields); toast(`Added "${created.title}" with barcode ${created.barcode}.`, 'success'); }
            } catch (e) { modalError(m, e.message); return false; }
          },
        },
      ],
      onOpen: (m) => $('#if-title', m).focus(),
    });
  }

  /** Paste-many dialog: one item per line, fields separated by " | ". */
  function openBulkAdd() {
    const s = Store.getState().settings;
    openModal({
      title: 'Bulk add items',
      wide: true,
      body: `
        <p class="muted">One item per line: <code>Title | Author | Section | Format | ISBN</code>.
           Only the title is required. Unknown sections are kept as typed. Barcodes are generated automatically.</p>
        <textarea id="bulk-text" rows="12" placeholder="The Alchemist | Paulo Coelho | Fiction | Paperback | 9780062315007
Feeling Good | David D. Burns | Self-Help &amp; Recovery"></textarea>
        <p id="bulk-preview" class="muted"></p>`,
      buttons: [
        { label: 'Cancel' },
        {
          label: 'Add items', className: 'btn-primary', submit: true,
          onClick: (m) => {
            const rows = parseBulk($('#bulk-text', m).value, s);
            if (!rows.length) { modalError(m, 'Nothing to add - enter at least one title.'); return false; }
            try { const created = Store.addItems(rows); toast(`Added ${created.length} item(s).`, 'success'); }
            catch (e) { modalError(m, e.message); return false; }
          },
        },
      ],
      onOpen: (m) => {
        const ta = $('#bulk-text', m);
        ta.addEventListener('input', () => { $('#bulk-preview', m).textContent = `${parseBulk(ta.value, s).length} item(s) will be added.`; });
        ta.focus();
      },
    });
  }
  function parseBulk(text, settings) {
    return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
      const [title, author, section, format, isbn] = line.split('|').map((p) => (p || '').trim());
      return { title, author, section: section || settings.sections[0], format: format || settings.formats[0], isbn };
    }).filter((r) => r.title);
  }

  /* ---- 5c. Circulation --------------------------------------------------- */
  function renderCirculation() {
    const state = Store.getState();
    const units = Array.from(new Set([...state.settings.units, ...state.loans.map((l) => l.unit)]));
    for (const [selId, key] of [['#loans-unit-filter', 'loans'], ['#history-unit-filter', 'history']]) {
      const sel = $(selId);
      sel.innerHTML = `<option value="all">All units</option>${optionList(units, ui[key].unit)}`;
      sel.value = units.includes(ui[key].unit) ? ui[key].unit : 'all';
    }

    // Active loans.
    const lf = ui.loans;
    let active = Store.activeLoans().filter((l) => loanMatches(l, lf.query) && (lf.unit === 'all' || l.unit === lf.unit));
    if (lf.overdueOnly) active = active.filter((l) => Store.isOverdue(l));
    active.sort((a, b) => a.dueAt.localeCompare(b.dueAt));
    $('#active-loan-count').textContent = String(Store.activeLoans().length);
    $('#active-loans-table tbody').innerHTML = active.length ? active.map((l) => {
      const overdue = Store.isOverdue(l);
      return `<tr${overdue ? ' class="overdue"' : ''}>
        <td><strong>${esc(l.titleSnapshot)}</strong></td><td class="mono">${esc(l.barcode)}</td>
        <td>${esc(l.patronName)}</td><td>${esc(l.unit)}</td><td>${esc(l.roomOrBed)}</td>
        <td>${esc(fmtDateTime(l.checkedOutAt))}</td>
        <td>${esc(fmtDate(l.dueAt))}${overdue ? ` <span class="badge badge-overdue">${daysBetween(l.dueAt, new Date())}d</span>` : ''}${l.renewals ? `<br><span class="muted">renewed ${l.renewals}x</span>` : ''}</td>
        <td>${esc(l.checkedOutVia)}${l.staffInitials ? ` (${esc(l.staffInitials)})` : ''}</td>
        <td class="actions">
          <button type="button" class="btn btn-small btn-primary" data-action="return-loan" data-id="${esc(l.id)}">Return</button>
          <button type="button" class="btn btn-small" data-action="renew" data-id="${esc(l.id)}">Renew</button>
        </td></tr>`;
    }).join('') : '<tr><td colspan="9" class="empty-state">No active loans match.</td></tr>';

    // History (every loan, newest first).
    const rows = historyFilteredLoans();
    $('#history-table tbody').innerHTML = rows.length ? rows.slice(0, 500).map((l) => `<tr>
        <td>${esc(l.titleSnapshot)}</td><td class="mono">${esc(l.barcode)}</td>
        <td>${esc(l.patronName)}</td><td>${esc(l.unit)}</td>
        <td>${esc(fmtDateTime(l.checkedOutAt))}</td><td>${esc(fmtDate(l.dueAt))}</td>
        <td>${l.returnedAt ? esc(fmtDateTime(l.returnedAt)) : '<span class="badge badge-checked_out">out</span>'}</td>
        <td>${esc(l.outcome || 'active')}</td>
        <td>${esc([l.returnCondition, l.notes].filter(Boolean).join(' - '))}</td></tr>`).join('')
      : '<tr><td colspan="9" class="empty-state">No loans match.</td></tr>';
    $('#history-count').textContent = `${rows.length} loan record(s)${rows.length > 500 ? ' (first 500 shown; export CSV for all)' : ''}`;
  }

  function loanMatches(loan, query) {
    if (!query) return true;
    const hay = `${loan.titleSnapshot} ${loan.patronName} ${loan.barcode} ${loan.unit} ${loan.roomOrBed} ${loan.notes}`.toLowerCase();
    return query.toLowerCase().split(/\s+/).every((w) => hay.includes(w));
  }

  function historyFilteredLoans() {
    const h = ui.history;
    const from = h.from ? new Date(h.from) : null;
    const to = h.to ? new Date(`${h.to}T23:59:59.999`) : null;
    return Store.getState().loans
      .filter((l) => loanMatches(l, h.query) && (h.unit === 'all' || l.unit === h.unit))
      .filter((l) => (!from || new Date(l.checkedOutAt) >= from) && (!to || new Date(l.checkedOutAt) <= to))
      .sort((a, b) => b.checkedOutAt.localeCompare(a.checkedOutAt));
  }

  const LOAN_CSV_COLUMNS = [
    ['Title', 'titleSnapshot'], ['Barcode', 'barcode'], ['Patron', 'patronName'], ['Unit', 'unit'], ['Room/Bed', 'roomOrBed'],
    ['Checked out', 'checkedOutAt'], ['Due', 'dueAt'], ['Returned', 'returnedAt'], ['Outcome', (l) => l.outcome || 'active'],
    ['Checked out via', 'checkedOutVia'], ['Returned via', 'returnedVia'], ['Staff', 'staffInitials'], ['Renewals', 'renewals'],
    ['Condition', 'returnCondition'], ['Notes', 'notes'],
  ];
  const ITEM_CSV_COLUMNS = [
    ['Barcode', 'barcode'], ['Title', 'title'], ['Author', 'author'], ['Section', 'section'], ['Format', 'format'], ['ISBN', 'isbn'],
    ['Year', 'year'], ['Publisher', 'publisher'], ['Location', 'location'], ['Tags', (i) => i.tags.join('; ')], ['Status', 'status'],
    ['Condition', 'condition'], ['Notes', 'notes'], ['Added', 'addedAt'], ['Label printed', 'labelPrintedAt'],
  ];

  /* ---- 5d. Labels -------------------------------------------------------- */
  function labelItems() {
    const state = Store.getState();
    switch (ui.labels.scope) {
      case 'selected': return state.items.filter((i) => ui.collection.selected.has(i.id));
      case 'all': return state.items.filter((i) => i.status !== 'withdrawn');
      default: return state.items.filter((i) => !i.labelPrintedAt && i.status !== 'withdrawn');
    }
  }

  function labelHtml(item, settings, includeTitle) {
    const svg = Barcode.svg(item.barcode, { symbology: settings.barcodeSymbology, moduleWidth: settings.barcodeModuleWidth, height: 50, fontSize: 13 });
    return `<div class="label${includeTitle ? '' : ' no-title'}">
      ${includeTitle ? `<div class="label-title">${esc(item.title)}</div>` : ''}
      ${svg}
      ${includeTitle ? `<div class="label-sub">${esc(item.section)}${item.author ? ` · ${esc(item.author)}` : ''}</div>` : ''}
    </div>`;
  }

  function renderLabels() {
    const s = Store.getState().settings;
    if (!ui.labels.layout) ui.labels.layout = s.labelLayout;
    $('#labels-scope').value = ui.labels.scope;
    $('#labels-layout').value = ui.labels.layout;
    $('#labels-include-title').checked = ui.labels.includeTitle;
    const items = labelItems();
    $('#labels-count').textContent = `${items.length} label(s) to print${items.length > 12 ? ' (preview shows the first 12)' : ''}`;
    $('#labels-preview').innerHTML = `<div class="label-${esc(ui.labels.layout)}" style="display:contents">${items.slice(0, 12).map((i) => labelHtml(i, s, ui.labels.includeTitle)).join('')}</div>`;
  }

  /**
   * Print labels for `items`: fill #print-area, set the @page size for the
   * layout, call window.print(), then ask whether to mark them as printed.
   */
  function printLabels(items, layout) {
    if (!items.length) { toast('There are no labels to print.', 'error'); return; }
    const s = Store.getState().settings;
    const includeTitle = ui.labels.includeTitle;
    const perPage = { sheet30: 30, sheet10: 10, roll: 1 }[layout] || 30;
    const pages = [];
    for (let i = 0; i < items.length; i += perPage) {
      pages.push(`<div class="label-${layout}">${items.slice(i, i + perPage).map((it) => labelHtml(it, s, includeTitle)).join('')}</div>`);
    }
    $('#print-area').innerHTML = pages.join('');

    // Page size per layout; the roll size must match the printer's label stock.
    let pageStyle = $('#print-page-style');
    if (!pageStyle) { pageStyle = document.createElement('style'); pageStyle.id = 'print-page-style'; document.head.appendChild(pageStyle); }
    pageStyle.textContent = layout === 'roll'
      ? '@media print { @page { size: 2.25in 1.25in; margin: 0; } }'
      : '@media print { @page { size: letter portrait; margin: 0; } }';

    window.print();

    // print() blocks in most browsers until the dialog closes; afterwards confirm.
    setTimeout(() => {
      confirmModal({ title: 'Labels printed?', message: `Mark these ${items.length} item(s) as having a printed label? (Choose "No" if the print failed and you want them to stay in the "not printed" list.)`, confirmLabel: 'Yes, mark as printed' })
        .then((yes) => { if (yes) Store.markLabelsPrinted(items.map((i) => i.id)); $('#print-area').innerHTML = ''; });
    }, 300);
  }

  /* ---- 5e. Reports ------------------------------------------------------- */
  function renderReports() {
    const state = Store.getState();
    const units = Store.loansByUnit();
    const maxUnit = Math.max(1, ...units.map((u) => u.total));
    $('#report-units').innerHTML = units.length ? units.map((u) => `
      <div class="bar-row"><span>${esc(u.unit)}</span>
        <div class="bar-track"><div class="bar-fill${u.overdue ? ' danger' : ''}" style="width:${(u.total / maxUnit) * 100}%"></div></div>
        <span>${u.total} total · ${u.active} out${u.overdue ? ` · <strong>${u.overdue} overdue</strong>` : ''}</span></div>`).join('')
      : '<p class="muted">No loans yet.</p>';

    const sections = Store.itemsBySection().filter((r) => r.total);
    $('#report-sections').innerHTML = sections.length ? `<table class="data-table"><thead><tr><th>Section</th><th>Items</th><th>Available</th><th>Out</th><th>Lost/withdrawn</th></tr></thead><tbody>${
      sections.map((r) => `<tr><td>${esc(r.section)}</td><td>${r.total}</td><td>${r.available}</td><td>${r.checkedOut}</td><td>${r.other}</td></tr>`).join('')}</tbody></table>`
      : '<p class="muted">The collection is empty.</p>';

    const popular = Store.mostBorrowed(10);
    $('#report-popular').innerHTML = popular.length ? `<ol>${popular.map((p) => `<li>${esc(p.title)} <span class="muted">(${p.count} loan${p.count === 1 ? '' : 's'})</span></li>`).join('')}</ol>`
      : '<p class="muted">No loans yet.</p>';

    const log = state.activityLog.slice(-200).reverse();
    $('#report-activity').innerHTML = log.length ? `<ul class="log-list">${log.map((e) => `<li><time>${esc(fmtDateTime(e.at))}</time><span class="muted">[${esc(e.type)}]</span> ${esc(e.message)}</li>`).join('')}</ul>`
      : '<p class="muted">No activity yet.</p>';
  }

  /* ---- 5f. Settings ------------------------------------------------------ */
  /** Populate the settings form from state (only when first shown, so typing is not clobbered). */
  function renderSettings() {
    const s = Store.getState().settings;
    $('#set-next-barcode').textContent = Store.peekNextBarcode();
    if (ui.settingsPopulated) return;
    $('#set-library-name').value = s.libraryName;
    $('#set-loan-period').value = s.loanPeriodDays;
    $('#set-max-loans').value = s.maxLoansPerPatron;
    $('#set-auto-logout').value = s.autoLogoutMinutes;
    $('#set-barcode-prefix').value = s.barcodePrefix;
    $('#set-barcode-digits').value = s.barcodeDigits;
    $('#set-barcode-symbology').value = s.barcodeSymbology;
    $('#set-barcode-width').value = s.barcodeModuleWidth;
    $('#set-sections').value = s.sections.join('\n');
    $('#set-units').value = s.units.join('\n');
    $('#set-formats').value = s.formats.join('\n');
    ui.settingsPopulated = true;
  }

  function saveSettings() {
    const lines = (id) => $(id).value.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const sections = lines('#set-sections'), units = lines('#set-units'), formats = lines('#set-formats');
    if (!sections.length || !units.length || !formats.length) { toast('Sections, units and formats each need at least one entry.', 'error'); return; }
    const prefix = $('#set-barcode-prefix').value.trim().toUpperCase();
    const symbology = $('#set-barcode-symbology').value;
    if (prefix && !Barcode.isEncodable(prefix, symbology)) { toast('The barcode prefix contains characters that symbology cannot print.', 'error'); return; }
    Store.updateSettings({
      libraryName: $('#set-library-name').value,
      loanPeriodDays: Number($('#set-loan-period').value),
      maxLoansPerPatron: Number($('#set-max-loans').value),
      autoLogoutMinutes: Number($('#set-auto-logout').value),
      barcodePrefix: prefix,
      barcodeDigits: Number($('#set-barcode-digits').value),
      barcodeSymbology: symbology,
      barcodeModuleWidth: Number($('#set-barcode-width').value),
      sections, units, formats,
    });
    ui.settingsPopulated = false;
    renderSettings();
    $('#settings-saved').textContent = `Saved ${new Date().toLocaleTimeString()}`;
    toast('Settings saved.', 'success');
  }

  function changePassword() {
    const current = $('#pw-current').value, next = $('#pw-new').value, confirm = $('#pw-confirm').value;
    const err = $('#pw-error');
    err.textContent = '';
    if (!Store.verifyPassword(current)) { err.textContent = 'Current password is incorrect.'; return; }
    if (next.length < 4) { err.textContent = 'New password must be at least 4 characters.'; return; }
    if (next !== confirm) { err.textContent = 'New passwords do not match.'; return; }
    Store.setPassword(next);
    $('#password-form').reset();
    toast('Password changed.', 'success');
  }

  /* ---- 5g. Data ---------------------------------------------------------- */
  function renderData() {
    $('#storage-key').textContent = Store.STORAGE_KEY;
    const bytes = Store.exportJSON().length;
    $('#storage-size').textContent = bytes > 1048576 ? `${(bytes / 1048576).toFixed(2)} MB` : `${Math.ceil(bytes / 1024)} KB`;
    $('#btn-load-sample').disabled = !window.SampleData;
    renderImportPreview();
  }

  function renderImportPreview() {
    const box = $('#import-preview');
    const p = ui.importPreview;
    if (!p) { box.classList.add('hidden'); $('#btn-import-apply').disabled = true; return; }
    box.classList.remove('hidden');
    if (!p.ok) {
      box.innerHTML = `<strong>Cannot import:</strong><ul>${p.errors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>`;
      $('#btn-import-apply').disabled = true;
      return;
    }
    const s = p.summary;
    box.innerHTML = `<strong>${esc(s.libraryName)}</strong>${s.exportedAt ? ` - exported ${esc(fmtDateTime(s.exportedAt))}` : ''}
      <ul><li>${s.items} item(s)</li><li>${s.loans} loan record(s), ${s.activeLoans} active</li><li>${s.logEntries} activity log entries</li></ul>
      ${p.warnings.length ? `<p><strong>Warnings:</strong></p><ul>${p.warnings.slice(0, 20).map((w) => `<li>${esc(w)}</li>`).join('')}${p.warnings.length > 20 ? `<li>...and ${p.warnings.length - 20} more</li>` : ''}</ul>` : ''}`;
    $('#btn-import-apply').disabled = false;
  }

  function readImportFile(file) {
    if (!file) { ui.importPreview = null; ui.importText = null; renderImportPreview(); return; }
    const reader = new FileReader();
    reader.onload = () => { ui.importText = String(reader.result); ui.importPreview = Store.previewImport(ui.importText); renderImportPreview(); };
    reader.onerror = () => toast('Could not read the file.', 'error');
    reader.readAsText(file);
  }

  async function applyImport() {
    if (!ui.importPreview || !ui.importPreview.ok) return;
    const mode = $('input[name="import-mode"]:checked').value;
    const s = ui.importPreview.summary;
    const ok = await confirmModal({
      title: mode === 'replace' ? 'Replace the whole library?' : 'Merge into this library?',
      message: mode === 'replace'
        ? `Everything currently in this browser will be replaced by the file (${s.items} items, ${s.loans} loans). This cannot be undone - export a backup first if unsure.`
        : `${s.items} item(s) and ${s.loans} loan record(s) will be added or updated. Settings on this computer are kept.`,
      confirmLabel: mode === 'replace' ? 'Replace' : 'Merge', danger: mode === 'replace',
    });
    if (!ok) return;
    try {
      const result = Store.importJSON(ui.importText, mode);
      ui.importPreview = null; ui.importText = null; ui.settingsPopulated = false; ui.labels.layout = null;
      $('#import-file').value = '';
      toast(mode === 'replace' ? 'Library replaced from file.' : `Merged: ${result.added} added, ${result.updated} updated.`, 'success');
      if (result.warnings.length) toast(`${result.warnings.length} warning(s) - see the activity log.`, 'info');
      render();
    } catch (e) { toast(e.message, 'error'); }
  }

  /* =========================================================================
   * 6. Rendering entry point, delegated actions, start-up
   * ======================================================================= */

  function render() {
    const state = Store.getState();
    $('#library-name').textContent = state.settings.libraryName;
    document.title = state.settings.libraryName;
    $('#footer-counts').textContent = `${state.items.length} items · ${Store.activeLoans().length} checked out`;
    const saveErr = Store.getLastSaveError();
    const ind = $('#save-indicator');
    ind.textContent = saveErr ? 'NOT SAVED' : `Saved ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
    ind.classList.toggle('error', Boolean(saveErr));
    $('#storage-warning').classList.toggle('hidden', !saveErr);
    if (saveErr) $('#storage-warning').textContent = `Warning: changes could not be saved in this browser (${saveErr.message}). Export a JSON backup from Admin > Data before closing this page.`;

    if (ui.view === 'consumer') renderConsumer();
    else if (ui.view === 'admin') renderAdmin();
  }

  /** One click handler for every element with data-action (works after re-render). */
  async function handleAction(el) {
    const { action, id } = el.dataset;
    const item = id ? Store.getItem(id) : null;
    switch (action) {
      case 'consumer-section':
        ui.consumer.section = el.dataset.section || null;
        renderConsumer();
        break;
      case 'checkout': if (item) openCheckoutModal(item, 'consumer'); break;
      case 'return': if (item) openReturnModal(item, 'consumer'); break;
      case 'checkout-admin': if (item) openCheckoutModal(item, 'admin'); break;
      case 'return-admin': if (item) openReturnModal(item, 'admin'); break;
      case 'edit': if (item) openItemForm(item); break;
      case 'label-one': if (item) printLabels([item], ui.labels.layout || Store.getState().settings.labelLayout); break;
      case 'status': {
        if (!item) break;
        const status = el.dataset.status;
        const ok = await confirmModal({ title: `Mark "${item.title}" as ${statusLabel(status).toLowerCase()}?`, message: status === 'available' ? 'The item will become available for check-out again.' : 'The item will no longer appear in the consumer catalog.', confirmLabel: 'Yes', danger: status !== 'available' });
        if (ok) { try { Store.setItemStatus(id, status); toast('Status updated.', 'success'); } catch (e) { toast(e.message, 'error'); } }
        break;
      }
      case 'delete': {
        if (!item) break;
        const ok = await confirmModal({ title: 'Delete item permanently?', message: `"${esc(item.title)}" (${esc(item.barcode)}) will be removed from the collection. Its loan history is kept. Consider "Withdraw" instead if you may want the record back.`, confirmLabel: 'Delete', danger: true });
        if (ok) { try { Store.removeItem(id); toast('Item deleted.', 'info'); } catch (e) { toast(e.message, 'error'); } }
        break;
      }
      case 'return-loan': {
        const loan = Store.getState().loans.find((l) => l.id === id);
        const loanItem = loan && Store.getItem(loan.itemId);
        if (loanItem) openReturnModal(loanItem, 'admin');
        else if (loan) { Store.checkIn({ loanId: loan.id, via: 'admin', notes: 'Closed from loan list (item record missing)' }); toast('Loan closed.', 'info'); }
        break;
      }
      case 'renew':
        try { const loan = Store.renewLoan(id); toast(`Renewed; now due ${fmtDate(loan.dueAt)}.`, 'success'); } catch (e) { toast(e.message, 'error'); }
        break;
      default: break;
    }
  }

  function bindEvents() {
    // Header navigation.
    $$('[data-view]').forEach((b) => b.addEventListener('click', () => showView(b.dataset.view)));
    $('#btn-logout').addEventListener('click', () => logout('Logged out.'));
    $$('.tab').forEach((t) => t.addEventListener('click', () => showAdminTab(t.dataset.tab)));

    // Delegated data-action clicks (cards, table buttons, modal buttons with actions).
    document.addEventListener('click', (e) => {
      const el = e.target.closest('[data-action]');
      if (el) handleAction(el);
    });

    // Track activity for the admin idle timeout.
    ['click', 'keydown', 'mousemove', 'touchstart'].forEach((ev) => document.addEventListener(ev, () => { ui.lastActivity = Date.now(); }, { passive: true }));
    setInterval(checkIdleTimeout, 30000);

    // Login.
    $('#login-form').addEventListener('submit', (e) => {
      e.preventDefault();
      if (!login($('#login-password').value)) { $('#login-error').textContent = 'Incorrect password.'; $('#login-password').select(); }
    });

    // Consumer controls.
    $('#consumer-scan').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); handleScan(e.target.value, 'consumer'); e.target.value = ''; } });
    $('#consumer-search').addEventListener('input', (e) => { ui.consumer.query = e.target.value.trim(); renderConsumer(); });
    $('#consumer-availability').addEventListener('change', (e) => { ui.consumer.availability = e.target.value; renderConsumer(); });
    $('#consumer-sort').addEventListener('change', (e) => { ui.consumer.sort = e.target.value; renderConsumer(); });
    // Kiosk convenience: if a scanner "types" while nothing is focused, send keys to the scan box.
    document.addEventListener('keydown', (e) => {
      if (ui.view !== 'consumer' || $('#modal-root').children.length) return;
      const tag = (document.activeElement && document.activeElement.tagName) || '';
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) return;
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) $('#consumer-scan').focus();
    });

    // Admin: collection.
    $('#admin-search').addEventListener('input', (e) => { ui.collection.query = e.target.value.trim(); renderCollection(); });
    $('#admin-section-filter').addEventListener('change', (e) => { ui.collection.section = e.target.value; renderCollection(); });
    $('#admin-status-filter').addEventListener('change', (e) => { ui.collection.status = e.target.value; renderCollection(); });
    $('#btn-add-item').addEventListener('click', () => openItemForm());
    $('#btn-bulk-add').addEventListener('click', openBulkAdd);
    $('#admin-items-table').addEventListener('change', (e) => {
      const cb = e.target.closest('[data-select-id]');
      if (!cb) return;
      if (cb.checked) ui.collection.selected.add(cb.dataset.selectId); else ui.collection.selected.delete(cb.dataset.selectId);
      renderCollection();
    });
    $('#admin-select-all').addEventListener('change', (e) => {
      const shown = collectionFilteredItems();
      shown.forEach((i) => { if (e.target.checked) ui.collection.selected.add(i.id); else ui.collection.selected.delete(i.id); });
      renderCollection();
    });
    $('#btn-print-selected').addEventListener('click', () => { ui.labels.scope = 'selected'; showAdminTab('labels'); });
    $('#btn-export-selected-csv').addEventListener('click', () => {
      const items = Store.getState().items.filter((i) => ui.collection.selected.has(i.id));
      downloadText(`library-items-${toDateInputValue(new Date())}.csv`, toCSV(items, ITEM_CSV_COLUMNS), 'text/csv');
    });

    // Admin: circulation.
    $('#admin-scan').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); handleScan(e.target.value, 'admin'); e.target.value = ''; } });
    $('#loans-search').addEventListener('input', (e) => { ui.loans.query = e.target.value.trim(); renderCirculation(); });
    $('#loans-unit-filter').addEventListener('change', (e) => { ui.loans.unit = e.target.value; renderCirculation(); });
    $('#loans-overdue-only').addEventListener('change', (e) => { ui.loans.overdueOnly = e.target.checked; renderCirculation(); });
    $('#history-search').addEventListener('input', (e) => { ui.history.query = e.target.value.trim(); renderCirculation(); });
    $('#history-unit-filter').addEventListener('change', (e) => { ui.history.unit = e.target.value; renderCirculation(); });
    $('#history-from').addEventListener('change', (e) => { ui.history.from = e.target.value; renderCirculation(); });
    $('#history-to').addEventListener('change', (e) => { ui.history.to = e.target.value; renderCirculation(); });
    $('#btn-export-loans-csv').addEventListener('click', () => {
      downloadText(`library-loans-${toDateInputValue(new Date())}.csv`, toCSV(historyFilteredLoans(), LOAN_CSV_COLUMNS), 'text/csv');
    });

    // Admin: labels.
    $('#labels-scope').addEventListener('change', (e) => { ui.labels.scope = e.target.value; renderLabels(); });
    $('#labels-layout').addEventListener('change', (e) => { ui.labels.layout = e.target.value; Store.updateSettings({ labelLayout: e.target.value }); });
    $('#labels-include-title').addEventListener('change', (e) => { ui.labels.includeTitle = e.target.checked; renderLabels(); });
    $('#btn-print-labels').addEventListener('click', () => printLabels(labelItems(), ui.labels.layout));

    // Admin: settings.
    $('#settings-form').addEventListener('submit', (e) => { e.preventDefault(); saveSettings(); });
    $('#password-form').addEventListener('submit', (e) => { e.preventDefault(); changePassword(); });

    // Admin: data.
    $('#btn-export-json').addEventListener('click', () => {
      downloadText(Store.exportFileName(), Store.exportJSON(), 'application/json');
      $('#export-status').textContent = `Exported ${new Date().toLocaleString()}`;
    });
    $('#btn-copy-json').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(Store.exportJSON()); toast('JSON copied to clipboard.', 'success'); }
      catch (e) { toast('Clipboard not available here - use Download instead.', 'error'); }
    });
    $('#import-file').addEventListener('change', (e) => readImportFile(e.target.files[0]));
    $('#btn-import-apply').addEventListener('click', applyImport);
    $('#btn-load-sample').addEventListener('click', async () => {
      if (!window.SampleData) { toast('Sample data is not available (js/sample-data.js missing).', 'error'); return; }
      const ok = await confirmModal({ title: 'Load sample data?', message: 'Example items and loans will be merged into this library so you can explore the features. Delete them afterwards or use "Erase everything".', confirmLabel: 'Load' });
      if (!ok) return;
      try { const r = Store.importJSON(JSON.stringify(window.SampleData), 'merge'); toast(`Sample data loaded: ${r.added} item(s) added.`, 'success'); ui.labels.layout = null; render(); }
      catch (e) { toast(e.message, 'error'); }
    });
    $('#btn-reset-all').addEventListener('click', async () => {
      const ok = await confirmModal({ title: 'Erase everything?', message: 'All items, loans, settings and the password will be deleted from this browser. Export a backup first!', confirmLabel: 'Erase', danger: true, typed: 'ERASE' });
      if (ok) { Store.resetAll(); ui.collection.selected.clear(); ui.settingsPopulated = false; logout('Library erased. The admin password is back to the default.'); }
    });

    // Re-render after every data change.
    Store.subscribe(() => render());
  }

  function init() {
    try { Barcode.selfTest(); } catch (e) { console.error(e); alert(`Barcode tables are corrupt: ${e.message}`); }
    Store.load();
    bindEvents();
    showView('consumer');
  }

  document.addEventListener('DOMContentLoaded', init);
})();
