# AV Team Scheduling - website version

Two pages, no build step, no installs:

| Page | File | Who uses it |
|---|---|---|
| Volunteer page | `index.html` | Each volunteer: pick your name, choose the service you prefer to work, mark Sundays you can't serve, see your schedule once it's published, download your own calendar file |
| Manager page | `manager.html` | You: add / disable / remove volunteers and set the positions they can fill, see everyone's entries, generate / edit / publish the schedule, print it |

The scheduling rules are the same as your desktop app: people stay on their usual service where possible, nobody is double-booked in one service, Screens may be left blank (Audio covers it), single-service Sundays are supported (calendar files use 10:00 AM for those), and "times served" is used to balance who gets picked.

## How it stores data

GitHub Pages only hosts files, so it can't save what volunteers enter. This site uses **Firebase** (Google, free tier) as the shared database. Until you connect it, the site runs in **demo mode**: data lives only in the browser you're using. That's fine for trying it out on one computer, but volunteers on other devices will not see your data.

## Part 1 - Connect Firebase (about 10 minutes, once)

1. Go to <https://console.firebase.google.com> and **Add project** (turn Google Analytics off).
2. **Build > Firestore Database > Create database**. Pick a location near you and start in **production mode**.
3. **Build > Authentication > Get started > Email/Password > Enable**. Then open the **Users** tab and **Add user** with the email and password you'll use to sign in to the manager page.
4. Click the gear icon > **Project settings** > scroll to **Your apps** > click the web icon `</>` > register the app. Copy the `firebaseConfig` values it shows.
5. Open `js/config.js` and replace `firebase: null,` with your values, for example:

   ```js
   firebase: {
     apiKey: "AIza...",
     authDomain: "your-project.firebaseapp.com",
     projectId: "your-project",
     appId: "1:123:web:abc"
   },
   ```
6. **Firestore Database > Rules** tab: replace everything with the contents of `firestore.rules` (in this folder), check the manager email at the top, and **Publish**. Volunteers need no sign-in; only you (signed in on the manager page) can change names, settings and the schedule, and only you can read the email addresses.
7. **Authentication > Settings > Authorized domains > Add domain**: add `YOUR-GITHUB-USERNAME.github.io` (needed for manager sign-in to work on your live site).

## Part 2 - Put it on GitHub Pages

1. On github.com create a new repository (for example `av-schedule`).
2. **Add file > Upload files**, then drag in everything from this folder (`index.html`, `manager.html`, and the `css` and `js` folders). Commit.
3. **Settings > Pages > Build and deployment**: Source = *Deploy from a branch*, Branch = `main`, folder = `/ (root)`. Save.
4. After a minute your site is at `https://YOUR-USERNAME.github.io/av-schedule/`.
   - Give volunteers the main link (it opens the volunteer page).
   - Bookmark `.../manager.html` for yourself.

## Using it

1. **Manager > Volunteers**: add everyone and tick the positions they're comfortable with (only you can set these). Volunteers appear in the name list on the volunteer page once you've added them.
   - **Disable** keeps someone on your list (and keeps their times-served count) but they are never scheduled and disappear from the volunteer page. Click **Enable** to bring them back.
   - **Remove** permanently deletes them and their saved entries.
   - If you disable or remove someone who is already in the current schedule, you'll get a reminder; change their slots or regenerate.
2. Volunteers open the site, choose their name, pick the **service they prefer to work**, tap the Sundays they can't serve, and press **Save**. They can come back and change it any time. The generator keeps people on their preferred service whenever the roster allows, and only moves someone to another service when that service would otherwise go unfilled. You can see each person's preference in the Volunteers table.
3. **Manager > Availability entries** starts with **Release months**: volunteers can only mark Sundays in months you have opened. Click a month to open or close it, or use "Open the next N months". Nothing is open at first, so open a month before asking volunteers to respond. Closing a month hides it but keeps what people already entered. Below that, the page shows everyone's answers in one grid (with a count of available people under each Sunday). You can click a cell to enter something someone emailed you.
4. **Manager > Schedule**: pick the month(s), set service times, tick any single-service Sundays, then **Generate**. Change any slot with the dropdowns (unavailable people are flagged yellow, empty Audio/Camera slots red).
5. **Publish to volunteers** when you're happy. Until then volunteers see "not released yet". Edits after publishing go live immediately.
6. **Add to served counts** once the schedule is final, so future schedules keep balancing.
7. **Print / Save as PDF** gives a sheet laid out like your August Word draft (Date headers, Audio / Screens / Camera columns).

## Things worth knowing

- **Trust model.** Volunteers don't sign in: anyone with the link can pick any name and edit that person's availability and preferred service. That is usually fine for a church team, but it is not private. Positions, disabling, removing, email addresses and the schedule are protected by your manager sign-in plus the rules above.
- **"Unpublished" hides the schedule on the page, not in the database.** Someone technical who inspects the site could read a draft. Don't put anything sensitive in it.
- **Your repository and `config.js` are public if the repo is public.** That's normal for Firebase web config (it identifies your project but doesn't grant access). The rules above are what actually protect your data.
- **Sundays only.** The date picker lists Sundays, matching the desktop app.
- **No Word export on the website.** Use Print / Save as PDF, or keep using the desktop app for the `.docx`.
- I tested the scheduling, date and calendar code with automated checks, but I could not open the pages in a real browser or connect to a live Firebase project from here. If something looks off on first use, tell me what you see.

## Part 3 - Gmail drafts (emailing the team)

The **Email** tab on the manager page can build a reminder ("please send your availability for November") or the schedule, and put it into your Gmail **as a draft** addressed to everyone selected. It never sends anything itself.

1. Go to <https://script.google.com> (signed in as the Gmail account you want drafts in) > **New project**.
2. Delete the sample code and paste in everything from `apps-script/Code.gs`.
3. Near the top, replace `PASTE-YOUR-FIREBASE-apiKey-HERE` with the `apiKey` from `js/config.js`.
4. **Deploy > New deployment > Select type: Web app**. Set **Execute as: Me** and **Who has access: Anyone**. Click **Deploy**, then **Authorize access** and approve (Gmail drafts and "connect to an external service"). Google may show an "unverified app" warning because it is your own script: choose Advanced > Go to project.
5. Copy the **Web app URL** (ends in `/exec`) and put it in `js/config.js` as `draftEndpoint: 'https://script.google.com/macros/s/.../exec',`.
6. If you edit the script (for example to paste a newer `Code.gs`), use **Deploy > Manage deployments > Edit > New version** so the same URL keeps working.

"Anyone" only means anyone can reach the URL: the script checks that the request carries a valid Firebase sign-in for the script owner's own email, and refuses everything else. It can only create drafts, not send.

## Part 4 - Weekly report (optional)

`.github/workflows/weekly-report.yml` posts a weekly summary (who changed their availability, who hasn't responded) as an issue in your repo, and GitHub emails it to you. Test it from **Actions > Weekly AV update > Run workflow**. No extra accounts are needed with the standard rules.
