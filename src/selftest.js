import { makeMemoryStorage, seedFileBytes, getStorageNotice } from './core.js';
import { createSeedDatabase, saveDatabaseTo, loadDatabaseFrom, isDatabaseLoaded, findAccountById, findRequestById } from './db.js';
import { createRequestRecord, approveRequest, cancelRequest } from './api.js';
import { scheduleRequests, scheduleHasOverlaps } from './scheduler.js';
import { estimateFromFile } from './estimate.js';

function require(condition, message) {
  if (!condition) throw new Error(message);
}

/**
 * Runs against a temporary in-memory storage object only. It never calls getDb(),
 * commitDb(), localStorage, or the live IndexedDB file store.
 */
export function runSelfTest() {
  const checks = [];
  const check = (name, fn) => {
    try {
      const detail = fn();
      checks.push({ name, pass: true, detail: detail || 'PASS' });
    } catch (error) {
      checks.push({ name, pass: false, detail: error && error.message ? error.message : String(error) });
    }
  };
  const realLoadedBefore = isDatabaseLoaded();
  const noticeBefore = getStorageNotice();

  try {
    const now = new Date(2026, 0, 5, 8, 0, 0, 0).getTime();
    const tempStorage = makeMemoryStorage();
    const db = createSeedDatabase(now);
    db.settings = {
      ...db.settings,
      openTime: '08:00',
      closeTime: '17:00',
      workingDays: [1, 2, 3, 4, 5],
      slotMinutes: 30,
      restGapMinutes: 30,
      dailyCapMinutes: 420,
      minLeadMinutes: 0
    };
    saveDatabaseTo(db, tempStorage);
    const seeded = loadDatabaseFrom(tempStorage);

    check('seeds a temporary store without loading the live database', () => {
      require(seeded.accounts.length === 4, `expected 4 seeded accounts, found ${seeded.accounts.length}`);
      require(seeded.requests.length === 2, `expected 2 seeded requests, found ${seeded.requests.length}`);
      require(isDatabaseLoaded() === realLoadedBefore, 'live database load state changed');
      return '4 accounts and 2 requests in an isolated Map-backed store';
    });

    const student = findAccountById(db, 'acc-student1');
    const teacher = findAccountById(db, 'acc-teacher1');
    const bytes = seedFileBytes('selftest-cube', 'selftest.stl');
    const estimate = estimateFromFile({
      name: 'selftest.stl',
      bytes,
      size: bytes.length,
      infill: 20,
      copies: 1,
      buildVolume: db.settings.buildVolume,
      now
    });
    const created = createRequestRecord(db, {
      title: 'Self-test calibration part',
      notes: 'Temporary self-test job.',
      material: 'PLA',
      colour: 'Blue',
      infill: 20,
      copies: 1,
      file: {
        name: 'selftest.stl',
        size: bytes.length,
        mime: 'model/stl',
        pointer: { backend: 'seed', key: 'selftest-cube', seedKey: 'selftest-cube', name: 'selftest.stl', size: bytes.length, mime: 'model/stl' }
      },
      estimate
    }, student, now);
    check('creates a job and computes its estimate from a real STL mesh', () => {
      require(created.ok, Object.values(created.errors || {}).join('; ') || 'job creation failed');
      require(estimate.method === 'stl-mesh', `expected stl-mesh estimate, got ${estimate.method}`);
      require(estimate.details.volumeMm3 > 0, 'STL volume was not computed');
      return `${created.request.code}, ${estimate.minutes} min/copy, volume ${estimate.details.volumeMm3.toFixed(0)} mm³`;
    });

    const requestId = created.request ? created.request.id : 'missing-request';
    const approved = approveRequest(db, requestId, { minutes: 60, priority: 'urgent', commit: false }, teacher, now);
    check('approves the job and auto-runs the scheduler', () => {
      require(approved.ok, Object.values(approved.errors || {}).join('; ') || 'approval failed');
      const request = findRequestById(db, requestId);
      require(request.status === 'approved', `expected approved status, got ${request.status}`);
      require(request.schedule.segments.length > 0, 'approval produced no scheduled segment');
      return `${request.code}: ${approved.schedule}`;
    });

    const result = scheduleRequests({ requests: db.requests, settings: db.settings, now });
    const gapMs = db.settings.restGapMinutes * 60000;
    const sorted = result.reservations.slice().sort((a, b) => a.start - b.start || a.end - b.end);
    const urgentPlacement = result.placements[requestId];
    const seedPlacement = result.placements['req-seed-approved'];

    check('scheduled slot is in the future and inside lab hours', () => {
      require(urgentPlacement && urgentPlacement.segments.length, 'urgent placement is missing');
      const start = urgentPlacement.segments[0].start;
      const date = new Date(start);
      const minutes = date.getHours() * 60 + date.getMinutes();
      require(start >= now, 'slot starts before now');
      require(minutes >= 480 && minutes < 1020, `slot at ${minutes} minutes is outside 08:00–17:00`);
      return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')} on ${date.toDateString()}`;
    });

    check('scheduled jobs do not overlap', () => {
      require(!scheduleHasOverlaps(result), 'reservation intervals overlap');
      require(sorted.length >= 2, `expected at least 2 reservations, found ${sorted.length}`);
      return `${sorted.length} non-overlapping reservations`;
    });

    check('required 30-minute cool-down gap is reserved around every job', () => {
      for (let i = 1; i < sorted.length; i += 1) {
        const gap = sorted[i].start - sorted[i - 1].end;
        require(gap >= gapMs - 1, `gap of ${Math.round(gap / 60000)} min is shorter than 30 min`);
      }
      require(result.coolDowns.length > 0, 'no cool-down blocks were emitted');
      return `${result.coolDowns.length} visible cool-down blocks; minimum adjacent gap ${Math.round(Math.min(...sorted.slice(1).map((item, i) => item.start - sorted[i].end)) / 60000)} min`;
    });

    check('daily printing cap is respected', () => {
      for (const [key, minutes] of Object.entries(result.dailyUsed)) {
        require(minutes <= db.settings.dailyCapMinutes + 0.001, `${key} uses ${minutes} min above the 420 min cap`);
      }
      return Object.entries(result.dailyUsed).map(([key, minutes]) => `${key}: ${Math.round(minutes)} min`).join(', ');
    });

    check('weekends are skipped', () => {
      for (const reservation of sorted) {
        const weekday = new Date(reservation.start).getDay();
        require(weekday >= 1 && weekday <= 5, `reservation starts on weekday ${weekday}`);
      }
      return 'all reservations fall on Monday–Friday';
    });

    check('urgent priority is scheduled before the older normal job', () => {
      require(seedPlacement && seedPlacement.segments.length, 'seed normal placement is missing');
      require(urgentPlacement.segments[0].start < seedPlacement.segments[0].start, 'urgent job did not go first');
      return `urgent ${new Date(urgentPlacement.segments[0].start).toLocaleString()} before normal ${new Date(seedPlacement.segments[0].start).toLocaleString()}`;
    });

    const seedStartBeforeCancel = seedPlacement.segments[0].start;
    const cancelled = cancelRequest(db, requestId, student, 'Self-test cancellation', now, { commit: false });
    check('cancelling releases reserved time and re-runs the scheduler', () => {
      require(cancelled.ok, Object.values(cancelled.errors || {}).join('; ') || 'cancellation failed');
      const cancelledRequest = findRequestById(db, requestId);
      require(cancelledRequest.status === 'cancelled', `expected cancelled status, got ${cancelledRequest.status}`);
      require(cancelledRequest.schedule.segments.length === 0, 'cancelled request still owns reserved time');
      const seedAfter = findRequestById(db, 'req-seed-approved');
      require(seedAfter.schedule.segments[0].start < seedStartBeforeCancel, 'remaining job did not move into the released time');
      return `remaining job moved from ${new Date(seedStartBeforeCancel).toLocaleString()} to ${new Date(seedAfter.schedule.segments[0].start).toLocaleString()}`;
    });

    saveDatabaseTo(db, tempStorage);
    const reloaded = loadDatabaseFrom(tempStorage);
    check('persistence reload keeps the cancelled job in the temporary store', () => {
      const reloadedRequest = findRequestById(reloaded, requestId);
      require(reloadedRequest, 'request disappeared after reload');
      require(reloadedRequest.status === 'cancelled', `reloaded status is ${reloadedRequest.status}`);
      require(reloaded.accounts.length === 4, 'account count changed after reload');
      return `${reloaded.requests.length} requests and ${reloaded.accounts.length} accounts reloaded`;
    });

    check('live database and browser storage state remain untouched', () => {
      require(isDatabaseLoaded() === realLoadedBefore, 'live database was loaded or replaced');
      require(getStorageNotice() === noticeBefore, 'storage fallback state changed');
      return realLoadedBefore ? 'live session state unchanged' : 'live database never loaded';
    });
  } catch (error) {
    checks.push({ name: 'self-test harness completes without an exception', pass: false, detail: error && error.stack ? error.stack : String(error) });
  }

  const failed = checks.filter((item) => !item.pass);
  return {
    ok: checks.length > 0 && failed.length === 0,
    checks,
    passed: checks.length - failed.length,
    failed: failed.length,
    firstFailure: failed.length ? failed[0].name : null
  };
}
