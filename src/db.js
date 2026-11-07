import { makeSalt, hashPassword, makeId, seedFileBytes, stateGet, stateSet } from './core.js';
import { estimateFromFile } from './estimate.js';

export const DEFAULT_SETTINGS = {
  openTime: '08:00',
  closeTime: '17:00',
  workingDays: [1, 2, 3, 4, 5],
  slotMinutes: 30,
  restGapMinutes: 30,
  dailyCapMinutes: 420,
  minLeadMinutes: 720,
  maxActivePerStudent: 3,
  maxUploadMB: 25,
  buildVolume: { x: 220, y: 220, z: 250 }
};

export const VALID_STATUSES = ['pending', 'approved', 'rejected', 'printing', 'printed', 'handed', 'cancelled'];
export const ACTIVE_STATUSES = ['pending', 'approved', 'printing', 'printed'];
export const VALID_PRIORITIES = ['urgent', 'high', 'normal', 'low'];

export const DEMO_ACCOUNTS = [
  { key: 'admin', id: 'acc-admin', role: 'admin', name: 'Lab Administrator', loginId: '12345678910', serial: null, password: '12345', autoApprove: false },
  { key: 'teacher', id: 'acc-teacher1', role: 'teacher', name: 'Ms Rivera', loginId: 'teacher1', serial: 'T-1041', password: 'teach123', autoApprove: false },
  { key: 'student', id: 'acc-student1', role: 'student', name: 'Avery Chen', loginId: 'student1', serial: 'STU-2001', password: '12345', autoApprove: false },
  { key: 'student2', id: 'acc-student2', role: 'student', name: 'Jordan Patel', loginId: 'student2', serial: 'STU-2002', password: '12345', autoApprove: true }
];

export const DEMO_CREDENTIALS = {
  admin: { role: 'admin', loginId: '12345678910', serial: '', password: '12345', label: 'username' },
  teacher: { role: 'teacher', loginId: 'teacher1', serial: 'T-1041', password: 'teach123', label: 'login ID' },
  student: { role: 'student', loginId: 'student1', serial: 'STU-2001', password: '12345', label: 'login ID' }
};

let currentDb = null;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normaliseSettings(input) {
  const source = isObject(input) ? input : {};
  const workingDays = Array.isArray(source.workingDays)
    ? source.workingDays.map((day) => Number(day)).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6)
    : clone(DEFAULT_SETTINGS.workingDays);
  const buildVolume = isObject(source.buildVolume) ? source.buildVolume : {};
  return {
    ...DEFAULT_SETTINGS,
    ...source,
    workingDays: workingDays.length ? Array.from(new Set(workingDays)).sort((a, b) => a - b) : clone(DEFAULT_SETTINGS.workingDays),
    slotMinutes: finiteNumber(source.slotMinutes, DEFAULT_SETTINGS.slotMinutes),
    restGapMinutes: finiteNumber(source.restGapMinutes, DEFAULT_SETTINGS.restGapMinutes),
    dailyCapMinutes: finiteNumber(source.dailyCapMinutes, DEFAULT_SETTINGS.dailyCapMinutes),
    minLeadMinutes: finiteNumber(source.minLeadMinutes, DEFAULT_SETTINGS.minLeadMinutes),
    maxActivePerStudent: finiteNumber(source.maxActivePerStudent, DEFAULT_SETTINGS.maxActivePerStudent),
    maxUploadMB: finiteNumber(source.maxUploadMB, DEFAULT_SETTINGS.maxUploadMB),
    buildVolume: {
      x: finiteNumber(buildVolume.x, DEFAULT_SETTINGS.buildVolume.x),
      y: finiteNumber(buildVolume.y, DEFAULT_SETTINGS.buildVolume.y),
      z: finiteNumber(buildVolume.z, DEFAULT_SETTINGS.buildVolume.z)
    }
  };
}

