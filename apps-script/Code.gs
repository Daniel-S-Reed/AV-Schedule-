/**
 * Creates a Gmail DRAFT (never sends) when the manager page asks for one.
 * Deploy as a Web app: Execute as "Me", Who has access "Anyone".
 *
 * Safety: every request must carry a valid Firebase sign-in token belonging to the
 * email in ALLOWED (by default, the Google account that owns this script).
 */
const FIREBASE_API_KEY = 'PASTE-YOUR-FIREBASE-apiKey-HERE'; // same apiKey as in js/config.js
const EXTRA_ALLOWED = [];   // optional extra manager emails, e.g. ['assistant@gmail.com']

function doPost(e) {
  try {
    const d = JSON.parse(e.postData.contents);
    const caller = verify_(d.idToken);
    const allowed = [Session.getEffectiveUser().getEmail().toLowerCase()].concat(EXTRA_ALLOWED.map(function (x) { return x.toLowerCase(); }));
    if (allowed.indexOf(caller) < 0) return out_({ ok: false, error: 'This sign-in (' + caller + ') is not allowed to create drafts.' });

    const to = (d.to || []).filter(function (x) { return /^\S+@\S+\.\S+$/.test(x); });
    if (!to.length) return out_({ ok: false, error: 'No valid recipients.' });
    GmailApp.createDraft(to.join(','), String(d.subject || ''), String(d.body || ''));
    return out_({ ok: true });
  } catch (err) {
    return out_({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

// Asks Firebase who this token belongs to; throws if the token is missing or invalid.
function verify_(idToken) {
  if (!idToken) throw new Error('Not signed in.');
  const res = UrlFetchApp.fetch('https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' + FIREBASE_API_KEY, {
    method: 'post', contentType: 'application/json', payload: JSON.stringify({ idToken: idToken }), muteHttpExceptions: true
  });
  const j = JSON.parse(res.getContentText());
  if (!j.users || !j.users.length) throw new Error('Sign-in could not be verified. Sign in to the manager page again.');
  return String(j.users[0].email || '').toLowerCase();
}

function out_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
