// ------------------------------------------------------------------
// Settings you may want to change.
// ------------------------------------------------------------------
window.AV_CONFIG = {
  // Paste your Firebase web-app config here to turn on SHARED mode
  // (volunteers and manager all see the same data). See README.md.
  // Leave as null for DEMO mode: data stays in this one browser only.
  //
  // Example:
  // firebase: {
  //   apiKey: "AIza...",
  //   authDomain: "your-project.firebaseapp.com",
  //   projectId: "your-project",
  //   appId: "1:123:web:abc"
  // },
  firebase: null,

  // Starting service times, editable later on the manager page.
  serviceDefaults: ['8:30', '9:45', '11:00'],

  // Start time used for Sundays flagged as a single combined service.
  combinedStart: '10:00',

  // Length of each calendar event in the .ics files volunteers can download.
  eventMinutes: 90,

  // How many months ahead the volunteer page shows Sundays.
  monthsAhead: 6
};
