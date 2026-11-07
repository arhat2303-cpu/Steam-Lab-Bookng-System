# STEAM Lab Booking System

A single-file, offline-capable school 3D-printer booking portal. The app keeps its page, styles, JavaScript, and generated icons in one `dist/index.html`; it makes no external runtime requests for fonts, images, scripts, analytics, or a backend.

The original design, responsive layout, request workflow, STL/G-code estimator, scheduler, reports, serial-pool tools, settings, backups, and self-test route are preserved. This update adds a functional account-management and authentication layer without a visual redesign.

## Start state and accounts

A clean install starts with **exactly two permanent administrator accounts**:

- `ARHATSHAH8149`
- `RUTHVIKA20`

Their passwords are **not** stored as plaintext in source, `dist/index.html`, the UI, this README, exports, database responses, or browser-visible account objects. Only per-account salted hashes are embedded. Both accounts have identical full administrator permissions and fixed, protected records.

There are **no pre-created student accounts, teacher accounts, student serial numbers, or booking requests**. All sample student/teacher accounts and sample login credentials have been removed. The website does not display issued or sample credentials anywhere.

A signed-out user sees the same three role buttons: Student, Teacher, and Admin. Selecting a role opens a sign-in form with **only Username and Password**. No name, class, or serial field is requested at login.

### Administrator account management

Only an authenticated administrator can open administrator views or call account-management APIs. The Accounts workspace can:

- create a student with **Full Name, Class, Student Serial Number, Username, and Password**;
- create a teacher with **Full Name, Username, and Password**;
- edit and delete student/teacher accounts, including usernames and passwords;
- view every registered user and its role, class, serial, status, and creation date;
- generate and export serials, assign free serials, save settings, export reports/backups, import a validated backup, and restore factory accounts.

Permanent administrator accounts are visible as permanent records but have no edit or delete controls, and the API rejects changes to them. Usernames are unique case-insensitively. Student serial numbers are unique and must match `STU-####`; teacher serials are optional. Incorrect credentials return an inline “Username or password is incorrect.” error without exposing whether the username exists.

### Automatic registered identity

After a student or teacher signs in, the registered account details are loaded automatically from the admin-created record and displayed in a read-only **Registered account** panel:

- students see Full Name, Username, Class, and Student Serial Number;
- teachers see Full Name, Username, Role, and any optional issued serial;
- administrators see Full Name, Username, Role, and full account scope.

Students and teachers cannot edit these identity details, cannot open the administrator dashboard, and cannot reach administrator views by changing the URL hash. Logging out clears the session and returns to the role-specific login page.

## Authentication and data handling

This is a static client-side application, so authentication is enforced in the bundled app layer, not by a server-side session service. For a real multi-user deployment with mutually untrusted users, a server-side identity provider or backend is still the appropriate production boundary.

Within that constraint, the implementation uses:

- deterministic **8,000-round iterated salted SHA-256** password verification with a random per-account salt and stored `hashIterations`;
- no WebCrypto dependency, so the same verifier works in normal tabs, `file://`, and `sandbox="allow-scripts"` iframes;
- constant-time hexadecimal hash comparison;
- `publicAccount()` responses and credential-free sessions that strip `salt`, `passwordHash`, `hashIterations`, and any `password` field;
- `requireSession()` / `requireAdmin()` API guards, session-bound workflow wrappers, own-file download checks, and UI route guards;
- strict `steamlab-db-v2` validation that rejects plaintext password fields, duplicate usernames/serials, invalid hashes, and altered permanent administrator hashes;
- automatic replacement of invalid or older local data with the clean two-administrator factory database.

Passwords are never rendered after account creation. Password changes create a new random salt and a new iterated hash.

Persistence uses `localStorage` for the database and IndexedDB for uploaded file bytes. When browser storage is blocked, the app shows an in-memory-mode notice and keeps database/files in memory for the current page. The in-app `#selftest` route builds an isolated temporary store and never reads or writes the live database.

