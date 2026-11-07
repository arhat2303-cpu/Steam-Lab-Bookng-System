process.env.TZ = 'UTC';

import assert from 'node:assert/strict';
import { scheduleRequests, scheduleHasOverlaps } from '../src/scheduler.js';
import { estimateFromFile } from '../src/estimate.js';
import { seedFileBytes, encodeUtf8Bytes } from '../src/core.js';

const DAY_MS = 86400000;
let failures = 0;
const names = [];

function test(name, fn) {
  names.push(name);
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL ${name}: ${error && error.message ? error.message : String(error)}`);
  }
}

const monday = new Date(2026, 0, 5, 8, 0, 0, 0).getTime();
const fridayLate = new Date(2026, 0, 9, 16, 30, 0, 0).getTime();

function baseSettings(overrides = {}) {
  return {
    openTime: '08:00',
    closeTime: '17:00',
    workingDays: [1, 2, 3, 4, 5],
    slotMinutes: 30,
    restGapMinutes: 30,
    dailyCapMinutes: 420,
    minLeadMinutes: 0,
    ...overrides
  };
}

function approved(id, options = {}) {
  return {
    id,
    status: 'approved',
    priority: options.priority || 'normal',
    submittedAt: options.submittedAt ?? monday - 1000,
    approvedAt: options.approvedAt ?? monday - 1000,
    copies: 1,
    adjustedMinutes: options.minutes ?? 60,
    estimate: { minutes: options.minutes ?? 60, totalMinutes: options.minutes ?? 60 },
    schedule: { segments: [] }
  };
}

function sortedReservations(result) {
  return result.reservations.slice().sort((a, b) => a.start - b.start || a.end - b.end);
}

function binaryCube(size = 10) {
  const s = size;
  const v = [
    [0, 0, 0], [s, 0, 0], [s, s, 0], [0, s, 0],
    [0, 0, s], [s, 0, s], [s, s, s], [0, s, s]
  ];
  const faces = [
    [0, 3, 2], [0, 2, 1], [4, 5, 6], [4, 6, 7],
    [0, 1, 5], [0, 5, 4], [3, 7, 6], [3, 6, 2],
    [0, 4, 7], [0, 7, 3], [1, 2, 6], [1, 6, 5]
  ];
  const bytes = new Uint8Array(84 + faces.length * 50);
  const view = new DataView(bytes.buffer);
  view.setUint32(80, faces.length, true);
  faces.forEach((face, index) => {
    const base = 84 + index * 50;
    for (let vertex = 0; vertex < 3; vertex += 1) {
      const offset = base + 12 + vertex * 12;
      view.setFloat32(offset, v[face[vertex]][0], true);
      view.setFloat32(offset + 4, v[face[vertex]][1], true);
      view.setFloat32(offset + 8, v[face[vertex]][2], true);
    }
    view.setUint16(base + 48, 0, true);
  });
  return bytes;
}

test('overlap prevention', () => {
  const requests = [approved('job-a', { minutes: 120, submittedAt: monday - 3000 }), approved('job-b', { minutes: 120, submittedAt: monday - 2000 })];
  const result = scheduleRequests({ requests, settings: baseSettings(), now: monday });
  assert.equal(scheduleHasOverlaps(result), false);
  const sorted = sortedReservations(result);
  assert.equal(sorted.length, 2);
  assert.ok(sorted[1].start >= sorted[0].end, 'second job starts before first job ends');
});

test('cool-down gap', () => {
  const settings = baseSettings({ restGapMinutes: 30 });
  const requests = [approved('gap-a', { minutes: 60, submittedAt: monday - 3000 }), approved('gap-b', { minutes: 60, submittedAt: monday - 2000 })];
  const result = scheduleRequests({ requests, settings, now: monday });
  const sorted = sortedReservations(result);
  assert.equal(sorted.length, 2);
  assert.ok(sorted[1].start - sorted[0].end >= 30 * 60000, '30-minute cool-down was not reserved');
  assert.ok(result.coolDowns.length >= 2, 'cool-down blocks were not emitted');
  assert.equal(result.placements['gap-a'].segments[0].coolEnd, result.placements['gap-a'].segments[0].end + 30 * 60000);
});

test('daily cap', () => {
  const settings = baseSettings({ dailyCapMinutes: 300, restGapMinutes: 30 });
  const requests = [approved('cap-a', { minutes: 300, submittedAt: monday - 3000 }), approved('cap-b', { minutes: 60, submittedAt: monday - 2000 })];
  const result = scheduleRequests({ requests, settings, now: monday });
  for (const [key, minutes] of Object.entries(result.dailyUsed)) {
    assert.ok(minutes <= 300 + 0.001, `${key} uses ${minutes} minutes above the 300-minute cap`);
  }
  const a = result.placements['cap-a'].segments[0];
  const b = result.placements['cap-b'].segments[0];
  assert.ok(b.start >= a.end + 30 * 60000, 'second job did not wait for the cap and gap');
  assert.equal(new Date(b.start).getDate(), new Date(a.start).getDate() + 1, 'second job did not move to the next working day');
  assert.match(result.placements['cap-b'].reason, /daily printing cap/i);
});

test('weekend skip', () => {
  const settings = baseSettings({ dailyCapMinutes: 600, restGapMinutes: 0, minLeadMinutes: 0 });
  const request = approved('weekend-job', { minutes: 120, submittedAt: fridayLate - 1000, approvedAt: fridayLate - 1000 });
  const result = scheduleRequests({ requests: [request], settings, now: fridayLate });
  const segments = result.placements['weekend-job'].segments;
  assert.ok(segments.length >= 2, 'long Friday job was not split across the weekend boundary');
  for (const segment of segments) {
    const weekday = new Date(segment.start).getDay();
    assert.ok(weekday >= 1 && weekday <= 5, `segment starts on weekday ${weekday}`);
  }
  assert.ok(segments.some((segment) => new Date(segment.start).getDay() === 1), 'no Monday continuation was scheduled');
  assert.match(result.placements['weekend-job'].reason, /lab is closed/i);
});

test('long-job splitting', () => {
  const settings = baseSettings({ dailyCapMinutes: 420, restGapMinutes: 30 });
  const longJob = approved('long-job', { minutes: 900, submittedAt: monday - 4000 });
  const shortJob = approved('short-job', { minutes: 60, submittedAt: monday - 3000, priority: 'low' });
  const result = scheduleRequests({ requests: [longJob, shortJob], settings, now: monday });
  const segments = result.placements['long-job'].segments;
  assert.ok(segments.length >= 3, `expected at least 3 working-day segments, got ${segments.length}`);
  assert.ok(segments.reduce((sum, segment) => sum + segment.minutes, 0) >= 900, 'split segments do not cover the full duration');
  assert.ok(new Set(segments.map((segment) => new Date(segment.start).toDateString())).size >= 3, 'segments are not spread across days');
  assert.equal(scheduleHasOverlaps(result), false);
  assert.ok(result.placements['short-job'].segments.length > 0, 'lower-priority queue was blocked instead of continuing after the split job');
  for (const [key, minutes] of Object.entries(result.dailyUsed)) assert.ok(minutes <= 420 + 0.001, `${key} exceeds daily cap`);
  assert.match(result.placements['long-job'].reason, /split/i);
});

test('priority ordering and oldest-first tie break', () => {
  const settings = baseSettings({ dailyCapMinutes: 600, restGapMinutes: 30 });
  const requests = [
    approved('low', { priority: 'low', minutes: 30, submittedAt: monday - 100 }),
    approved('normal', { priority: 'normal', minutes: 30, submittedAt: monday - 200 }),
    approved('high', { priority: 'high', minutes: 30, submittedAt: monday - 300 }),
    approved('urgent', { priority: 'urgent', minutes: 30, submittedAt: monday - 400 })
  ];
  const result = scheduleRequests({ requests, settings, now: monday });
  const starts = ['urgent', 'high', 'normal', 'low'].map((id) => result.placements[id].segments[0].start);
  for (let i = 1; i < starts.length; i += 1) assert.ok(starts[i] > starts[i - 1], `priority order broken at ${i}`);
  const requests2 = [
    approved('newer', { priority: 'normal', minutes: 30, submittedAt: monday - 100 }),
    approved('older', { priority: 'normal', minutes: 30, submittedAt: monday - 500 })
  ];
  const result2 = scheduleRequests({ requests: requests2, settings, now: monday });
  assert.ok(result2.placements.older.segments[0].start < result2.placements.newer.segments[0].start, 'older job did not go first');
});

test('minimum lead time and lab hours', () => {
  const settings = baseSettings({ minLeadMinutes: 720, slotMinutes: 30 });
  const request = approved('lead-job', { minutes: 60, submittedAt: monday, approvedAt: monday });
  const result = scheduleRequests({ requests: [request], settings, now: monday });
  const segment = result.placements['lead-job'].segments[0];
  assert.ok(segment.start >= monday + 720 * 60000, 'slot starts before the 12-hour lead boundary');
  const date = new Date(segment.start);
  const minuteOfDay = date.getHours() * 60 + date.getMinutes();
  assert.ok(minuteOfDay >= 480 && minuteOfDay < 1020, `slot ${minuteOfDay} is outside 08:00–17:00`);
  assert.ok(segment.end <= new Date(2026, 0, 5, 17, 0).getTime() + DAY_MS, 'slot exceeds lab hours');
  assert.match(result.placements['lead-job'].reason, /minimum lead time/i);
});

test('printing job is never moved', () => {
  const fixedStart = new Date(2026, 0, 5, 10, 0).getTime();
  const fixedEnd = fixedStart + 60 * 60000;
  const printing = {
    id: 'fixed-print',
    status: 'printing',
    priority: 'normal',
    submittedAt: monday - 5000,
    approvedAt: monday - 5000,
    adjustedMinutes: 60,
    estimate: { minutes: 60, totalMinutes: 60 },
    copies: 1,
    schedule: { segments: [{ start: fixedStart, end: fixedEnd }] }
  };
  const movable = approved('movable', { minutes: 60, submittedAt: monday - 4000 });
  const result = scheduleRequests({ requests: [printing, movable], settings: baseSettings(), now: monday });
  assert.equal(result.placements['fixed-print'].segments[0].start, fixedStart);
  assert.equal(result.placements['fixed-print'].segments[0].end, fixedEnd);
  assert.equal(result.placements['fixed-print'].fixed, true);
  const movableSegment = result.placements.movable.segments[0];
  const beforeWithGap = movableSegment.end + 30 * 60000 <= fixedStart;
  const afterWithGap = movableSegment.start >= fixedEnd + 30 * 60000;
  assert.ok(beforeWithGap || afterWithGap, 'movable job overlaps the locked printing job or its cool-down');
  assert.equal(scheduleHasOverlaps(result), false);
});

test('ASCII STL mesh estimation and build-volume warning', () => {
  const bytes = seedFileBytes('test-cube', 'cube.stl');
  const estimate = estimateFromFile({ name: 'cube.stl', bytes, infill: 20, copies: 2, buildVolume: { x: 220, y: 220, z: 250 }, now: monday });
  assert.equal(estimate.method, 'stl-mesh');
  assert.ok(Math.abs(estimate.details.volumeMm3 - 1728) < 1, `ASCII cube volume is ${estimate.details.volumeMm3}`);
  assert.ok(Math.abs(estimate.details.surfaceAreaMm2 - 864) < 1, `ASCII cube area is ${estimate.details.surfaceAreaMm2}`);
  assert.ok(Math.abs(estimate.details.bbox.x - 12) < 0.001);
  assert.equal(estimate.copies, 2);
  assert.equal(estimate.totalMinutes, estimate.perCopyMinutes * 2);
  const warned = estimateFromFile({ name: 'cube.stl', bytes, infill: 20, copies: 1, buildVolume: { x: 10, y: 10, z: 10 }, now: monday });
  assert.match(warned.warning || '', /exceeds the configured.*build volume/i);
});

test('binary STL mesh estimation', () => {
  const bytes = binaryCube(10);
  const estimate = estimateFromFile({ name: 'binary-cube.stl', bytes, infill: 100, copies: 1, buildVolume: { x: 220, y: 220, z: 250 }, now: monday });
  assert.equal(estimate.method, 'stl-mesh');
  assert.ok(Math.abs(estimate.details.volumeMm3 - 1000) < 1, `binary cube volume is ${estimate.details.volumeMm3}`);
  assert.ok(Math.abs(estimate.details.surfaceAreaMm2 - 600) < 1, `binary cube area is ${estimate.details.surfaceAreaMm2}`);
  assert.equal(estimate.details.triangles, 12);
  assert.ok(Math.abs(estimate.details.bbox.z - 10) < 0.001);
});

test('G-code slicer time formats', () => {
  const semicolon = estimateFromFile({ name: 'part.gcode', bytes: encodeUtf8Bytes(';TIME:3600\nG1 X0'), infill: 20, copies: 1, now: monday });
  assert.equal(semicolon.method, 'gcode-time');
  assert.equal(semicolon.minutes, 60);
  const line = estimateFromFile({ name: 'part.gco', bytes: encodeUtf8Bytes('; estimated printing time (normal mode) = 1h 2m 3s'), infill: 20, copies: 1, now: monday });
  assert.equal(line.method, 'gcode-estimate-line');
  assert.equal(line.minutes, 63);
  const m73 = estimateFromFile({ name: 'part.g', bytes: encodeUtf8Bytes('M73 P0 R45\nG1 X1'), infill: 20, copies: 1, now: monday });
  assert.equal(m73.method, 'gcode-m73');
  assert.equal(m73.minutes, 45);
});

test('other files use a labelled file-size estimate', () => {
  const bytes = new Uint8Array(2 * 1024 * 1024).fill(7);
  const estimate = estimateFromFile({ name: 'project.zip', bytes, infill: 20, copies: 1, now: monday });
  assert.equal(estimate.method, 'file-size-estimate');
  assert.match(estimate.label, /estimate/i);
  assert.equal(estimate.confidence, 'low');
  assert.ok(estimate.totalMinutes > 0);
  const image = estimateFromFile({ name: 'reference.png', bytes: encodeUtf8Bytes('image bytes'), infill: 20, copies: 1, now: monday });
  assert.equal(image.method, 'file-size-estimate');
});

if (failures) {
  console.error(`\n${failures} of ${names.length} scheduler/estimator tests FAILED.`);
  process.exit(1);
}
console.log(`\nAll ${names.length} scheduler/estimator tests PASSED.`);
