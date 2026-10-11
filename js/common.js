// Shared helpers: dates, the scheduling algorithm, and .ics calendar export.
(function () {
  const AV = (window.AV = window.AV || {});

  /* ------------------------------- dates ------------------------------- */
  const pad = (n) => String(n).padStart(2, '0');
  const iso = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const parseIso = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const monthKey = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1);
  const fmtLong = (s) => parseIso(s).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const fmtMed = (s) => parseIso(s).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  const fmtMonthYear = (key) => { const [y, m] = key.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' }); };

  function sundaysInRange(startMonth, span) {
    if (!startMonth) return [];
    const [y, m] = startMonth.split('-').map(Number);
    const start = new Date(y, m - 1, 1);
    const end = new Date(y, m - 1 + span, 1);
    const d = new Date(start);
    while (d.getDay() !== 0) d.setDate(d.getDate() + 1);
    const out = [];
    while (d < end) { out.push(iso(d)); d.setDate(d.getDate() + 7); }
    return out;
  }

  function upcomingSundays(monthsAhead) {
    const t = new Date(); t.setHours(0, 0, 0, 0);
    const d = new Date(t);
    while (d.getDay() !== 0) d.setDate(d.getDate() + 1);
    const end = new Date(t.getFullYear(), t.getMonth() + monthsAhead, t.getDate());
    const out = [];
    while (d <= end) { out.push(iso(d)); d.setDate(d.getDate() + 7); }
    return out;
  }

  function parseClock(text) {
    const m = /^\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*$/i.exec(text || '');
    if (!m) return null;
    let h = +m[1]; const min = +(m[2] || 0);
    if (m[3]) { const pm = m[3].toLowerCase() === 'pm'; if (pm && h < 12) h += 12; if (!pm && h === 12) h = 0; }
    return h * 60 + min;
  }

  const escapeHtml = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ------------------------------ scheduler ------------------------------ */
  const ROLES = ['audio', 'screens', 'camera']; // display order (matches the Word draft)
  const ROLE_LABEL = { audio: 'Audio', screens: 'Screens', camera: 'Camera' };

  // Keeps people on their usual service where possible, balances by how often
  // they've served, never double-books one person in a single service, and
  // leaves Screens blank when nobody is left (Audio covers it).
  // `prefs` maps volunteer id -> preferred service index (chosen by the volunteer).
  // Disabled volunteers are never scheduled.
  function generate(allVolunteers, unavail, prefs, serviceTimes, singleDates, sundays) {
    const volunteers = allVolunteers.filter((v) => !v.disabled);
    const assignments = {}, isSingle = {}, running = {};
    volunteers.forEach((v) => { running[v.id] = v.timesServed || 0; });
    const isOut = (id, date) => (unavail[id] || []).includes(date);

    for (const date of sundays) {
      const single = !!singleDates[date];
      isSingle[date] = single;
      const n = single ? 1 : serviceTimes.length;
      assignments[date] = {};
      const today = new Set();

      for (let s = 0; s < n; s++) {
        const slot = { audio: null, screens: null, camera: null };
        const here = new Set();
        for (const role of ['audio', 'camera', 'screens']) {
          const base = volunteers.filter((v) => v.positions && v.positions[role] && !isOut(v.id, date) && !here.has(v.id));
          let pool = base;
          if (!single) {
            const home = base.filter((v) => prefs[v.id] == null || prefs[v.id] === s);
            if (home.length) pool = home;
          }
          if (!pool.length) continue;
          const scored = pool.map((v) => ({ v, score: (today.has(v.id) ? 1000 : 0) + running[v.id] + Math.random() }));
          scored.sort((a, b) => a.score - b.score);
          const pick = scored[0].v;
          slot[role] = pick.id;
          here.add(pick.id); today.add(pick.id); running[pick.id]++;
        }
        assignments[date][String(s)] = slot;
      }
    }
    return { assignments, isSingle };
  }

  // Every slot a given volunteer is scheduled for, in date order.
  function entriesFor(schedule, volId, volunteers) {
    const out = [];
    if (!schedule) return out;
    const nameOf = (id) => { const v = volunteers.find((x) => x.id === id); return v ? v.name : null; };
    for (const date of schedule.sundays || []) {
      const day = (schedule.assignments || {})[date] || {};
      const single = !!(schedule.isSingle || {})[date];
      for (const svc of Object.keys(day).sort((a, b) => a - b)) {
        const slot = day[svc];
        const role = ROLES.find((r) => slot[r] === volId);
        if (!role) continue;
        const times = schedule.serviceTimes || [];
        out.push({
          date, svc: +svc, role, single,
          timeLabel: single ? 'Combined service' : (times[svc] || 'Service ' + (+svc + 1)),
          note: ((schedule.notes || {})[date]) || '',
          others: ROLES.filter((r) => r !== role && slot[r]).map((r) => ({ role: r, name: nameOf(slot[r]) })).filter((o) => o.name),
          coversScreens: role === 'audio' && !slot.screens
        });
      }
    }
    return out;
  }

  /* ---------------------------- calendar (.ics) ---------------------------- */
  const icsEscape = (t) => String(t).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
  const icsStamp = (d) => d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + 'T' + pad(d.getHours()) + pad(d.getMinutes()) + '00';
  function fold(line) {
    const parts = [];
    while (line.length > 73) { parts.push(line.slice(0, 73)); line = ' ' + line.slice(73); }
    parts.push(line);
    return parts.join('\r\n');
  }

  function buildIcs(entries, volId, schedule, cfg) {
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//AV Scheduler//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
    const now = new Date();
    const stampUtc = now.getUTCFullYear() + pad(now.getUTCMonth() + 1) + pad(now.getUTCDate()) + 'T' + pad(now.getUTCHours()) + pad(now.getUTCMinutes()) + pad(now.getUTCSeconds()) + 'Z';
    for (const e of entries) {
      const clock = e.single ? parseClock(cfg.combinedStart) : parseClock((schedule.serviceTimes || [])[e.svc]);
      const start = parseIso(e.date);
      start.setMinutes(clock == null ? 9 * 60 : clock);
      const end = new Date(start.getTime() + cfg.eventMinutes * 60000);
      const label = ROLE_LABEL[e.role];
      let summary = 'AV: ' + label + ' - ' + e.timeLabel;
      let desc = 'Role: ' + label + '\nService: ' + e.timeLabel;
      if (e.coversScreens) { summary += ' (also covers Screens)'; desc += '\nNo one is on Screens - please cover slides too.'; }
      if (e.others.length) desc += '\nWith: ' + e.others.map((o) => o.name + ' (' + ROLE_LABEL[o.role] + ')').join(', ');
      lines.push('BEGIN:VEVENT',
        'UID:' + icsEscape(volId + '-' + e.date + '-' + e.svc + '-' + e.role) + '@avscheduler',
        'DTSTAMP:' + stampUtc,
        'DTSTART:' + icsStamp(start),
        'DTEND:' + icsStamp(end),
        'SUMMARY:' + icsEscape(summary),
        'DESCRIPTION:' + icsEscape(desc),
        'END:VEVENT');
    }
    lines.push('END:VCALENDAR');
    return lines.map(fold).join('\r\n') + '\r\n';
  }

  function download(filename, text, mime) {
    const blob = new Blob([text], { type: mime || 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  AV.util = {
    pad, iso, parseIso, monthKey, fmtLong, fmtMed, fmtMonthYear,
    sundaysInRange, upcomingSundays, parseClock, escapeHtml,
    ROLES, ROLE_LABEL, generate, entriesFor, buildIcs, download
  };
})();
