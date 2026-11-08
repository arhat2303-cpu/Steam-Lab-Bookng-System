import {
  makeSalt, hashPassword, PASSWORD_HASH_ITERATIONS,
  makeId, stateGet, stateSet
} from './core.js';

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

/* The two permanent administrator credentials are stored only as iterated salted hashes. */
export const PERMANENT_ADMINS = [
  {
    id: 'acc-admin-arhatshah8149',
    role: 'admin',
    name: 'ARHAT SHAH',
    loginId: 'ARHATSHAH8149',
    salt: '700d7730099c03970b620b022ad82575',
    passwordHash: '7587034d5f0d1deb6359c1969922ba3ea39f40df376507809490ff9d793a5427',
    hashIterations: PASSWORD_HASH_ITERATIONS
  },
  {
    id: 'acc-admin-ruthvika20',
    role: 'admin',
    name: 'RUTHVIKA VANKADHARA',
    loginId: 'ruthvikabrs123',
    salt: 'edb1b5eb720f483b71a2d5893648dbb2',
    passwordHash: 'a5109b7be61c9de9fb337e0c065afb248a3795b5f5c90cb6d90dc28b7c0d7224',
    hashIterations: PASSWORD_HASH_ITERATIONS
  }
];

/* The stable internal id lets existing local databases migrate from a retired login ID. */
function legacyAdminLoginId(admin) {
  return String(admin.id || '').replace(/^acc-admin-/, '').toUpperCase();
}

function canonicalPermanentAdmin(account) {
  if (!account) return null;
  const loginId = String(account.loginId || '').toUpperCase();
  return PERMANENT_ADMINS.find((admin) => {
    const canonicalLoginId = admin.loginId.toUpperCase();
    const legacyLoginId = legacyAdminLoginId(admin);
    return admin.id === account.id
      || (account.role === 'admin' && account.permanent
        && (loginId === canonicalLoginId
          || (legacyLoginId && legacyLoginId !== canonicalLoginId && loginId === legacyLoginId)));
  }) || null;
}

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

