// Builds the weekly AV report from Firestore (public-read data) and prints Markdown.
// Run by .github/workflows/weekly-report.yml. Needs Node 18+.
const fs = require('fs');

const DAYS = 7;
const val = (v) => {
  if (!v) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(val);
  if ('mapValue' in v) { const o = {}; const f = v.mapValue.fields || {}; Object.keys(f).forEach((k) => { o[k] = val(f[k]); }); return o; }
  return null;
};
const plain = (doc) => { const o = {}; Object.keys(doc.fields || {}).forEach((k) => { o[k] = val(doc.fields[k]); }); o._id = doc.name.split('/').pop(); return o; };

async function listAll(base, collection, fetchFn) {
  let out = [], token = '';
  do {
    const r = await fetchFn(base + '/' + collection + '?pageSize=300' + (token ? '&pageToken=' + encodeURIComponent(token) : ''));
    if (!r.ok) throw new Error(collection + ': HTTP ' + r.status);
    const j = await r.json();
    out = out.concat((j.documents || []).map(plain));
    token = j.nextPageToken || '';
  } while (token);
  return out;
}

function sunLabel(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
function monthLabel(key) {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

function buildReport({ volunteers, entries, settings, now }) {
  const open = (settings && settings.openMonths || []).slice().sort();
  const openedAt = (settings && settings.openedAt) || {};
  const entryBy = {}; entries.forEach((e) => { entryBy[e._id] = e; });
  const active = volunteers.filter((v) => !v.disabled).sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const since = now - DAYS * 86400000;
  const today = new Date(now).toISOString().slice(0, 10);

  // Who is still owed an answer: never saved, or has not saved since the newest month was opened.
  const newestOpen = open.reduce((t, m) => Math.max(t, openedAt[m] || 0), 0);
  const changed = [], waiting = [];
  active.forEach((v) => {
    const e = entryBy[v._id] || {};
    const t = e.updatedAt || 0;
    if (t >= since) changed.push({ v, e, t });
    if (open.length && (!t || (newestOpen && t < newestOpen))) waiting.push({ v, t });
  });
  changed.sort((a, b) => b.t - a.t);

  const L = [];
  L.push('## AV scheduling weekly update', '');
  L.push('Open months: ' + (open.length ? open.map(monthLabel).join(', ') : '**none** (volunteers cannot enter availability right now)'), '');

  L.push('### Changed in the last ' + DAYS + ' days (' + changed.length + ')', '');
  if (!changed.length) L.push('No volunteer saved anything this week.', '');
  changed.forEach(({ v, e, t }) => {
    const out = (e.dates || []).filter((d) => d >= today && (!open.length || open.includes(d.slice(0, 7)))).map(sunLabel);
    L.push('- **' + v.name + '** (' + new Date(t).toISOString().slice(0, 10) + '): out ' + (out.length ? out.join(', ') : 'no upcoming Sundays'));
  });
  if (changed.length) L.push('');

  L.push('### Not updated yet (' + waiting.length + ')', '');
  if (!open.length) L.push('No months are open, so nobody is waiting.', '');
  else if (!waiting.length) L.push('Everyone has responded since the latest month was opened.', '');
  else {
    waiting.forEach(({ v, t }) => L.push('- ' + v.name + (t ? ' (last saved ' + new Date(t).toISOString().slice(0, 10) + ')' : ' (never saved)')));
    L.push('');
  }
  L.push('_Open the manager page for the full grid._');
  return L.join('\n');
}

async function main() {
  const cfgText = fs.readFileSync('js/config.js', 'utf8');
  const m = /projectId:\s*["']([^"']+)["']/.exec(cfgText);
  if (!m) throw new Error('No Firebase projectId found in js/config.js (is the site still in demo mode?)');
  const base = 'https://firestore.googleapis.com/v1/projects/' + m[1] + '/databases/(default)/documents';
  const f = (u) => fetch(u);
  const [volunteers, entries] = await Promise.all([listAll(base, 'volunteers', f), listAll(base, 'unavailability', f)]);
  const sr = await f(base + '/meta/settings');
  const settings = sr.ok ? plain(await sr.json()) : {};
  console.log(buildReport({ volunteers, entries, settings, now: Date.now() }));
}

module.exports = { buildReport, plain };
if (require.main === module) main().catch((e) => { console.error(e.message); process.exit(1); });
