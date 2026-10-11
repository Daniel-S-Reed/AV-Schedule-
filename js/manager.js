// Manager page: volunteers, everyone's availability entries, generate/edit/publish schedule.
(function () {
  const U = AV.util, db = AV.db, cfg = window.AV_CONFIG;
  const $ = (id) => document.getElementById(id);
  const esc = U.escapeHtml;
  const ROLES = U.ROLES; // audio, screens, camera

  // unavail: id -> unavailable Sundays; prefs: id -> preferred service index (set by the volunteer)
  let volunteers = [], unavail = {}, prefs = {}, stamps = {}, emails = {}, settings = null, schedule = null, editingId = null;

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
    let entries, members;
    try {
      [volunteers, entries, settings, schedule, members] = await Promise.all([db.listVolunteers(), db.getAllEntries(), db.getSettings(), db.getSchedule(), db.listMembers()]);
    } catch (e) {
      $('loadError').innerHTML = '<div class="error">Could not load data: ' + esc(e.message) + '</div>';
      return;
    }
    $('loadError').innerHTML = '';
    emails = {}; members.forEach((m) => { emails[m.volunteerId] = m.email; });
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
    renderEmail();
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
    ['eKind', 'eAttach'].forEach((id) => $(id).addEventListener('change', renderEmail));
    $('eMonths').addEventListener('change', (e) => {
      const c = e.target.closest('input[data-m]'); if (!c) return;
      const set = eSel[$('eKind').value];
      if (c.checked) set.add(c.dataset.m); else set.delete(c.dataset.m);
      renderEmail();
    });
    $('ePdf').addEventListener('click', () => { try { pdfDoc().save(pdfName()); } catch (e) { $('eMsg').textContent = e.message; } });
    $('eDue').addEventListener('input', renderEmail);
    $('eDraft').addEventListener('click', createDraft);
    $('eCopyTo').addEventListener('click', () => copyText(chosenEmails().join(', '), 'Addresses'));
    $('eCopyBody').addEventListener('click', () => copyText($('eSubject').value + '\n\n' + $('eBody').value, 'Message'));
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
      ['volunteers', 'availability', 'schedule', 'email'].forEach((t) => { $('tab-' + t).hidden = t !== b.dataset.tab; });
      if (b.dataset.tab === 'email') renderEmail();
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
    $('vName').value = ''; $('vEmail').value = '';
    ['vAudio', 'vScreens', 'vCamera'].forEach((id) => { $(id).checked = false; });
    $('vSave').textContent = 'Add volunteer'; $('formTitle').textContent = 'Add a volunteer';
  }

  async function refreshVolunteers() {
    const [vs, ms] = await Promise.all([db.listVolunteers(), db.listMembers()]);
    volunteers = vs; emails = {}; ms.forEach((m) => { emails[m.volunteerId] = m.email; });
    renderVolunteers(); renderAvailability(); renderSchedule();
  }

  async function saveVolunteer() {
    const name = $('vName').value.trim();
    if (!name) { $('vName').focus(); return; }
    const positions = { audio: $('vAudio').checked, screens: $('vScreens').checked, camera: $('vCamera').checked };
    if (!positions.audio && !positions.screens && !positions.camera) { toast('Pick at least one position.', true); return; }
    const email = $('vEmail').value.trim().toLowerCase();
    if (email && !/^\S+@\S+\.\S+$/.test(email)) { toast('That email address does not look right.', true); $('vEmail').focus(); return; }
    const clash = email && Object.keys(emails).find((id) => emails[id] === email && id !== editingId);
    if (clash) { toast('That email already belongs to ' + (byId(clash) ? byId(clash).name : 'another volunteer') + '.', true); return; }
    const oldEmail = editingId ? emails[editingId] : '';
    const existing = byId(editingId);
    const rec = { name, positions, disabled: existing ? !!existing.disabled : false, timesServed: existing ? existing.timesServed || 0 : 0 };
    if (editingId) rec.id = editingId;
    try {
      const id = await db.saveVolunteer(rec);
      if (oldEmail && oldEmail !== email) await db.deleteMember(oldEmail);
      if (email) await db.saveMember(email, id);
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
        (emails[v.id] ? esc(emails[v.id]) : '<span class="chip warn">no email - cannot sign in</span>') + '</td><td>' +
        ROLES.filter((r) => v.positions && v.positions[r]).map((r) => '<span class="chip ' + r + '">' + U.ROLE_LABEL[r] + '</span> ').join('') +
        '</td><td>' + prefText + '</td><td>' + (v.timesServed || 0) + '</td><td style="text-align:right;white-space:nowrap">' +
        '<button class="secondary" data-edit="' + esc(v.id) + '">Edit</button> ' +
        '<button class="secondary" data-toggle="' + esc(v.id) + '">' + (v.disabled ? 'Enable' : 'Disable') + '</button> ' +
        '<button class="danger" data-del="' + esc(v.id) + '">Remove</button></td></tr>';
    }).join('')
      : '<tr><td colspan="6" class="empty">No volunteers yet. Add your first one above.</td></tr>';
  }

  function inSchedule(id) {
    if (!schedule) return false;
    return Object.values(schedule.assignments).some((day) => Object.values(day).some((slot) => ROLES.some((r) => slot[r] === id)));
  }

  async function onVolunteerClick(e) {
    const edit = e.target.closest('[data-edit]'), del = e.target.closest('[data-del]'), tog = e.target.closest('[data-toggle]');
    if (edit) {
      const v = byId(edit.dataset.edit); if (!v) return;
      editingId = v.id; $('vName').value = v.name; $('vEmail').value = emails[v.id] || '';
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
        if (emails[v.id]) await db.deleteMember(emails[v.id]);
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

  /* --------------------------------- email --------------------------------- */
  const siteUrl = () => new URL('index.html', window.location.href).href;
  let eList = []; // [{v, email}] for the current recipients list

  function isMissing(v, month) {
    const t = stamps[v.id] || 0;
    const opened = (settings.openedAt || {})[month] || 0;
    return !t || t < opened;
  }

  const eSel = { remind: new Set(), sched: new Set() };
  const eInit = { remind: false, sched: false };

  // "November 2026", "November and December 2026", "December 2026 and January 2027"
  function monthsLabel(keys) {
    if (!keys.length) return '(no months chosen)';
    const years = new Set(keys.map((k) => k.slice(0, 4)));
    const names = keys.map((k) => U.fmtMonthYear(k));
    const list = (a) => a.length < 3 ? a.join(' and ') : a.slice(0, -1).join(', ') + ', and ' + a[a.length - 1];
    if (years.size === 1) return list(names.map((n) => n.split(' ')[0])) + ' ' + [...years][0];
    return list(names);
  }

  function scheduleMonths() {
    return schedule ? [...new Set(schedule.sundays.map((d) => d.slice(0, 7)))].sort() : [];
  }

  function renderEmail() {
    if (!$('eKind')) return;
    const kind = $('eKind').value;
    const choices = kind === 'remind' ? releaseKeys() : scheduleMonths();
    if (!eInit[kind]) {
      eInit[kind] = true;
      if (kind === 'remind') { const n = new Date(); eSel.remind.add(U.monthKey(new Date(n.getFullYear(), n.getMonth() + 1, 1))); }
      else choices.forEach((k) => eSel.sched.add(k));
    }
    const sel = choices.filter((k) => eSel[kind].has(k));
    $('eMonths').innerHTML = choices.length ? choices.map((k) =>
      '<label class="recip" style="display:inline-block;margin-right:16px"><input type="checkbox" data-m="' + k + '"' + (eSel[kind].has(k) ? ' checked' : '') + '> ' + esc(U.fmtMonthYear(k)) + '</label>').join('')
      : '<p class="empty">No schedule yet. Generate one on the Schedule tab first.</p>';
    $('eDueField').hidden = kind !== 'remind';
    $('eAttachField').hidden = kind !== 'sched';
    $('ePdf').hidden = kind !== 'sched';

    let note = '';
    let pool = active();
    if (kind === 'remind') {
      pool = pool.filter((v) => sel.some((m) => isMissing(v, m)));
      const closed = sel.filter((m) => !(settings.openMonths || []).includes(m));
      if (closed.length) note = 'Heads up: ' + monthsLabel(closed) + (closed.length === 1 ? ' is' : ' are') + ' not open to volunteers yet. Open ' + (closed.length === 1 ? 'it' : 'them') + ' on the Availability entries tab first, or there is nothing to fill in.';
      else if (sel.length && !pool.length) note = 'Everyone has already responded for ' + monthsLabel(sel) + '.';
    } else if (schedule && !schedule.published) {
      note = 'This schedule is still a draft, so volunteers cannot see it on the website yet. Publish it first if you want them to find it there.';
    }
    $('eNote').textContent = note;
    eList = pool.map((v) => ({ v, email: emails[v.id] || '' }));
    $('eRecips').innerHTML = eList.length ? eList.map((r, i) => r.email
      ? '<label class="recip"><input type="checkbox" data-r="' + i + '" checked> ' + esc(r.v.name) + '<small>' + esc(r.email) + '</small></label>'
      : '<div class="recip none">' + esc(r.v.name) + '<small>no email on file - add one on the Volunteers tab</small></div>').join('')
      : '<p class="empty">Nobody to email.</p>';

    const label = monthsLabel(sel);
    if (kind === 'remind') {
      const due = $('eDue').value.trim();
      $('eSubject').value = 'A/V team: please send your availability for ' + label;
      $('eBody').value = 'Hi team,\n\nPlease let me know which Sundays you can NOT serve in ' + label + (due ? ' by ' + due : '') + '.\n\n' +
        '1. Go to ' + siteUrl() + '\n' +
        '2. Pick your name\n' +
        '3. Tap each Sunday you are unavailable, choose your preferred service, and press Save\n\nThank you!';
    } else {
      const attach = $('eAttach').checked;
      $('eSubject').value = 'A/V schedule - ' + label;
      $('eBody').value = 'Hi team,\n\n' + (attach ? 'Attached is' : 'Here is') + ' the A/V schedule for ' + label + '. You can also see just your own assignments, and add them to your calendar, at ' + siteUrl() + '\n\nThank you for serving!';
    }
    $('eMsg').textContent = '';
  }

  const nameOfId = (id) => { const v = byId(id); return v ? v.name : ''; };
  function selectedSchedMonths() { return scheduleMonths().filter((k) => eSel.sched.has(k)); }
  function pdfDoc() {
    const months = selectedSchedMonths();
    if (!schedule || !months.length) throw new Error('Choose at least one month of the schedule.');
    if (!window.jspdf) throw new Error('The PDF library did not load (check your internet connection and reload the page).');
    return AV.pdf.buildSchedulePdf(window.jspdf.jsPDF, schedule, nameOfId, months, U);
  }
  const pdfName = () => 'AV_Schedule_' + monthsLabel(selectedSchedMonths()).replace(/[^A-Za-z0-9]+/g, '_') + '.pdf';

  const chosenEmails = () => [...document.querySelectorAll('#eRecips input[data-r]')].filter((c) => c.checked).map((c) => eList[+c.dataset.r].email);

  async function createDraft() {
    const to = chosenEmails();
    const msg = $('eMsg');
    const kind = $('eKind').value;
    if (!to.length) { msg.textContent = 'Select at least one recipient with an email address.'; return; }
    if (!cfg.draftEndpoint) { msg.textContent = 'Gmail drafts are not set up yet. Follow the "Gmail drafts" steps in the README and paste the web app URL into js/config.js as draftEndpoint, or use Copy addresses / Copy message below.'; return; }
    const token = await db.getIdToken();
    if (!token) { msg.textContent = 'Gmail drafts need the shared database (not demo mode). Use Copy addresses / Copy message for now.'; return; }
    const payload = { idToken: token, to, subject: $('eSubject').value, body: $('eBody').value };
    if (kind === 'sched' && $('eAttach').checked) {
      try {
        const b64 = pdfDoc().output('datauristring').split(',')[1];
        payload.attachment = { name: pdfName(), base64: b64 };
      } catch (e) { msg.textContent = e.message; return; }
    }
    $('eDraft').disabled = true; msg.textContent = 'Creating draft...';
    try {
      const r = await fetch(cfg.draftEndpoint, { method: 'POST', body: JSON.stringify(payload) });
      const j = await r.json();
      msg.textContent = j.ok ? 'Draft created' + (payload.attachment ? ' with the PDF attached' : '') + '. Open Gmail > Drafts to review and send it.' : 'Could not create the draft: ' + (j.error || 'unknown error');
    } catch (e) {
      msg.textContent = 'Could not confirm the draft was created (' + e.message + '). Check your Gmail Drafts folder; if it is not there, see the README troubleshooting.';
    }
    $('eDraft').disabled = false;
  }

  async function copyText(text, what) {
    try { await navigator.clipboard.writeText(text); toast(what + ' copied'); }
    catch (e) { toast('Could not copy - select the text and copy it manually.', true); }
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