export function normaliseSerial(value) {
  return String(value || '').trim().toUpperCase();
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

export function publicAccount(account) {
  if (!account) return null;
  const safe = clone(account);
  delete safe.password;
  delete safe.salt;
  delete safe.passwordHash;
  delete safe.hashIterations;
  return safe;
}

export function createAccountRecord(payload, now = Date.now()) {
  const salt = makeSalt();
  const role = String(payload.role || '');
  const serial = role === 'admin' ? null : (normaliseSerial(payload.serial) || null);
  return {
    id: payload.id || makeId('acc'),
    role,
    name: String(payload.name || '').trim(),
    className: role === 'student' ? String(payload.className || '').trim() : '',
    loginId: String(payload.loginId || '').trim(),
    salt,
    passwordHash: hashPassword(payload.password, salt, PASSWORD_HASH_ITERATIONS),
    hashIterations: PASSWORD_HASH_ITERATIONS,
    serial,
    serialAssignedAt: serial ? now : null,
    active: payload.active !== false,
    autoApprove: role === 'student' && Boolean(payload.autoApprove),
    permanent: Boolean(payload.permanent),
    createdAt: now,
    passwordUpdatedAt: now
  };
}

export function createFactoryDatabase(now = Date.now()) {
  const settings = clone(DEFAULT_SETTINGS);
  const accounts = PERMANENT_ADMINS.map((admin) => ({
    ...admin,
    className: '',
    serial: null,
    serialAssignedAt: null,
    active: true,
    autoApprove: false,
    permanent: true,
    createdAt: now,
    passwordUpdatedAt: now
  }));
  return {
    schema: 'steamlab-db-v2',
    version: 2,
    createdAt: now,
    updatedAt: now,
    settings,
    accounts,
    serials: [],
    serialBindings: {},
    requests: [],
    session: null,
    activity: [{
      id: makeId('act'),
      at: now,
      actor: 'system',
      action: 'factory',
      detail: 'Two permanent administrator accounts created. No student or teacher accounts were pre-created.'
    }],
    counters: { request: 1, account: 3, studentSerial: 2000, teacherSerial: 1000 }
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
  assert(candidate.schema === 'steamlab-db-v2', 'Database schema must be steamlab-db-v2.');
  assert(Number(candidate.version) === 2, 'Database version must be 2.');
  assert(Array.isArray(candidate.accounts), 'Database accounts must be an array.');
  assert(Array.isArray(candidate.serials), 'Database serials must be an array.');
  assert(Array.isArray(candidate.requests), 'Database requests must be an array.');
  assert(isObject(candidate.settings), 'Database settings must be an object.');
  assert(candidate.accounts.length > 0, 'Database must contain at least one account.');
  assert(candidate.accounts.some((account) => account && account.role === 'admin'), 'Database must contain an admin account.');

  // Canonicalise before strict checks so a persisted retired admin username is migrated, not discarded.
  candidate = normaliseDatabase(candidate);

  const accountIds = new Set();
  const loginIds = new Set();
  const studentSerials = new Set();
  for (const [index, account] of candidate.accounts.entries()) {
    assert(isObject(account), `Account ${index + 1} must be an object.`);
    assert(typeof account.id === 'string' && account.id, `Account ${index + 1} is missing an id.`);
    assert(['student', 'teacher', 'admin'].includes(account.role), `Account ${index + 1} has an invalid role.`);
    assert(typeof account.loginId === 'string' && account.loginId, `Account ${index + 1} is missing a login ID.`);
    assert(typeof account.salt === 'string' && account.salt, `Account ${index + 1} is missing a password salt.`);
    assert(/^[a-f0-9]{64}$/i.test(String(account.passwordHash || '')), `Account ${index + 1} has an invalid password hash.`);
    const iterations = Number(account.hashIterations);
    assert(Number.isInteger(iterations) && iterations >= 1000 && iterations <= 100000, `Account ${index + 1} is missing a valid password hash iteration count.`);
    assert(!Object.prototype.hasOwnProperty.call(account, 'password'), `Account ${index + 1} exposes a plaintext password.`);
    assert(!accountIds.has(account.id), `Duplicate account id: ${account.id}.`);
    assert(!loginIds.has(String(account.loginId).toLowerCase()), `Duplicate login ID: ${account.loginId}.`);
    accountIds.add(account.id);
    loginIds.add(String(account.loginId).toLowerCase());
    if (account.role === 'student' && account.serial) {
      const serial = normaliseSerial(account.serial);
      assert(/^STU-\d{4}$/.test(serial), `Account ${index + 1} has an invalid student serial: ${account.serial}.`);
      assert(!studentSerials.has(serial), `Duplicate student serial: ${serial}.`);
      studentSerials.add(serial);
    }
  }

  for (const admin of PERMANENT_ADMINS) {
    const present = candidate.accounts.some((account) => account.id === admin.id
      && account.role === 'admin'
      && account.loginId === admin.loginId
      && account.active !== false
      && account.permanent === true
      && account.salt === admin.salt
      && account.passwordHash === admin.passwordHash
      && Number(account.hashIterations) === admin.hashIterations);
    assert(present, `Permanent administrator account ${admin.loginId} is missing or was altered.`);
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

  return candidate;
}

export function normaliseDatabase(candidate) {
  const db = clone(candidate);
  db.schema = 'steamlab-db-v2';
  db.version = 2;
  db.createdAt = finiteNumber(db.createdAt, Date.now());
  db.updatedAt = finiteNumber(db.updatedAt, Date.now());
  db.settings = normaliseSettings(db.settings);
  db.accounts = (Array.isArray(db.accounts) ? db.accounts : []).map((account) => {
    const safe = { ...account };
    delete safe.password;
    delete safe.serialBoundAt;
    const canonicalAdmin = canonicalPermanentAdmin(safe);
    if (canonicalAdmin) {
      safe.id = canonicalAdmin.id;
      safe.name = canonicalAdmin.name;
      safe.loginId = canonicalAdmin.loginId;
      safe.role = 'admin';
      safe.className = '';
      safe.serial = null;
      safe.serialAssignedAt = null;
      safe.active = true;
      safe.permanent = true;
    }
    const assignedAt = Number(safe.serialAssignedAt || 0);
    return {
      ...safe,
      name: String(safe.name || safe.loginId || 'User'),
      className: String(safe.className || ''),
      hashIterations: Number.isInteger(Number(safe.hashIterations)) ? Number(safe.hashIterations) : PASSWORD_HASH_ITERATIONS,
      serial: normaliseSerial(safe.serial) || null,
      serialAssignedAt: Number.isFinite(assignedAt) && assignedAt > 0 ? assignedAt : null,
      active: safe.active !== false,
      autoApprove: Boolean(safe.autoApprove),
      permanent: Boolean(safe.permanent),
      createdAt: finiteNumber(safe.createdAt, db.createdAt)
    };
  });
  db.serials = (Array.isArray(db.serials) ? db.serials : []).map((serial) => {
    const assignedAt = Number(serial.assignedAt || serial.boundAt || 0);
    return {
      ...serial,
      code: normaliseSerial(serial.code),
      role: serial.role === 'teacher' ? 'teacher' : 'student',
      status: serial.status === 'free' ? 'free' : 'assigned',
      assignedTo: serial.assignedTo || null,
      assignedAt: Number.isFinite(assignedAt) && assignedAt > 0 ? assignedAt : null,
      createdAt: finiteNumber(serial.createdAt, db.createdAt)
    };
  });
  db.serialBindings = {};
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
  const sessionAccount = isObject(db.session) ? db.accounts.find((account) => account.id === db.session.accountId && account.active) : null;
  db.session = sessionAccount ? {
    accountId: sessionAccount.id,
    role: sessionAccount.role,
    name: sessionAccount.name,
    loginAt: finiteNumber(db.session.loginAt, db.createdAt)
  } : null;
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
    // A corrupt or outdated local record is replaced by factory data rather than a blank screen.
  }
  currentDb = createFactoryDatabase(now);
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

export function resetToFactoryDatabase(now = Date.now()) {
  return replaceDb(createFactoryDatabase(now));
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
  const normalised = normaliseSerial(code);
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