## Build and deployment

```sh
npm test
node build.mjs
```

- Build command: `node build.mjs`
- Publish directory: `dist`
- `/index.html` header: `Cache-Control = "no-cache"`
- Intended Netlify site name: `steam-lab-booking-system` — no random suffix; if that exact name is unavailable, stop rather than accepting a substitute.

`netlify.toml` already contains those build, publish, and cache settings. The repository is pushed to GitHub; the GitHub-to-Netlify connection and deployment are handled by the site owner. No Netlify site was created or deployed from this workspace, and no live URL should be treated as verified.

`dist/index.html` is generated and should not be hand-edited. `steam-lab-booking-system.zip` is a convenience archive of the source, configuration, tests, and built artifact; it is ignored by Git.

## Verification

Automated checks run in Node and headless Chromium:

```sh
node tests/scheduler.test.mjs
node tests/accounts.test.mjs
node build.mjs
```

Latest results:

- `node --check`: PASS for 10 JavaScript/ESM source files.
- Scheduler/estimator tests: **12/12 PASS**.
- Account/authentication tests: **9/9 PASS** — factory start state, both admin usernames, salted login, iterated verification, public-account sanitization, forged-actor session rejection, duplicate username/serial rejection, admin-only CRUD, permanent-admin protection, and student/teacher CRUD.
- In-page `#selftest`: **12/12 PASS** in a browser and in isolated Node execution.
- `node build.mjs`: one self-contained `dist/index.html` with 7 inlined modules and no external URLs, `fetch`, WebCrypto, native dialogs, source references, TODOs, or placeholder text.
- Static scans: no plaintext administrator passwords, old demo credentials, or demo account seeds in source, `dist`, UI, README, exports, or database responses.

Headless Chromium E2E covered three contexts: a normal tab, a `sandbox="allow-scripts"` iframe with blocked localStorage, and the generated `file://` artifact. Each context had zero console errors, zero page errors, and zero external runtime requests.

The required account-management acceptance sequence passed:

1. **Both administrator accounts** signed in and opened the full admin dashboard.
2. An administrator **created a student** with Full Name, Class, Student Serial Number, Username, and Password.
3. The student **signed in with Username and Password only**.
4. Full Name, Class, and Student Serial Number **appeared automatically** and were read-only.
5. An administrator **created and tested a teacher account**.
6. The teacher signed in **without entering a name manually**; registered identity appeared automatically.
7. Student and teacher accounts **could not access administrator features**, including by direct URL hash.
8. The clean factory database contained **only the two permanent administrators**, with no sample student/teacher accounts, credentials, serials, or requests.

Additional regression checks passed: duplicate username/serial inline errors, wrong-password inline error, logout to login page, account edit/delete, reload/reopen persistence, mobile viewport with no document overflow, binary STL mesh estimate, request submit/download/cancel, teacher approval and full workflow, schedule block `0 → 1`, generated serials, settings save, CSV exports, `steamlab-backup-v2` export/import, factory reset, offline navigation, and the in-page self-test.

## Repository layout

- `index.html` — source shell; replaced by `dist/index.html` at build time.
- `src/core.js` — storage helpers, SHA-256, salts, iterated password verification, IDs, dates, file bytes.
- `src/db.js` — v2 factory database, validation, normalization, public account projection, serial helpers.
- `src/api.js` — authentication, sessions, account CRUD, requests, workflow, scheduler, reports, backups, and role guards.
- `src/scheduler.js`, `src/estimate.js` — unchanged scheduler and STL/G-code estimator.
- `src/ui.js`, `src/styles.css` — preserved layout/design with simplified login, account identity panel, and admin account fields.
- `src/selftest.js` — isolated in-app self-test.
- `tests/scheduler.test.mjs`, `tests/accounts.test.mjs` — Node test suites.
- `build.mjs` — inlines all modules/CSS into the single-file artifact.
- `netlify.toml` — exact build/publish/cache settings.
- `dist/index.html` — generated deliverable.
