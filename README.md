# STEAM Lab Booking System

A working request/approval portal for a school STEAM lab with **one 3D printer**. Students upload a model and receive a scheduled print slot once approved; teachers review estimates, approve/reject with adjustments, confirm slots, and run the start → printed → handed-over workflow; admins manage accounts, serials, lab settings, reports, and backups.

There is **no printer hardware integration** and **no 3D-printer fleet-management section**. The schedule is the queue for the single machine.

## Quick start

```bash
node build.mjs
```

Open `dist/index.html` directly as a `file://` document, or serve `dist/` with any static server. The source `index.html` is the maintainable dev shell; `build.mjs` inlines all CSS and JS into the single-file artifact `dist/index.html`.

No runtime npm dependencies, CDN assets, Google Fonts, remote images, analytics, or other external requests are used. The browser build is one classic inline script and one inline stylesheet.

## Demo credentials

| Role | Login ID / username | Serial | Password |
|---|---|---|---|
| Admin | `12345678910` | — | `12345` |
| Teacher | `teacher1` | `T-1041` | `teach123` |
| Student | `student1` | `STU-2001` | `12345` |
| Student | `student2` | `STU-2002` | `12345` |

The landing screen shows exactly three role buttons before any sign-in form. Each role form has a **Fill demo credentials** button that restores that seeded account and fills the fields. Student and teacher serials bind to the account on first successful sign-in; a used serial cannot be reused by another account. `student2` is seeded with auto-approval enabled so the “scheduled slot” branch of the student success panel is exercised; `student1` follows the normal teacher-approval path.

Two example requests are seeded: one approved and scheduled, one pending review. All seeded and uploaded files are downloadable.

## Repository layout

```text
/
├── index.html              shell markup, no inline logic
├── netlify.toml
├── build.mjs               inlines src/* into dist/index.html
├── src/
│   ├── styles.css
│   ├── core.js             storage wrapper, pure-JS SHA-256, time helpers
│   ├── db.js               schema, seed, validation, persistence
│   ├── scheduler.js        pure, DOM-free scheduling engine
│   ├── estimate.js         pure, DOM-free file estimator
│   ├── api.js              operations layer
│   ├── ui.js               rendering + events
│   └── selftest.js         isolated in-page harness
├── tests/scheduler.test.mjs
├── dist/index.html         generated single-file artifact
├── README.md
└── .gitignore
```

`src/scheduler.js` and `src/estimate.js` are importable by Node and have no DOM or storage access.

## Storage and safety

- State is one versioned JSON key: `steamlab_db_v1` in `localStorage`.
- Uploaded file bytes go to IndexedDB; the request record stores a pointer.
- `localStorage` and IndexedDB access are wrapped in `try/catch`. In an opaque sandboxed iframe where storage throws `SecurityError`, the app falls back to in-memory storage and shows a persistent notice. Boot never leaves a white screen: a caught failure renders a visible error panel with the message, stack, and a **Reset app data** button.
- Passwords use salted SHA-256 implemented in pure JavaScript; `crypto.subtle` is not required.
- `file://`, sandboxed iframes, and offline operation are supported.

## Estimator

- `.gcode`, `.gco`, `.g`: reads the slicer’s own `;TIME:<seconds>`, `estimated printing time`, or `M73 R<minutes>` value.
- `.stl`, binary or ASCII: parses triangle meshes, computes signed volume, surface area, and bounding box, then calculates minutes from `volume × infill ÷ 1,800 mm³/min + 0.8 mm shell allowance + setup/travel`. It warns when the mesh exceeds the configured build volume.
- Other supported model/archive/image formats use a clearly labelled file-size estimate.
- Supported model extensions: `.stl .obj .3mf .gcode .gco .g .step .stp .iges .igs .zip .ply .amf`; common image extensions are also accepted.

## Scheduling engine

The scheduler is pure and enforces, in order:

1. `urgent → high → normal → low`, then oldest submitted first.
2. No overlaps and no starts in the past.
3. A 30-minute cool-down gap around every job, visible as hatched reserved blocks.
4. A 7-hour daily printing cap.
5. Lab hours and working days (default Mon–Fri, 08:00–17:00).
6. Long jobs split across working days instead of blocking the queue.
7. A 12-hour minimum lead time from approval.
8. Re-running on completion, collection, cancellation, and settings changes.
9. Printing jobs are locked and never moved.
10. A plain-language placement reason for every reservation.

Admins can configure open/close times, working days, slot length, rest gap, daily cap, minimum lead time, maximum active requests per student, upload size limit, and build volume.

## Admin tools

- Create/edit/delete accounts, set passwords, assign serials, and toggle student auto-approval.
- Bulk-generate `STU-####` / `T-####` serials; the table shows free, assigned, and used/bound codes.
- Reports: jobs by status, printing hours per week, busiest students, average job length, completion rate, and recent activity.
- Data & backup: export DB JSON including uploaded file bytes, import a validated `steamlab-backup-v1` JSON backup, export requests CSV, export serials/report CSV, and reset to demo data behind an in-app confirmation.
- Full teacher workflow plus submitting a request on behalf of a student.

