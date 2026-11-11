# STEAM Lab Booking System

A single-file, offline-capable school 3D-printer booking portal. The app keeps its page, styles, JavaScript, generated icons, and vendored XLSX ZIP helper in one `dist/index.html`; it makes no external runtime requests for fonts, images, scripts, analytics, a backend, or an Excel library.

The original design, responsive layout, request workflow, STL/G-code estimator, scheduler, reports, serial-pool tools, settings, backups, and self-test route are preserved. This update corrects the three landing role icons and replaces the separate Accounts workspace with a single, fully functional Serials workspace, without a redesign.

## Start state and accounts

A clean install starts with **exactly three permanent administrator accounts**:

- `ARHATSHAH8149` — display name **ARHAT SHAH**
- `ruthvikabrs123` — display name **RUTHVIKA VANKADHARA**
- `SHASHI1234` — display name **Shashmith Chatterjee**

The protected password hashes are unchanged; the second administrator's login username is `ruthvikabrs123`, and the third administrator is `SHASHI1234` with display name **Shashmith Chatterjee**. The previous second-administrator username is retired and no longer signs in. Existing local databases are migrated automatically to the current usernames and to the three protected administrators on load, preserving settings, accounts, serials, and requests. Their passwords are **not** stored as plaintext in source, `dist/index.html`, the UI, this README, exports, database responses, or browser-visible account objects. Only per-account salted hashes are embedded. All three permanent accounts have identical full administrator permissions and fixed, protected records.

There are **no pre-created student accounts, teacher accounts, serial numbers, or booking requests**. No sample student/teacher accounts or sample login credentials remain, and the website does not display issued credentials anywhere.

A signed-out user sees the same three role buttons: Student, Teacher, and Admin. All three icon badges and SVGs are consistently sized and centred on desktop and mobile without changing surrounding text, buttons, colours, or backgrounds. Selecting a role opens a sign-in form with **only Username and Password**.

### Serial management workspace

The separate Account Management / Accounts navigation entry, view, form, list, and actions have been removed. The existing **Serials** section remains and now begins with two clearly distinguishable mode cards: **Student Serials** and **Teacher Serials**. Only an authenticated administrator can open this view or call its APIs.

Individual records support create, view, edit, and delete:

- Student fields: **Student Full Name, Class, Student Serial Number, Username, Password**.
- Teacher fields: **Teacher Full Name, Teacher Serial Number (if applicable), Username, Password**.
- Full name and username are separate fields. Usernames and passwords are never auto-generated and are never derived from a full name.
- Saving creates one serial record and one linked login account. Password values are hashed immediately and are not rendered after entry.
- Editing synchronises the account name, class, serial, username, status, and optional password reset. A blank edit password preserves the existing hash.
- Deleting asks for confirmation, removes the linked login account and serial record, and preserves existing requests in reports.
- Student codes match `STU-####`; teacher codes match `T-####` and are optional. A blank teacher serial creates no serial-pool record.

**Bulk Generate** accepts multiple student or teacher rows using the same fields. Every valid row creates a linked serial and login account. Validation rejects duplicate serial numbers and usernames within the batch and against the existing database, missing required fields, incorrect formats, and short or invalid passwords. The result shows a clear successful/unsuccessful report.

### Excel template and import

The Serials workspace contains **Download Excel Template** and **Upload Excel File**. The generated `.xlsx` is a real two-sheet, frozen-header OOXML workbook created offline with the vendored MIT-licensed `fflate` ZIP helper:

- `Student Serials`: `Full Name | Class | Serial Number | Username | Password`
- `Teacher Serials`: `Full Name | Serial Number (if applicable) | Username | Password`

Upload reads every populated row, detects duplicates and incomplete/incorrect records, and shows a preview with “Provided”/“Missing” password status before final confirmation. No password value is shown in the preview. **Confirm import** creates all valid linked serial records and login accounts without manual recreation, then shows a success/error report. CSV serial export and the existing free-code assignment controls remain available. The HTTP-looking strings in the built artifact are inert OOXML XML namespace identifiers, not network requests.

### Administrator accounts

The Serials workspace also contains an **Administrator accounts** section. Any authenticated administrator can create another administrator with a separate Full Name, Username, and Password. Added administrators have full administrator permissions, including the ability to add further administrators. They are non-permanent, so another administrator can edit their name, username, password, active status, or delete them with confirmation. The three built-in permanent administrators are protected from editing and deletion, and the last active administrator cannot be deleted or deactivated. Admin-created accounts never contain plaintext passwords in the database or public responses.

### Registered identity and password changes

After sign-in, registered account details are loaded automatically from the administrator-created record and displayed in a read-only **Registered account** panel. Students see Full Name, Username, Class, and Student Serial Number; teachers see Full Name, Username, Role, and any optional issued serial; administrators see Full Name, Username, Role, and full account scope.

Students and teachers can open **Change password** and must enter **Current Password, New Password, Confirm New Password**. The current password is verified, the new and confirmation values must match, and the new salted hash applies immediately to future sign-ins. They cannot change their username, serial number, class, or registered name. Administrator password reset remains available in the serial edit form. Logging out clears the session and returns to the role-specific login page.

## Authentication and data handling

This is a static client-side application, so authentication is enforced in the bundled app layer, not by a server-side session service. For a real multi-user deployment with mutually untrusted users, a server-side identity provider or backend is still the appropriate production boundary.

Within that constraint, the implementation uses:

