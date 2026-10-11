// Storage layer. Two interchangeable back ends:
//   - "local"    : browser localStorage (demo mode, nothing is shared)
//   - "firebase" : Firestore (shared by everyone who opens the site)
(function () {
  const AV = (window.AV = window.AV || {});
  const cfg = window.AV_CONFIG;
  const mode = cfg.firebase ? 'firebase' : 'local';

  const uid = () => 'v' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const sortByName = (arr) => arr.sort((a, b) => a.name.localeCompare(b.name));

  /* ----------------------------- local (demo) ----------------------------- */
  const KEY = 'av-scheduler-demo';
  const L = {
    load() { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } },
    save(d) { localStorage.setItem(KEY, JSON.stringify(d)); }
  };

  const local = {
    async listVolunteers() { return sortByName([...(L.load().volunteers || [])]); },
    async saveVolunteer(v) {
      const d = L.load();
      d.volunteers = d.volunteers || [];
      const rec = { ...v };
      if (!rec.id) rec.id = uid();
      const i = d.volunteers.findIndex((x) => x.id === rec.id);
      if (i >= 0) d.volunteers[i] = rec; else d.volunteers.push(rec);
      L.save(d);
      return rec.id;
    },
    async deleteVolunteer(id) {
      const d = L.load();
      d.volunteers = (d.volunteers || []).filter((v) => v.id !== id);
      if (d.entries) delete d.entries[id];
      L.save(d);
    },
    // An "entry" is what a volunteer submits about themselves:
    //   { dates: [unavailable Sundays], preferred: service index or null }
    async getAllEntries() {
      const e = L.load().entries || {}, out = {};
      Object.keys(e).forEach((id) => { out[id] = { dates: e[id].dates || [], preferred: e[id].preferred == null ? null : e[id].preferred, updatedAt: e[id].updatedAt || 0 }; });
      return out;
    },
    async getEntry(id) {
      const e = (L.load().entries || {})[id] || {};
      return { dates: e.dates || [], preferred: e.preferred == null ? null : e.preferred };
    },
    async setEntry(id, partial) {
      const d = L.load();
      d.entries = d.entries || {};
      d.entries[id] = Object.assign({}, d.entries[id], partial);
      L.save(d);
    },
    async getSettings() { return L.load().settings || null; },
    async saveSettings(s) { const d = L.load(); d.settings = s; L.save(d); },
    async getSchedule() { return L.load().schedule || null; },
    async saveSchedule(s) { const d = L.load(); d.schedule = s; L.save(d); },
    // Volunteer email addresses (who may sign in). Stored as [{email, volunteerId}].
    async listMembers() {
      const m = L.load().members || {};
      return Object.keys(m).map((email) => ({ email, volunteerId: m[email].volunteerId }));
    },
    async saveMember(email, volunteerId) { const d = L.load(); d.members = d.members || {}; d.members[email] = { volunteerId }; L.save(d); },
    async deleteMember(email) { const d = L.load(); if (d.members) delete d.members[email]; L.save(d); },
    async getIdToken() { return null; },
    auth: {
      needsLogin: false,
      onChange(cb) { cb({ demo: true }); },
      async signIn() {},
      async signOut() {}
    }
  };

  /* ----------------------------- firebase ----------------------------- */
  let F = null;
  async function fb() {
    if (F) return F;
    const base = 'https://www.gstatic.com/firebasejs/10.12.2/';
    const [app, fs, au] = await Promise.all([
      import(base + 'firebase-app.js'),
      import(base + 'firebase-firestore.js'),
      import(base + 'firebase-auth.js')
    ]);
    const a = app.initializeApp(cfg.firebase);
    F = { fs, au, db: fs.getFirestore(a), auth: au.getAuth(a) };
    return F;
  }

  const remote = {
    async listVolunteers() {
      const { fs, db } = await fb();
      const snap = await fs.getDocs(fs.collection(db, 'volunteers'));
      return sortByName(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    },
    async saveVolunteer(v) {
      const { fs, db } = await fb();
      const { id, ...rest } = v;
      if (id) { await fs.setDoc(fs.doc(db, 'volunteers', id), rest); return id; }
      const ref = await fs.addDoc(fs.collection(db, 'volunteers'), rest);
      return ref.id;
    },
    async deleteVolunteer(id) {
      const { fs, db } = await fb();
      await fs.deleteDoc(fs.doc(db, 'volunteers', id));
      await fs.deleteDoc(fs.doc(db, 'unavailability', id));
    },
    // Stored in the "unavailability" collection (the one volunteers may write to),
    // so volunteers can set their dates and preferred service but nothing else.
    async getAllEntries() {
      const { fs, db } = await fb();
      const snap = await fs.getDocs(fs.collection(db, 'unavailability'));
      const out = {};
      snap.docs.forEach((d) => {
        const x = d.data();
        out[d.id] = { dates: x.dates || [], preferred: x.preferred == null ? null : x.preferred, updatedAt: x.updatedAt || 0 };
      });
      return out;
    },
    async getEntry(id) {
      const { fs, db } = await fb();
      const snap = await fs.getDoc(fs.doc(db, 'unavailability', id));
      const x = snap.exists() ? snap.data() : {};
      return { dates: x.dates || [], preferred: x.preferred == null ? null : x.preferred };
    },
    async setEntry(id, partial) {
      const { fs, db } = await fb();
      await fs.setDoc(fs.doc(db, 'unavailability', id), partial, { merge: true });
    },
    async getSettings() {
      const { fs, db } = await fb();
      const snap = await fs.getDoc(fs.doc(db, 'meta', 'settings'));
      return snap.exists() ? snap.data() : null;
    },
    async saveSettings(s) {
      const { fs, db } = await fb();
      await fs.setDoc(fs.doc(db, 'meta', 'settings'), s);
    },
    async getSchedule() {
      const { fs, db } = await fb();
      const snap = await fs.getDoc(fs.doc(db, 'meta', 'schedule'));
      return snap.exists() ? snap.data() : null;
    },
    async saveSchedule(s) {
      const { fs, db } = await fb();
      await fs.setDoc(fs.doc(db, 'meta', 'schedule'), s);
    },
    async listMembers() {
      const { fs, db } = await fb();
      const snap = await fs.getDocs(fs.collection(db, 'members'));
      return snap.docs.map((d) => ({ email: d.id, volunteerId: d.data().volunteerId }));
    },
    async saveMember(email, volunteerId) {
      const { fs, db } = await fb();
      await fs.setDoc(fs.doc(db, 'members', email), { volunteerId });
    },
    async deleteMember(email) {
      const { fs, db } = await fb();
      await fs.deleteDoc(fs.doc(db, 'members', email));
    },
    async getIdToken() {
      const { auth } = await fb();
      return auth.currentUser ? auth.currentUser.getIdToken() : null;
    },
    auth: {
      needsLogin: true,
      onChange(cb) {
        fb().then(({ au, auth }) => au.onAuthStateChanged(auth, (u) => cb(u)));
      },
      async signIn(email, pw) {
        const { au, auth } = await fb();
        await au.signInWithEmailAndPassword(auth, email, pw);
      },
      async signOut() {
        const { au, auth } = await fb();
        await au.signOut(auth);
      }
    }
  };

  AV.db = Object.assign({ mode }, mode === 'firebase' ? remote : local);
})();