export function createAccountRecord(payload, now = Date.now()) {
  const salt = makeSalt();
  return {
    id: payload.id || makeId('acc'),
    role: payload.role,
    name: String(payload.name || '').trim(),
    loginId: String(payload.loginId || '').trim(),
    salt,
    passwordHash: hashPassword(payload.password, salt),
    serial: payload.serial || null,
    serialBoundAt: null,
    active: payload.active !== false,
    autoApprove: Boolean(payload.autoApprove),
    createdAt: now,
    passwordUpdatedAt: now
  };
}

function seedFile(name, key, infill, copies, settings, now) {
  const bytes = seedFileBytes(key, name);
  const estimate = estimateFromFile({ name, bytes, infill, copies, buildVolume: settings.buildVolume, now });
  const pointer = {
    backend: 'seed',
    key,
    seedKey: key,
    name,
    size: bytes.length,
    mime: 'model/stl'
  };
  return {
    file: { name, size: bytes.length, mime: 'model/stl', pointer },
    estimate
  };
}

function makeSeedRequest(options) {
  return {
    id: options.id,
    code: options.code,
    studentId: options.studentId,
    studentName: options.studentName,
    title: options.title,
    notes: options.notes,
    material: options.material,
    colour: options.colour,
    infill: options.infill,
    copies: options.copies,
    status: options.status,
    priority: options.priority || 'normal',
    submittedAt: options.submittedAt,
    approvedAt: options.approvedAt || null,
    approvedBy: options.approvedBy || null,
    adjustedMinutes: options.adjustedMinutes || null,
    rejectionReason: null,
    cancelReason: null,
    slotConfirmedAt: null,
    slotConfirmedBy: null,
    file: options.payload.file,
    estimate: options.payload.estimate,
    schedule: { segments: [], reason: 'Waiting for the scheduler', scheduledAt: null, fixed: false, releasedAt: null },
    workflow: { startedAt: null, printedAt: null, handedAt: null, printMinutes: null },
    createdAt: options.submittedAt
  };
}

