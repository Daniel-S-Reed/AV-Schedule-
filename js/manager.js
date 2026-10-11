// Manager page: volunteers, everyone's availability entries, generate/edit/publish schedule.
(function () {
  const U = AV.util, db = AV.db, cfg = window.AV_CONFIG;
  const $ = (id) => document.getElementById(id);
  const esc = U.escapeHtml;
  const ROLES = U.ROLES; // audio, screens, camera

  // unavail: id -> unavailable Sundays; prefs: id -> preferred service index (set by the volunteer)
  let volunteers = [], unavail = {}, prefs = {}, stamps = {}, settings = null, schedule = null, editingId = null;

  /* ------------------------------ helpers ------------------------------ */
  let toastTimer;
  function toast(msg, bad) {
    const t = $('toast');
    t.textContent = msg; t.className = 'show' + (bad ? ' bad' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.className = ''; }, bad ? 4200 : 2600);
  }
  const fail = (e) => toast('Save failed: ' + (e && e.message ? e.message : e), true);
  const isOut = (id, date) => (unavail[id] || []).includes(date);
  const active = () => volunteers.filter((v) => !v.disabled);
  const byId = (id) => volunteers.find((v) => v.id === id);

  // Reads a "Number of months" box. Blank or nonsense becomes 1, and anything
  // outside 1-24 is pulled back into range (and the box is corrected to match).
  function monthsIn(boxId) {
    const n = Math.max(1, Math.min(24, parseInt($(boxId).value, 10) || 1));
    $(boxId).value = n;
    return n;
  }

  function monthOptions(sel, selectedKey) {
    const now = new Date();
    let html = '';
    for (let i = -1; i <= 14; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
      const k = U.monthKey(d);
      html += '<option value="' + k + '">' + esc(U.fmtMonthYear(k)) + '</option>';
    }
    sel.innerHTML = html;
    sel.value = selectedKey;
  }

  /* ------------------------------- boot ------------------------------- */
  function boot() {
    if (db.mode === 'local') {
      $('banner').innerHTML = '<div class="banner">Demo mode: data is saved only in this browser, and there is no sign-in. See README.md to connect the shared database.</div>';
    }
    wire();
    db.auth.onChange((user) => {
      if (user) {
        $('loginView').hidden = true; $('app').hidden = false;
        $('signOut').hidden = db.mode === 'local';
        load();
      } else {
        $('loginView').hidden = false; $('app').hidden = true; $('signOut').hidden = true;
      }
    });
  }

  async function load() {
    let entries;
    try {
      [volunteers, entries, settings, schedule] = await Promise.all([db.listVolunteers(), db.getAllEntries(), db.getSettings(), db.getSchedule()]);
    } catch (e) {
      $('loadError').innerHTML = '<div class="error">Could not load data: ' + esc(e.message) + '</div>';
      return;
    }
    $('loadError').innerHTML = '';
    unavail = {}; prefs = {}; stamps = {};
    Object.keys(entries).forEach((id) => { unavail[id] = entries[id].dates || []; prefs[id] = entries[id].preferred; stamps[id] = entries[id].updatedAt || 0; });
    settings = Object.assign({ serviceTimes: cfg.serviceDefaults.slice(), singleDates: {}, notes: {}, openMonths: [] }, settings || {});
    if (!Array.isArray(settings.openMonths)) settings.openMonths = [];
    const next = new Date(); next.setMonth(next.getMonth() + 1);
    const nextKey = U.monthKey(next);
    monthOptions($('aMonth'), nextKey);
    monthOptions($('sMonth'), schedule ? schedule.startMonth : nextKey);
    if (schedule) $('sSpan').value = String(schedule.span);
    [0, 1, 2].forEach((i) => { $('svc' + i).value = settings.serviceTimes[i] || ''; });
    renderVolunteers();
    renderRelease();
    renderResponses();
    renderAvailability();
    renderSundaySettings();
    renderSchedule();
  }

  /* ------------------------------ responses ------------------------------ */
  function lastSeen() { try { return +localStorage.getItem('avm_seen') || 0; } catch (e) { return 0; } }
  function ago(ts) {
    const m = Math.round((Date.now() - ts) / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return m + ' min ago';
    if (m < 1440) return Math.round(m / 60) + ' hr ago';
    return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
  function renderResponses() {
    const seen = lastSeen(), people = active();
    const rows = people.slice().sort((a, b) => (stamps[b.id] || 0) - (stamps[a.id] || 0)).map((v) => {
      const t = stamps[v.id] || 0;
      const isNew = t > seen;
      const open = new Set(settings.openMonths);
      const out = (unavail[v.id] || []).filter((d) => open.has(d.slice(0, 7))).length;
      return '<tr><td><strong>' + esc(v.name) + '</strong>' + (isNew ? ' <span class="chip ok">New</span>' : '') + '</td><td>' +
        (t ? esc(ago(t)) : '<span style="color:var(--muted)">no response yet</span>') + '</td><td>' + out + '</td></tr>';
    }).join('');
    $('respBody').innerHTML = rows || '<tr><td colspan="3" class="empty">No volunteers yet.</td></tr>';
    const n = people.filter((v) => (stamps[v.id] || 0) > seen).length;
    const tab = document.querySelector('.tabs [data-tab="availability"]');
    tab.textContent = 'Availability entries' + (n ? ' (' + n + ' new)' : '');
  }

  /* --------------------------- release months --------------------------- */
  function releaseKeys() {
    const now = new Date(), keys = [];
    for (let i = 0; i < 12; i++) keys.push(U.monthKey(new Date(now.getFullYear(), now.getMonth() + i, 1)));
    return keys;
  }

  function renderRelease() {
    const open = new Set(settings.openMonths);
    $('monthRelease').innerHTML = releaseKeys().map((k) =>
      '<button type="button" class="day' + (open.has(k) ? ' open' : '') + '" data-month="' + k + '" aria-pressed="' + open.has(k) + '">' +
      esc(U.fmtMonthYear(k)) + '<small>' + (open.has(k) ? 'Open to volunteers' : 'Closed') + '</small></button>').join('');
  }

  async function saveOpenMonths(list) {
    const prev = settings.openMonths, prevAt = settings.openedAt;
    settings.openMonths = list.slice().sort();
    settings.openedAt = Object.assign({}, settings.openedAt);
    settings.openMonths.forEach((k) => { if (!prev.includes(k)) settings.openedAt[k] = Date.now(); });
    renderRelease();
    try { await db.saveSettings(settings); toast('Release settings saved'); }
    catch (e) { settings.openMonths = prev; settings.openedAt = prevAt; renderRelease(); fail(e); }
  }

  function onReleaseClick(e) {
    const b = e.target.closest('[data-month]'); if (!b) return;
    const k = b.dataset.month, set = new Set(settings.openMonths);
    if (set.has(k)) set.delete(k); else set.add(k);
    saveOpenMonths([...set]);
  }

  function openNext() {
    const n = Math.max(1, Math.min(12, parseInt($('openN').value, 10) || 1));
    $('openN').value = n;
    const set = new Set(settings.openMonths), keys = releaseKeys();
    let added = 0;
    for (const k of keys) { if (added >= n) break; if (!set.has(k)) { set.add(k); added++; } }
    saveOpenMonths([...set]);
  }

  function wire() {
    $('markSeen').addEventListener('click', () => { try { localStorage.setItem('avm_seen', String(Date.now())); } catch (e) {} renderResponses(); });
    $('monthRelease').addEventListener('click', onReleaseClick);
    $('openNext').addEventListener('click', openNext);
    $('closeAll').addEventListener('click', () => { if (settings.openMonths.length) saveOpenMonths([]); });

    $('loginBtn').addEventListener('click', async () => {
      $('loginMsg').hidden = true;
      try { await db.auth.signIn($('email').value.trim(), $('pw').value); }
      catch (e) { $('loginMsg').textContent = 'Sign-in failed: ' + e.message; $('loginMsg').hidden = false; }
    });
    $('pw').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('loginBtn').click(); });
    $('signOut').addEventListener('click', (e) => { e.preventDefault(); db.auth.signOut(); });

    document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => {
      document.querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('active', x === b));
      ['volunteers', 'availability', 'schedule'].forEach((t) => { $('tab-' + t).hidden = t !== b.dataset.tab; });
    }));

    $('vSave').addEventListener('click', saveVolunteer);
    $('vClear').addEventListener('click', clearForm);
    $('vBody').addEventListener('click', onVolunteerClick);

    $('aMonth').addEventListener('change', renderAvailability);
    $('aSpan').addEventListener('change', renderAvailability);
    $('availWrap').addEventListener('click', onAvailClick);

    $('sMonth').addEventListener('change', renderSundaySettings);
    $('sSpan').addEventListener('change', renderSundaySettings);
    $('sunBody').addEventListener('change', onSundaySetting);
    $('genBtn').addEventListener('click', generate);

    $('schedOut').addEventListener('change', onSlotChange);
    $('schedOut').addEventListener('click', onScheduleAction);
  }

  /* ----------------------------- volunteers ----------------------------- */
  function clearForm() {
    editingId = null;
    $('vName').value = '';
    ['vAudio', 'vScreens', 'vCamera'].forEach((id) => { $(id).checked = false; });
    $('vSave').textContent = 'Add volunteer'; $('formTitle').textContent = 'Add a volunteer';
  }

  async function refreshVolunteers() {
    volunteers = await db.listVolunteers();
    renderVolunteers(); renderAvailability(); renderSchedule();
  }

  async function saveVolunteer() {
    const name = $('vName').value.trim();
    if (!name) { $('vName').focus(); return; }
    const positions = { audio: $('vAudio').checked, screens: $('vScreens').checked, camera: $('vCamera').checked };
    if (!positions.audio && !positions.screens && !positions.camera) { toast('Pick at least one position.', true); return; }
    const existing = byId(editingId);
    const rec = { name, positions, disabled: existing ? !!existing.disabled : false, timesServed: existing ? existing.timesServed || 0 : 0 };
    if (editingId) rec.id = editingId;
    try {
      await db.saveVolunteer(rec);
      clearForm(); await refreshVolunteers();
      toast('Saved');
    } catch (e) { fail(e); }
  }

  function renderVolunteers() {
    $('vCount').textContent = volunteers.length;
    $('vBody').innerHTML = volunteers.length ? volunteers.map((v) => {
      const p = prefs[v.id];
      const prefText = p != null && settings.serviceTimes[p] ? esc(settings.serviceTimes[p]) : '<span style="color:var(--muted)">no preference</span>';
      return '<tr class="' + (v.disabled ? 'row-disabled' : '') + '"><td><strong>' + esc(v.name) + '</strong>' + (v.disabled ? ' <span class="chip off">Disabled</span>' : '') + '</td><td>' +
        ROLES.filter((r) => v.positions && v.positions[r]).map((r) => '<span class="chip ' + r + '">' + U.ROLE_LABEL[r] + '</span> ').join('') +
        '</td><td>' + prefText + '</td><td>' + (v.timesServed || 0) + '</td><td style="text-align:right;white-space:nowrap">' +
        '<button class="secondary" data-edit="' + esc(v.id) + '">Edit</button> ' +
        '<button class="secondary" data-toggle="' + esc(v.id) + '">' + (v.disabled ? 'Enable' : 'Disable') + '</button> ' +
        '<button class="danger" data-del="' + esc(v.id) + '">Remove</button></td></tr>';
    }).join('')
      : '<tr><td colspan="5" class="empty">No volunteers yet. Add your first one above.</td></tr>';
  }

  function inSchedule(id) {
    if (!schedule) return false;
    return Object.values(schedule.assignments).some((day) => Object.values(day).some((slot) => ROLES.some((r) => slot[r] === id)));
  }

  async function onVolunteerClick(e) {
    const edit = e.target.closest('[data-edit]'), del = e.target.closest('[data-del]'), tog = e.target.closest('[data-toggle]');
    if (edit) {
      const v = byId(edit.dataset.edit); if (!v) return;
      editingId = v.id; $('vName').value = v.name;
      $('vAudio').checked = !!v.positions.audio; $('vScreens').checked = !!v.positions.screens; $('vCamera').checked = !!v.positions.camera;
      $('vSave').textContent = 'Update volunteer'; $('formTitle').textContent = 'Edit ' + v.name;
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else if (tog) {
      const v = byId(tog.dataset.toggle); if (!v) return;
      v.disabled = !v.disabled;
      try {
        await db.saveVolunteer(v);
        await refreshVolunteers();
        if (v.disabled && inSchedule(v.id)) toast(v.name + ' is disabled but is still in the current schedule. Change their slots or regenerate.', true);
        else toast(v.name + (v.disabled ? ' disabled' : ' enabled'));
      } catch (err) { v.disabled = !v.disabled; fail(err); }
    } else if (del) {
      const v = byId(del.dataset.del); if (!v) return;
      if (!confirm('Permanently remove ' + v.name + ' and their saved availability? (To keep them on the list but stop scheduling them, use Disable instead.)')) return;
      try {
        await db.deleteVolunteer(v.id);
        delete unavail[v.id]; delete prefs[v.id];
        await refreshVolunteers();
        toast(inSchedule(v.id) ? 'Removed. They are still named in the current schedule - regenerate or edit it.' : 'Removed', inSchedule(v.id));
      } catch (err) { fail(err); }
    }
  }

  /* ----------------------------- availability ----------------------------- */
  function renderAvailability() {
    const wrap = $('availWrap');
    const people = active();
    if (!people.length) { wrap.innerHTML = '<p class="empty" style="padding:14px">Add volunteers first (disabled volunteers are not shown here).</p>'; return; }
    const left = wrap.scrollLeft;
    const sundays = U.sundaysInRange($('aMonth').value, monthsIn('aSpan'));
    let prevMonth = '';
    const mstart = sundays.map((d) => { const m = d.slice(0, 7); const s = m !== prevMonth; prevMonth = m; return s; });
    const head = '<tr><th class="stick">Volunteer</th>' + sundays.map((d, i) =>
      '<th class="' + (mstart[i] ? 'mstart' : '') + '">' + esc(U.parseIso(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })) + '</th>').join('') + '<th>Out</th></tr>';
    const rows = people.map((v) => {
      const outCount = sundays.filter((d) => isOut(v.id, d)).length;
      return '<tr><td class="stick">' + esc(v.name) + '</td>' + sundays.map((d, i) => {
        const o = isOut(v.id, d);
        return '<td class="' + (mstart[i] ? 'mstart' : '') + '"><button class="cell' + (o ? ' out' : '') + '" data-v="' + esc(v.id) + '" data-d="' + d + '" aria-label="' + esc(v.name) + ' ' + d + (o ? ' unavailable' : ' available') + '">' + (o ? '&#10005;' : '&#10003;') + '</button></td>';
      }).join('') + '<td><strong>' + outCount + '</strong></td></tr>';
    }).join('');
    const foot = '<tr><td class="stick" style="background:var(--band)">Available</td>' + sundays.map((d, i) =>
      '<td class="' + (mstart[i] ? 'mstart' : '') + '">' + people.filter((v) => !isOut(v.id, d)).length + '</td>').join('') + '<td></td></tr>';
    wrap.innerHTML = '<table class="matrix"><thead>' + head + '</thead><tbody>' + rows + '</tbody><tfoot>' + foot + '</tfoot></table>';
    wrap.scrollLeft = left;
  }

  async function onAvailClick(e) {
    const b = e.target.closest('.cell'); if (!b) return;
    const id = b.dataset.v, d = b.dataset.d;
    const list = (unavail[id] || []).slice();
    const i = list.indexOf(d);
    if (i >= 0) list.splice(i, 1); else list.push(d);
    list.sort();
    unavail[id] = list;
    renderAvailability();
    try { await db.setEntry(id, { dates: list }); } catch (err) { fail(err); }
  }

  /* --------------------------- schedule settings --------------------------- */
  function renderSundaySettings() {
    const sundays = U.sundaysInRange($('sMonth').value, monthsIn('sSpan'));
    $('sunBody').innerHTML = sundays.map((d) =>
      '<tr><td>' + esc(U.fmtLong(d)) + '</td><td><input type="checkbox" data-single="' + d + '"' + (settings.singleDates[d] ? ' checked' : '') + ' aria-label="Single service on ' + d + '"></td>' +
      '<td><input type="text" data-note="' + d + '" value="' + esc(settings.notes[d] || '') + '" style="width:100%" placeholder="optional"></td></tr>').join('');
  }

  async function onSundaySetting(e) {
    const t = e.target;
    if (t.dataset.single) { if (t.checked) settings.singleDates[t.dataset.single] = true; else delete settings.singleDates[t.dataset.single]; }
    else if (t.dataset.note) { const v = t.value.trim(); if (v) settings.notes[t.dataset.note] = v; else delete settings.notes[t.dataset.note]; }
    else return;
    try { await db.saveSettings(settings); } catch (err) { fail(err); }
  }

  /* ------------------------------- generate ------------------------------- */
  async function generate() {
    if (!active().length) { toast('Add or enable volunteers first.', true); return; }
    if (schedule && schedule.published && !confirm('A schedule is currently published. Generating a new one replaces it and un-publishes it. Continue?')) return;
    settings.serviceTimes = [0, 1, 2].map((i) => $('svc' + i).value.trim() || 'Service ' + (i + 1));
    const month = $('sMonth').value, span = monthsIn('sSpan');
    const sundays = U.sundaysInRange(month, span);
    const g = U.generate(volunteers, unavail, prefs, settings.serviceTimes, settings.singleDates, sundays);
    const notes = {}; sundays.forEach((d) => { if (settings.notes[d]) notes[d] = settings.notes[d]; });
    schedule = { startMonth: month, span, sundays, assignments: g.assignments, isSingle: g.isSingle, serviceTimes: settings.serviceTimes.slice(), notes, published: false, committed: false };
    try {
      await db.saveSettings(settings);
      await db.saveSchedule(schedule);
      renderVolunteers(); renderSchedule();
      toast('Draft schedule created (not published yet)');
    } catch (e) { fail(e); }
  }

  /* ----------------------------- schedule view ----------------------------- */
  function optionsFor(role, date, current) {
    let html = '<option value="">' + (role === 'screens' ? '(none - audio covers)' : '(unassigned)') + '</option>';
    volunteers.filter((v) => (!v.disabled && v.positions && v.positions[role]) || v.id === current).forEach((v) => {
      let label = v.name;
      if (v.disabled) label += ' (disabled)';
      else if (isOut(v.id, date)) label += ' (unavailable)';
      html += '<option value="' + esc(v.id) + '"' + (v.id === current ? ' selected' : '') + '>' + esc(label) + '</option>';
    });
    return html;
  }
  function selectClass(role, date, current) {
    if (!current) return role === 'screens' ? '' : 'empty-slot';
    const v = byId(current);
    return isOut(current, date) || !v || v.disabled ? 'conflict' : '';
  }

  function renderSchedule() {
    const box = $('schedOut');
    if (!schedule) { box.innerHTML = '<div class="card"><p class="empty">No schedule yet. Choose a range above and press Generate.</p></div>'; return; }
    let html = '<div class="toolbar">' +
      '<span class="chip ' + (schedule.published ? 'ok' : 'warn') + '">' + (schedule.published ? 'Published - volunteers can see it' : 'Draft - volunteers cannot see it') + '</span>' +
      '<button data-act="regen" class="secondary">Regenerate</button>' +
      '<button data-act="publish">' + (schedule.published ? 'Unpublish' : 'Publish to volunteers') + '</button>' +
      '<button data-act="commit" class="secondary"' + (schedule.committed ? ' disabled' : '') + '>' + (schedule.committed ? 'Counted in stats' : 'Add to served counts') + '</button>' +
      '<button data-act="print" class="secondary">Print / Save as PDF</button></div>' +
      (schedule.published ? '<p class="sub">Edits you make below go live for volunteers right away.</p>' : '') +
      '<div id="summary"></div>';
    html += schedule.sundays.map(cardHtml).join('');
    box.innerHTML = html;
    renderSummary();
  }

  function cardHtml(date) {
    const day = schedule.assignments[date] || {};
    const single = !!schedule.isSingle[date];
    const keys = Object.keys(day).sort((a, b) => a - b);
    const rows = keys.map((s) => '<tr><th scope="row">' + (single ? 'Combined' : esc(schedule.serviceTimes[s] || 'Service ' + (+s + 1))) + '</th>' +
      ROLES.map((r) => '<td><select data-date="' + date + '" data-svc="' + s + '" data-role="' + r + '" class="' + selectClass(r, date, day[s][r]) + '" aria-label="' + U.ROLE_LABEL[r] + ' ' + date + '">' + optionsFor(r, date, day[s][r]) + '</select></td>').join('') + '</tr>').join('');
    return '<div class="sunday-card"><div class="head">' + esc(U.fmtLong(date)) +
      (single ? ' <span class="chip warn">Single service</span>' : '') +
      (schedule.notes[date] ? ' <span class="chip">' + esc(schedule.notes[date]) + '</span>' : '') + '</div>' +
      '<table><thead><tr><th></th>' + ROLES.map((r) => '<th class="colhead">' + U.ROLE_LABEL[r] + '</th>').join('') + '</tr></thead><tbody>' + rows + '</tbody></table></div>';
  }

  function batchCounts() {
    const c = {};
    Object.values(schedule.assignments).forEach((day) => Object.values(day).forEach((slot) => ROLES.forEach((r) => { if (slot[r]) c[slot[r]] = (c[slot[r]] || 0) + 1; })));
    return c;
  }

  function renderSummary() {
    const el = $('summary'); if (!el) return;
    let missing = 0;
    Object.values(schedule.assignments).forEach((day) => Object.values(day).forEach((slot) => { if (!slot.audio) missing++; if (!slot.camera) missing++; }));
    const counts = batchCounts();
    const max = Math.max(1, ...Object.values(counts));
    const shown = volunteers.filter((v) => !v.disabled || counts[v.id]);
    const rows = shown.sort((a, b) => (counts[b.id] || 0) - (counts[a.id] || 0)).map((v) =>
      '<div class="bar-row"><div class="nm">' + esc(v.name) + (v.disabled ? ' <span class="chip off">Disabled</span>' : '') + '</div><div class="track"><div class="fill" style="width:' + Math.round(((counts[v.id] || 0) / max) * 100) + '%"></div></div>' +
      '<div class="ct">' + (counts[v.id] || 0) + ' this batch &middot; ' + (v.timesServed || 0) + ' before</div></div>').join('');
    el.innerHTML = '<div class="card"><p style="margin:0 0 10px">' + (missing
      ? '<span class="chip warn">' + missing + ' Audio/Camera slot' + (missing === 1 ? '' : 's') + ' still unfilled</span> Screens may stay blank - Audio covers it.'
      : '<span class="chip ok">All Audio and Camera slots are filled</span>') + '</p>' + rows + '</div>';
  }

  let saveTimer;
  function saveSoon() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => db.saveSchedule(schedule).then(() => toast('Saved'), fail), 400);
  }

  function onSlotChange(e) {
    const s = e.target.closest('select[data-date]'); if (!s) return;
    const { date, svc, role } = s.dataset;
    schedule.assignments[date][svc][role] = s.value || null;
    s.className = selectClass(role, date, s.value || null);
    renderSummary();
    saveSoon();
  }

  async function onScheduleAction(e) {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const act = b.dataset.act;
    try {
      if (act === 'regen') { await generate(); }
      else if (act === 'publish') {
        schedule.published = !schedule.published;
        await db.saveSchedule(schedule); renderSchedule();
        toast(schedule.published ? 'Published - volunteers can now see it' : 'Unpublished');
      } else if (act === 'commit') {
        if (!confirm('Add this batch to everyone\'s "times served" totals? Do this once, after the schedule is final.')) return;
        const c = batchCounts();
        for (const v of volunteers) {
          if (!c[v.id]) continue;
          v.timesServed = (v.timesServed || 0) + c[v.id];
          await db.saveVolunteer(v);
        }
        schedule.committed = true; await db.saveSchedule(schedule);
        renderVolunteers(); renderSchedule(); toast('Served counts updated');
      } else if (act === 'print') { printSchedule(); }
    } catch (err) { fail(err); }
  }

  /* -------------------------------- print -------------------------------- */
  function printSchedule() {
    const name = (id) => { const v = byId(id); return v ? esc(v.name) : ''; };
    const months = {};
    schedule.sundays.forEach((d) => { (months[d.slice(0, 7)] = months[d.slice(0, 7)] || []).push(d); });
    let html = '';
    Object.keys(months).forEach((m, idx) => {
      html += '<div class="' + (idx ? 'pb' : '') + '"><h1>A/V Operators ' + esc(U.fmtMonthYear(m)) + '</h1>';
      months[m].forEach((d) => {
        const day = schedule.assignments[d] || {};
        const single = schedule.isSingle[d];
        html += '<h2>Date: ' + esc(U.parseIso(d).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })) +
          (schedule.notes[d] ? ' <em>(' + esc(schedule.notes[d]) + ')</em>' : '') + '</h2>' +
          '<table><thead><tr><th></th><th>Audio</th><th>Screens</th><th>Camera</th></tr></thead><tbody>' +
          Object.keys(day).sort((a, b) => a - b).map((s) => '<tr><th style="text-align:left">' + (single ? 'Combined' : esc(schedule.serviceTimes[s] || '')) + '</th><td>' + name(day[s].audio) + '</td><td>' + name(day[s].screens) + '</td><td>' + name(day[s].camera) + '</td></tr>').join('') +
          '</tbody></table>';
      });
      html += '</div>';
    });
    $('printArea').innerHTML = html;
    window.print();
  }

  boot();
})();