## Self-test

Open `index.html#selftest` (or `dist/index.html#selftest`). It seeds an isolated temporary in-memory store, creates a job, approves it, checks a valid non-overlapping slot with the required cool-down, cancels it, checks persistence in the temporary store, and prints green **PASS** / red **FAIL** with the failing assertion named. It does not read or write the real app database.

## Verification actually performed

Observed on 2026-11-07 in this workspace:

1. `node --check` passed for every `.js` and `.mjs` file, including `build.mjs`, all `src/*.js`, and `tests/scheduler.test.mjs`. The generated inline script was extracted from `dist/index.html` and syntax-checked separately. A scan of the built artifact found no external runtime URLs, no `fetch()` calls, no `alert()` / `confirm()` / `prompt()` calls, and no remaining `src/styles.css` or `src/ui.js` references.
2. `node tests/scheduler.test.mjs` → **12/12 PASS**: overlap prevention, cool-down gap, daily cap, weekend skip, long-job splitting, priority ordering/oldest-first, minimum lead time and lab hours, printing job never moved, ASCII/binary STL mesh estimates, G-code time formats, and labelled file-size fallback.
3. Static server on `0.0.0.0:4173`, driven with Playwright/Chromium: exactly three role buttons; all three demo logins; real binary STL upload; computed STL estimate; teacher approval; schedule blocks increased from **1 → 2**; reload retained request `SLB-0003` with status `approved` and its scheduled slot. Teacher workflow **confirmed → printing → printed → handed** persisted; student upload/download/cancel persisted (`SLB-0004` → `cancelled`); admin serial generation/CSV, account create/edit/delete, settings save, report CSV, DB JSON export, validated import, and demo reset all succeeded. The in-page `#selftest` route printed **PASS**. Results: **0 console errors, 0 page errors, 0 external runtime requests**, **0px** document overflow at 390px, no fatal panel, and offline navigation still worked.
4. Repeated inside an iframe with `sandbox="allow-scripts"` and an opaque origin: `localStorage` was confirmed blocked, the in-memory and IndexedDB-file fallback notice was visible on both app and self-test screens, all three demo logins worked, STL upload/estimate worked, teacher approval added a block (**1 → 2**), and `#selftest` printed **PASS**. Results: **0 console errors, 0 page errors, 0 external requests**, no fatal panel.
5. Opened `dist/index.html` as `file://`: same three logins, binary STL upload/estimate, teacher approval and schedule blocks (**1 → 2**), offline navigation, reload returned the signed-in teacher dashboard with the approved request persisted, a post-reload student login succeeded, and `#selftest` printed **PASS**. Results: **0 console errors, 0 page errors, 0 external requests**, no fatal panel.
6. `https://steam-lab-booking-system.netlify.app` was fetched and returned Netlify’s **“Site not found”** page. The three-button live-site check therefore could not be performed. No Netlify deployment was created in this workspace because the Netlify connector is unavailable and the GitHub-to-Netlify step is being handled by the user.

The isolated Node self-test also passed **12/12 assertions** without loading the live database.

## GitHub and Netlify deployment

The repository is pushed to the working branch `arena/3fbd4a6f-steam-lab-bookng-system`. A `steam-lab-booking-system.zip` fallback archive is also provided in the workspace.

`netlify.toml` is already configured:

```toml
[build]
  command = "node build.mjs"
  publish = "dist"

[[headers]]
  for = "/index.html"
  [headers.values]
    Cache-Control = "no-cache"
```

Exact settings to use:

- **Build command:** `node build.mjs`
- **Publish directory:** `dist`
- **Site name:** `steam-lab-booking-system` (no random suffix; if it is taken, stop rather than accept a suffix)
- **Target URL:** `https://steam-lab-booking-system.netlify.app`

Click-by-click fallback if importing manually:

1. Download and unzip `steam-lab-booking-system.zip`.
2. In GitHub, choose **New repository**, name it as desired, and create an empty repository (no README/license needed).
3. In the unzipped folder, run `git init`, `git add .`, `git commit -m "Add STEAM Lab Booking System"`, add the GitHub remote, and push the default branch. Alternatively use GitHub’s **Upload files** button and drag in the unzipped files (excluding `.git`).
4. In Netlify, choose **Add new site → Import an existing project → GitHub**, authorize GitHub, and select the repository.
5. On the build settings screen, set **Build command** to `node build.mjs` and **Publish directory** to `dist`. No environment variables or secrets are needed.
6. Before deploying, set the site name to exactly `steam-lab-booking-system` under **Site configuration → Site details → Change site name**. If Netlify says it is unavailable, stop; do not accept a generated suffix.
7. Choose **Deploy site**, wait for the build log to show `Built dist/index.html`, then open `https://steam-lab-booking-system.netlify.app` and `https://steam-lab-booking-system.netlify.app/#selftest`.
8. Confirm the landing page shows Student, Teacher, and Admin and the self-test reports **PASS**.

For a manual drag-and-drop deploy instead, build locally with `node build.mjs`, then drag the entire `dist/` folder onto Netlify’s **Deploy manually** drop zone. Set the same site name before or immediately after deployment.