export function createSeedDatabase(now = Date.now()) {
  const settings = clone(DEFAULT_SETTINGS);
  const accounts = DEMO_ACCOUNTS.map((demo) => createAccountRecord({ ...demo }, now));
  const serials = [
    { code: 'STU-2001', role: 'student', status: 'assigned', assignedTo: 'acc-student1', boundAt: null, createdAt: now },
    { code: 'STU-2002', role: 'student', status: 'assigned', assignedTo: 'acc-student2', boundAt: null, createdAt: now },
    { code: 'STU-2003', role: 'student', status: 'free', assignedTo: null, boundAt: null, createdAt: now },
    { code: 'STU-2004', role: 'student', status: 'free', assignedTo: null, boundAt: null, createdAt: now },
    { code: 'T-1041', role: 'teacher', status: 'assigned', assignedTo: 'acc-teacher1', boundAt: null, createdAt: now },
    { code: 'T-1042', role: 'teacher', status: 'free', assignedTo: null, boundAt: null, createdAt: now },
    { code: 'T-1043', role: 'teacher', status: 'free', assignedTo: null, boundAt: null, createdAt: now }
  ];
  const approvedPayload = seedFile('demo-cube.stl', 'seed-cube-1', 20, 1, settings, now);
  const pendingPayload = seedFile('demo-bracket.stl', 'seed-bracket-2', 30, 1, settings, now);
  const requests = [
    makeSeedRequest({
      id: 'req-seed-approved',
      code: 'SLB-0001',
      studentId: 'acc-student1',
      studentName: 'Avery Chen',
      title: 'Geometry calibration cube',
      notes: 'Demo job: already approved and scheduled.',
      material: 'PLA',
      colour: 'Blue',
      infill: 20,
      copies: 1,
      status: 'approved',
      priority: 'normal',
      submittedAt: now - 3 * 86400000,
      approvedAt: now - 2 * 86400000,
      approvedBy: 'acc-teacher1',
      payload: approvedPayload
    }),
    makeSeedRequest({
      id: 'req-seed-pending',
      code: 'SLB-0002',
      studentId: 'acc-student2',
      studentName: 'Jordan Patel',
      title: 'Desk bracket prototype',
      notes: 'Demo job: waiting for teacher review.',
      material: 'PETG',
      colour: 'Orange',
      infill: 30,
      copies: 1,
      status: 'pending',
      priority: 'high',
      submittedAt: now - 86400000,
      payload: pendingPayload
    })
  ];
  return {
    schema: 'steamlab-db-v1',
    version: 1,
    createdAt: now,
    updatedAt: now,
    settings,
    accounts,
    serials,
    serialBindings: {},
    requests,
    session: null,
    activity: [{ id: makeId('act'), at: now, actor: 'system', action: 'seed', detail: 'Demo accounts, serials, and two example requests created.' }],
    counters: { request: 3, account: 5, studentSerial: 2004, teacherSerial: 1043 }
  };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export function validateDatabase(raw) {
  let candidate = raw;
  if (typeof candidate === 'string') {
    try { candidate = JSON.parse(candidate); } catch (_) { throw new Error('Backup is not valid JSON.'); }
  }
  assert(isObject(candidate), 'Database must be a JSON object.');
  assert(Number(candidate.version) === 1, 'Database version must be 1.');
  assert(Array.isArray(candidate.accounts), 'Database accounts must be an array.');
  assert(Array.isArray(candidate.serials), 'Database serials must be an array.');
  assert(Array.isArray(candidate.requests), 'Database requests must be an array.');
  assert(isObject(candidate.settings), 'Database settings must be an object.');
  assert(candidate.accounts.length > 0, 'Database must contain at least one account.');
  assert(candidate.accounts.some((account) => account && account.role === 'admin'), 'Database must contain an admin account.');

  const accountIds = new Set();
  const loginIds = new Set();
  for (const [index, account] of candidate.accounts.entries()) {
    assert(isObject(account), `Account ${index + 1} must be an object.`);
    assert(typeof account.id === 'string' && account.id, `Account ${index + 1} is missing an id.`);
    assert(['student', 'teacher', 'admin'].includes(account.role), `Account ${index + 1} has an invalid role.`);
    assert(typeof account.loginId === 'string' && account.loginId, `Account ${index + 1} is missing a login ID.`);
    assert(typeof account.salt === 'string' && account.salt, `Account ${index + 1} is missing a password salt.`);
    assert(/^[a-f0-9]{64}$/i.test(String(account.passwordHash || '')), `Account ${index + 1} has an invalid password hash.`);
    assert(!accountIds.has(account.id), `Duplicate account id: ${account.id}.`);
    assert(!loginIds.has(String(account.loginId).toLowerCase()), `Duplicate login ID: ${account.loginId}.`);
    accountIds.add(account.id);
    loginIds.add(String(account.loginId).toLowerCase());
  }

  const serialCodes = new Set();
  for (const [index, serial] of candidate.serials.entries()) {
    assert(isObject(serial), `Serial ${index + 1} must be an object.`);
    assert(typeof serial.code === 'string' && serial.code, `Serial ${index + 1} is missing a code.`);
    assert(['student', 'teacher'].includes(serial.role), `Serial ${index + 1} has an invalid role.`);
    assert(['free', 'assigned', 'used'].includes(serial.status), `Serial ${index + 1} has an invalid status.`);
    assert(!serialCodes.has(serial.code), `Duplicate serial: ${serial.code}.`);
    serialCodes.add(serial.code);
  }

  const requestIds = new Set();
  const requestCodes = new Set();
  for (const [index, request] of candidate.requests.entries()) {
    assert(isObject(request), `Request ${index + 1} must be an object.`);
    assert(typeof request.id === 'string' && request.id, `Request ${index + 1} is missing an id.`);
    assert(typeof request.code === 'string' && request.code, `Request ${index + 1} is missing a code.`);
    assert(typeof request.studentId === 'string' && request.studentId, `Request ${index + 1} is missing a student id.`);
    assert(VALID_STATUSES.includes(request.status), `Request ${index + 1} has an invalid status.`);
    assert(!VALID_PRIORITIES || VALID_PRIORITIES.includes(request.priority || 'normal'), `Request ${index + 1} has an invalid priority.`);
    assert(!requestIds.has(request.id), `Duplicate request id: ${request.id}.`);
    assert(!requestCodes.has(request.code), `Duplicate request code: ${request.code}.`);
    requestIds.add(request.id);
    requestCodes.add(request.code);
  }

  const settings = normaliseSettings(candidate.settings);
  assert(/^\d{1,2}:\d{2}$/.test(settings.openTime), 'Open time must use HH:MM.');
  assert(/^\d{1,2}:\d{2}$/.test(settings.closeTime), 'Close time must use HH:MM.');
  assert(settings.closeTime > settings.openTime, 'Close time must be after open time.');
  assert(settings.workingDays.length > 0, 'At least one working day is required.');
  assert(settings.slotMinutes >= 5, 'Slot length must be at least 5 minutes.');
  assert(settings.dailyCapMinutes >= settings.slotMinutes, 'Daily cap must be at least one slot.');

  return normaliseDatabase(candidate);
}

export function normaliseDatabase(candidate) {
  const db = clone(candidate);
  db.schema = 'steamlab-db-v1';
  db.version = 1;
  db.createdAt = finiteNumber(db.createdAt, Date.now());
  db.updatedAt = finiteNumber(db.updatedAt, Date.now());
  db.settings = normaliseSettings(db.settings);
  db.accounts = (Array.isArray(db.accounts) ? db.accounts : []).map((account) => ({
    ...account,
    name: String(account.name || account.loginId || 'User'),
    serial: account.serial || null,
    serialBoundAt: account.serialBoundAt || null,
    active: account.active !== false,
    autoApprove: Boolean(account.autoApprove),
    createdAt: finiteNumber(account.createdAt, db.createdAt)
  }));
  db.serials = (Array.isArray(db.serials) ? db.serials : []).map((serial) => ({
    ...serial,
    status: ['free', 'assigned', 'used'].includes(serial.status) ? serial.status : 'free',
    assignedTo: serial.assignedTo || null,
    boundAt: serial.boundAt || null,
    createdAt: finiteNumber(serial.createdAt, db.createdAt)
  }));
  db.serialBindings = isObject(db.serialBindings) ? db.serialBindings : {};
  db.requests = (Array.isArray(db.requests) ? db.requests : []).map((request) => ({
    ...request,
    studentName: String(request.studentName || 'Unknown student'),
    title: String(request.title || 'Untitled model'),
    notes: String(request.notes || ''),
    material: String(request.material || 'PLA'),
    colour: String(request.colour || 'Not specified'),
    infill: finiteNumber(request.infill, 20),
    copies: Math.max(1, finiteNumber(request.copies, 1)),
    priority: VALID_PRIORITIES.includes(request.priority) ? request.priority : 'normal',
    submittedAt: finiteNumber(request.submittedAt, db.createdAt),
    createdAt: finiteNumber(request.createdAt, request.submittedAt || db.createdAt),
    estimate: isObject(request.estimate) ? request.estimate : { minutes: 30, totalMinutes: 30, method: 'file-size-estimate', label: 'Legacy estimate' },
    file: isObject(request.file) ? request.file : { name: 'missing.bin', size: 0, mime: 'application/octet-stream', pointer: null },
    schedule: isObject(request.schedule) ? { segments: [], reason: 'Not scheduled', scheduledAt: null, fixed: false, releasedAt: null, ...request.schedule } : { segments: [], reason: 'Not scheduled', scheduledAt: null, fixed: false, releasedAt: null },
    workflow: isObject(request.workflow) ? request.workflow : { startedAt: null, printedAt: null, handedAt: null, printMinutes: null }
  }));
  db.requests.forEach((request) => {
    if (!Array.isArray(request.schedule.segments)) request.schedule.segments = [];
  });
  db.session = isObject(db.session) && db.accounts.some((account) => account.id === db.session.accountId && account.active) ? db.session : null;
  db.activity = Array.isArray(db.activity) ? db.activity.slice(-100) : [];
  db.counters = {
    request: Math.max(1, finiteNumber(db.counters && db.counters.request, 1)),
    account: Math.max(1, finiteNumber(db.counters && db.counters.account, db.accounts.length + 1)),
    studentSerial: Math.max(2000, finiteNumber(db.counters && db.counters.studentSerial, 2000)),
    teacherSerial: Math.max(1000, finiteNumber(db.counters && db.counters.teacherSerial, 1000))
  };
  return db;
}

export function saveDatabaseTo(db, storage) {
  const valid = validateDatabase(db);
  valid.updatedAt = Date.now();
  stateSet(JSON.stringify(valid), storage);
  return valid;
}

export function loadDatabaseFrom(storage) {
  const text = stateGet(storage);
  if (!text) return null;
  return validateDatabase(text);
}

export function loadOrSeedDatabase(now = Date.now()) {
  try {
    const loaded = loadDatabaseFrom();
    if (loaded) {
      currentDb = loaded;
      return currentDb;
    }
  } catch (_) {
    // A corrupt local record is replaced by valid demo data rather than a blank screen.
  }
  currentDb = createSeedDatabase(now);
  saveDatabaseTo(currentDb);
  return currentDb;
}

export function getDb() {
  if (!currentDb) return loadOrSeedDatabase();
  return currentDb;
}

export function commitDb() {
  if (!currentDb) return getDb();
  currentDb = saveDatabaseTo(currentDb);
  return currentDb;
}

export function replaceDb(db) {
  currentDb = validateDatabase(db);
  saveDatabaseTo(currentDb);
  return currentDb;
}

export function resetToSeedDatabase(now = Date.now()) {
  return replaceDb(createSeedDatabase(now));
}

export function isDatabaseLoaded() {
  return currentDb !== null;
}

export function findAccountById(db, id) {
  return db.accounts.find((account) => account.id === id) || null;
}

export function findAccountByLogin(db, loginId, role) {
  const normalised = String(loginId || '').trim().toLowerCase();
  return db.accounts.find((account) => account.loginId.toLowerCase() === normalised && (!role || account.role === role)) || null;
}

export function findRequestById(db, id) {
  return db.requests.find((request) => request.id === id) || null;
}

export function findSerial(db, code) {
  const normalised = String(code || '').trim().toUpperCase();
  return db.serials.find((serial) => serial.code === normalised) || null;
}

export function makeRequestCode(db) {
  const value = Math.max(1, finiteNumber(db.counters.request, 1));
  db.counters.request = value + 1;
  return `SLB-${String(value).padStart(4, '0')}`;
}

export function serialFormat(role) {
  return role === 'student' ? 'STU-' : 'T-';
}

export function nextSerialCodes(db, role, count) {
  const key = role === 'student' ? 'studentSerial' : 'teacherSerial';
  const prefix = serialFormat(role);
  let number = Math.max(role === 'student' ? 2000 : 1000, finiteNumber(db.counters[key], role === 'student' ? 2000 : 1000));
  const existing = new Set(db.serials.map((serial) => serial.code));
  const codes = [];
  let guard = 0;
  while (codes.length < count && guard < 1000) {
    guard += 1;
    number += 1;
    const code = `${prefix}${number}`;
    if (existing.has(code)) continue;
    existing.add(code);
    codes.push(code);
  }
  db.counters[key] = number;
  return codes;
}
