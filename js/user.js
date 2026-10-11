// Volunteer page: pick your name, mark Sundays you can't serve, see your schedule.
(function () {
  const U = AV.util, db = AV.db, cfg = window.AV_CONFIG;
  const $ = (id) => document.getElementById(id);
  const esc = U.escapeHtml;

  let volunteers = [], settings = {}, schedule = null;
  let me = null, saved = [], selected = new Set(), dirty = false, pref = null;
  let sundays = []; // only Sundays in months the manager has released

  async function boot() {
    if (db.mode === 'local') {
      $('banner').innerHTML = '<div class="banner">Demo mode: entries are saved only in this browser. See README.md to connect the shared database.</div>';
    }
    try {
      [volunteers, settings, schedule] = await Promise.all([db.listVolunteers(), db.getSettings(), db.getSchedule()]);
    } catch (e) {
      $('loadError').innerHTML = '<div class="error">Could not load data: ' + esc(e.message) + '</div>';
      return;
    }
    settings = settings || {};
    const today = U.iso(new Date());
    sundays = (settings.openMonths || []).slice().sort()
      .reduce((all, m) => all.concat(U.sundaysInRange(m, 1)), [])
      .filter((d) => d >= today);
    const sel = $('who');
    const active = volunteers.filter((v) => !v.disabled); // disabled people aren't listed
    sel.innerHTML = '<option value="">- choose your name -</option>' +
      active.map((v) => '<option value="' + esc(v.id) + '">' + esc(v.name) + '</option>').join('');
    if (!active.length) sel.innerHTML = '<option value="">No volunteers yet - ask your manager to add you</option>';

    sel.addEventListener('change', () => {
      if (dirty && !confirm('You have unsaved changes. Switch anyway?')) { sel.value = me ? me.id : ''; return; }
      pick(sel.value);
    });
    $('saveBtn').addEventListener('click', save);
    $('pref').addEventListener('change', () => {
      pref = $('pref').value === '' ? null : +$('pref').value;
      dirty = true;
      setSaveState();
    });
    $('icsBtn').addEventListener('click', downloadIcs);
    window.addEventListener('beforeunload', (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });

    const remembered = localStorage.getItem('avs_me');
    if (remembered && active.some((v) => v.id === remembered)) { sel.value = remembered; pick(remembered); }
  }

  async function pick(id) {
    me = volunteers.find((v) => v.id === id) || null;
    dirty = false;
    $('availCard').hidden = !me;
    $('mineCard').hidden = !me;
    if (!me) return;
    localStorage.setItem('avs_me', id);
    try {
      const entry = await db.getEntry(id);
      saved = entry.dates; pref = entry.preferred;
    } catch (e) { saved = []; pref = null; }
    selected = new Set(saved.filter((d) => sundays.includes(d)));
    renderPref();
    renderDays();
    renderMine();
    setSaveState();
  }

  function serviceTimes() {
    return settings.serviceTimes && settings.serviceTimes.length ? settings.serviceTimes : cfg.serviceDefaults;
  }

  function renderPref() {
    const times = serviceTimes();
    if (pref != null && pref >= times.length) pref = null;
    $('pref').innerHTML = '<option value="">No preference</option>' +
      times.map((t, i) => '<option value="' + i + '">' + esc(t) + ' service</option>').join('');
    $('pref').value = pref == null ? '' : String(pref);
  }

  function renderDays() {
    if (!sundays.length) {
      $('days').innerHTML = '<p class="empty">No months are open for availability right now. Your manager will release the next month soon - check back later.</p>';
      $('saveBtn').hidden = true;
      return;
    }
    $('saveBtn').hidden = false;
    const byMonth = {};
    sundays.forEach((d) => { (byMonth[d.slice(0, 7)] = byMonth[d.slice(0, 7)] || []).push(d); });
    const single = settings.singleDates || {}, notes = settings.notes || {};
    $('days').innerHTML = Object.keys(byMonth).map((m) =>
      '<div class="month-block"><h3>' + esc(U.fmtMonthYear(m)) + '</h3><div class="days">' +
      byMonth[m].map((d) => {
        const out = selected.has(d);
        const extra = single[d] ? '1 service' : '';
        const note = notes[d] ? esc(notes[d]) : '';
        return '<button type="button" class="day' + (out ? ' out' : '') + '" data-d="' + d + '" aria-pressed="' + out + '">' +
          esc(U.fmtMed(d)) + '<small>' + (out ? 'Unavailable' : 'Available') + '</small>' +
          (extra || note ? '<small>' + [extra, note].filter(Boolean).join(' - ') + '</small>' : '') + '</button>';
      }).join('') + '</div></div>').join('');
    $('days').querySelectorAll('.day').forEach((b) => b.addEventListener('click', () => toggle(b)));
  }

  function toggle(btn) {
    const d = btn.dataset.d;
    if (selected.has(d)) selected.delete(d); else selected.add(d);
    const out = selected.has(d);
    btn.classList.toggle('out', out);
    btn.setAttribute('aria-pressed', out);
    btn.querySelector('small').textContent = out ? 'Unavailable' : 'Available';
    dirty = true;
    setSaveState();
  }

  function setSaveState(msg) {
    if (!sundays.length) { $('saveBtn').disabled = !dirty; $('saveMsg').textContent = dirty ? 'You have unsaved changes.' : ''; return; }
    $('saveBtn').disabled = !dirty;
    $('saveMsg').textContent = msg || (dirty ? 'You have unsaved changes.' :
      (selected.size ? 'You are marked unavailable for ' + selected.size + ' Sunday' + (selected.size === 1 ? '' : 's') + '.' : 'You are available every Sunday shown.'));
  }

  async function save() {
    $('saveBtn').disabled = true;
    const final = saved.filter((d) => !sundays.includes(d)).concat([...selected]).sort();
    try {
      await db.setEntry(me.id, { dates: final, preferred: pref, updatedAt: Date.now() });
      saved = final; dirty = false;
      notifyManager(final);
      setSaveState('Saved. Thank you!');
    } catch (e) {
      $('saveBtn').disabled = false;
      setSaveState('Could not save: ' + e.message);
    }
  }

  // Optional email to the manager (Web3Forms). Silent on failure; never blocks the save.
  function notifyManager(finalDates) {
    const key = cfg.notifyAccessKey;
    if (!key) return;
    const open = new Set(settings.openMonths || []);
    const shown = finalDates.filter((d) => open.has(d.slice(0, 7)));
    const times = serviceTimes();
    const body = me.name + ' saved their availability.\n\n' +
      'Unavailable Sundays (open months): ' + (shown.length ? shown.map(U.fmtMed).join(', ') : 'none') + '\n' +
      'Preferred service: ' + (pref == null ? 'no preference' : times[pref]) + '\n';
    fetch('https://api.web3forms.com/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ access_key: key, subject: 'AV availability: ' + me.name, from_name: 'AV Scheduler', message: body })
    }).catch(() => {});
  }

  function renderMine() {
    const box = $('mine');
    $('mineTools').hidden = true;
    if (!schedule || !schedule.published) {
      $('mineSub').textContent = '';
      box.innerHTML = '<p class="empty">The schedule has not been released yet. Check back after your manager publishes it.</p>';
      return;
    }
    const entries = U.entriesFor(schedule, me.id, volunteers);
    $('mineSub').textContent = 'Schedule for ' + U.fmtMonthYear(schedule.startMonth) + (schedule.span > 1 ? ' and the following ' + (schedule.span - 1) + ' month(s)' : '') + '.';
    if (!entries.length) { box.innerHTML = '<p class="empty">You are not scheduled in this release.</p>'; return; }
    const today = U.iso(new Date());
    box.innerHTML = entries.map((e) =>
      '<div class="mine' + (e.date < today ? ' past' : '') + '"><div class="when">' + esc(U.fmtLong(e.date)) +
      (e.note ? ' <span class="chip warn">' + esc(e.note) + '</span>' : '') + '</div><div class="what">' +
      '<span class="chip ' + e.role + '">' + U.ROLE_LABEL[e.role] + '</span> ' + esc(e.timeLabel) +
      (e.coversScreens ? ' &middot; <strong>also cover Screens</strong>' : '') +
      (e.others.length ? '<br><span style="color:var(--muted)">With: ' + e.others.map((o) => esc(o.name) + ' (' + U.ROLE_LABEL[o.role] + ')').join(', ') + '</span>' : '') +
      '</div></div>').join('');
    $('mineTools').hidden = false;
  }

  function downloadIcs() {
    const entries = U.entriesFor(schedule, me.id, volunteers);
    const name = me.name.replace(/[^A-Za-z0-9]+/g, '_');
    U.download('AV_Calendar_' + name + '.ics', U.buildIcs(entries, me.id, schedule, cfg), 'text/calendar');
  }

  boot();
})();