- deterministic **8,000-round iterated salted SHA-256** password verification with a random per-account salt and stored `hashIterations`;
- no WebCrypto dependency, so the same verifier works in normal tabs, `file://`, and `sandbox="allow-scripts"` iframes;
- constant-time hexadecimal hash comparison;
- `publicAccount()` responses and credential-free sessions that strip `salt`, `passwordHash`, `hashIterations`, and any `password` field;
- `requireSession()` / `requireAdmin()` guards on authentication, account, serial, bulk, Excel, export, and workflow APIs, plus UI route guards;
- strict `steamlab-db-v2` validation that rejects plaintext password fields, duplicate usernames/serials, invalid hashes, and altered permanent administrator hashes;
- automatic replacement of invalid local data with the clean three-administrator factory database, plus in-place migration for valid older databases.

Passwords are never rendered after account creation. Password changes create a new random salt and a new iterated hash. Serial records and login accounts are synchronised on create, edit, delete, bulk import, and Excel import.

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
node tests/serials.test.mjs
node build.mjs
```

Latest results:

- `node --check`: PASS for all source, build, and test JavaScript/ESM files.
- Scheduler/estimator tests: **12/12 PASS**.
- Account/authentication tests: **14/14 PASS** — three-admin factory start state, requested display names, all current admin usernames, retired-username and third-admin migrations without data loss, admin-created/nested/edited/deleted administrators, permanent-admin protection, salted login, iterated verification, public-account sanitization, forged-actor session rejection, duplicate username/serial rejection, admin-only CRUD, student/teacher CRUD, and self-service password changes.
- Serial/XLSX tests: **6/6 PASS** — real two-sheet workbook, exact headers, row parsing with separate full-name/username fields, duplicate/incomplete validation, synchronised bulk creation, hashed sanitized records, edit/delete synchronisation, and persisted display-name normalization.
- In-page `#selftest`: **12/12 PASS** in a browser and in isolated Node execution.
- `node build.mjs`: one self-contained `dist/index.html` with 10 inlined modules, no external runtime requests, no external source references, no `fetch`, no WebCrypto dependency, no native dialogs, no TODOs, and no placeholder text. All URL-like strings are OOXML namespace identifiers.
- Static scans: no plaintext administrator passwords, retired administrator username, old demo credentials, demo account seeds, or test-fixture password values in `dist`, UI, README, exports, previews, reports, or persisted database responses. The generated database never stores plaintext passwords.
- Admin-management E2E: creation by a permanent administrator, nested creation by an added administrator, edit, sign-in with the changed password, deletion with confirmation, and permanent-admin protection all PASS.

Headless Chromium E2E covered four contexts: a normal tab, a retired-username migration tab, a `sandbox="allow-scripts"` iframe with blocked localStorage, and the generated `file://` artifact. Each context had zero console errors, zero page errors, and zero external runtime requests.

The requested acceptance checks passed in the normal browser:

1. Landing role icon size/position/alignment on desktop and mobile, with zero horizontal overflow.
2. Individual Student Serial creation with all five fields and a linked login account.
3. Individual Teacher Serial creation with all required fields and a linked login account.
4. Serial edit and delete, including synchronised account records, confirmation, blank-password preservation, and administrator password reset.
5. Bulk Generate with one valid, one duplicate, and one incomplete row; correct summary and persisted valid account.
6. Excel template download; SheetJS validation confirmed both sheet names and exact headers.
7. Excel upload, preview before confirmation, final import, and success/error report without manual recreation.
8. Duplicate username/serial and missing-field detection in individual, bulk, and Excel flows.
9. Student and teacher self-service password changes with wrong-current, mismatch, old-password rejection, and new-password sign-in.
10. Administrator access restrictions for student/teacher roles, including direct URL hashes and no removed Accounts controls.
11. All three permanent administrator sign-ins plus admin-created administrator creation, nested creation, edit, sign-in, delete, and permanent-admin protection.

Additional checks passed: all three administrator display names, new-username sign-in, retired-username rejection, migration with preserved settings, persistence after reload, every admin view rendering, preserved serial CSV export, settings save, factory reset, offline navigation, in-page self-test, and the clean three-administrator factory database with zero student/teacher accounts, serials, or requests.

## Repository layout

- `index.html` — source shell; replaced by `dist/index.html` at build time.
- `src/core.js` — storage helpers, SHA-256, salts, iterated password verification, IDs, dates, file bytes.
- `src/db.js` — v2 factory database, validation, normalization, public account projection, serial helpers.
- `src/fflate.js` — vendored MIT-licensed ZIP helper used offline by the XLSX module.
- `src/xlsx.js` — offline `.xlsx` template builder and workbook parser.
- `src/serials.js` — serial validation, duplicate checks, account/serial synchronisation, CRUD, bulk application, and safe reports.
- `src/api.js` — authentication, sessions, account CRUD, serial/XLSX/bulk APIs, password changes, requests, workflow, scheduler, reports, backups, and role guards.
- `src/scheduler.js`, `src/estimate.js` — unchanged scheduler and STL/G-code estimator.
- `src/ui.js`, `src/styles.css` — preserved layout/design with corrected role icons, registered identity, password change, combined Serials workspace, and administrator account management.
- `src/selftest.js` — isolated in-app self-test.
- `tests/scheduler.test.mjs`, `tests/accounts.test.mjs`, `tests/serials.test.mjs` — Node test suites.
- `build.mjs` — inlines all modules/CSS into the single-file artifact.
- `netlify.toml` — exact build/publish/cache settings.
- `dist/index.html` — generated deliverable.
