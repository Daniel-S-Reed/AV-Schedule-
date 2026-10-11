// ------------------------------------------------------------------
// Settings you may want to change.
// ------------------------------------------------------------------
window.AV_CONFIG = {
   notifyAccessKey: '6a96514d-0c66-470a-85f3-6c3497fe0a21',
   draftEndpoint: 'https://script.google.com/macros/s/AKfycbz7PTkjdhjhCnAxTElDbOx95O2r1hSEWIU6vBAr7-9nVFMCzd7GFUiWk5kNbcvQFGxo/exec',
  // Paste your Firebase web-app config here to turn on SHARED mode
  // (volunteers and manager all see the same data). See README.md.
  // Leave as null for DEMO mode: data stays in this one browser only.
  //
  firebase: {
    apiKey: "AIzaSyDvY_mJ1j6Pl0NDzB5uzV7MwfgOGqnzl2o",
    authDomain: "av-scheduler-a5387.firebaseapp.com",
    projectId: "av-scheduler-a5387",
    storageBucket: "av-scheduler-a5387.firebasestorage.app",
    messagingSenderId: "411456420299",
    appId: "1:411456420299:web:6ce61572ec7bdde7905e4e"
  },

  // Starting service times, editable later on the manager page.
  serviceDefaults: ['8:30', '9:45', '11:00'],

  // Start time used for Sundays flagged as a single combined service.
  combinedStart: '10:00',

  // Length of each calendar event in the .ics files volunteers can download.
  eventMinutes: 90,

  // How many months ahead the volunteer page shows Sundays.
  monthsAhead: 6
};
