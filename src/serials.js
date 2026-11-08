import { hashPassword, makeSalt, PASSWORD_HASH_ITERATIONS, makeId } from './core.js';
import {
  normaliseSerial, createAccountRecord, findAccountById, findSerial, publicAccount
} from './db.js';

function serialPattern(role) {
  return role === 'student' ? /^STU-\d{4}$/ : /^T-\d{4}$/;
}

function safeRole(value) {
  return value === 'teacher' ? 'teacher' : 'student';
}

function appendActivity(db, actor, action, detail, now) {
  if (!Array.isArray(db.activity)) db.activity = [];
  db.activity.push({
    id: makeId('act'),
    at: now,
    actor: actor && actor.id ? actor.id : 'system',
    actorName: actor && (actor.name || actor.loginId) ? (actor.name || actor.loginId) : 'system',
    action,
    detail
  });
  db.activity = db.activity.slice(-100);
}

/** Username is always read from its own field; it is never derived from full name. */
export function normaliseSerialRecord(raw, role) {
  const safe = safeRole(role);
  return {
    role: safe,
    name: String(raw.name || '').trim(),
    className: safe === 'student' ? String(raw.className || '').trim() : '',
    serial: normaliseSerial(raw.serial),
    username: String(raw.username ?? raw.loginId ?? '').trim(),
    password: String(raw.password || ''),
    active: raw.active !== false,
    autoApprove: safe === 'student' && Boolean(raw.autoApprove),
    accountId: String(raw.accountId || '') || null,
    source: String(raw.source || ''),
    rowNumber: Number(raw.rowNumber) || null
  };
}

export function validateSerialRecord(db, record, role, currentAccountId = null, mode = 'create') {
  const safe = safeRole(role);
  const errors = {};
  if (!record.name) errors.name = safe === 'student' ? 'Enter the student’s full name.' : 'Enter the teacher’s full name.';
  if (safe === 'student' && !record.className) errors.className = 'Enter the student’s class.';
  if (!record.username) errors.username = 'Enter a username.';
  else if (record.username.length > 64 || /[\u0000-\u001f\u007f]/.test(record.username)) errors.username = 'Use a username without control characters (64 characters maximum).';
  if ((mode === 'create' || record.password) && record.password.length < 6) {
    errors.password = mode === 'create'
      ? 'Use at least 6 characters for the password.'
      : 'Use at least 6 characters, or leave blank to keep the current password.';
  }
  if (record.password.length > 128) errors.password = 'Use 128 characters or fewer for the password.';

  if (record.username && !errors.username) {
    const duplicate = db.accounts.some((account) => account.id !== currentAccountId
      && String(account.loginId || '').toLowerCase() === record.username.toLowerCase());
    if (duplicate) errors.username = 'That username is already used by another account.';
  }

  if (safe === 'student' && !record.serial) errors.serial = 'Enter a unique student serial number.';
  if (record.serial) {
    if (!serialPattern(safe).test(record.serial)) {
      errors.serial = safe === 'student'
        ? 'Student serial numbers use STU-####.'
        : 'Teacher serial numbers use T-####, or leave the field blank.';
    } else {
      const duplicateAccount = db.accounts.some((account) => account.id !== currentAccountId
        && normaliseSerial(account.serial) === record.serial);
      const existing = findSerial(db, record.serial);
      if (duplicateAccount) errors.serial = 'That serial number is already assigned to another account.';
      else if (existing && existing.role !== safe) errors.serial = `That serial belongs to a ${existing.role} account.`;
      else if (existing && existing.assignedTo && existing.assignedTo !== currentAccountId) errors.serial = 'That serial number is already assigned to another account.';
    }
  }
  return errors;
}

export function safeSerialRow(row) {
  const { password, ...safe } = row;
  return safe;
}

export function prepareSerialRows(db, inputRows) {
  const usernameOwners = new Map();
  const serialOwners = new Map();
  const rows = (Array.isArray(inputRows) ? inputRows : []).map((raw, index) => {
    const role = safeRole(raw.role);
    const record = normaliseSerialRecord(raw, role);
    const errors = validateSerialRecord(db, record, role, record.accountId, 'create');
    const label = record.source || `row ${index + 1}`;
    if (record.username && !errors.username) {
      const key = record.username.toLowerCase();
      if (usernameOwners.has(key)) errors.username = `Duplicate username in this import/batch (${usernameOwners.get(key)}).`;
      else usernameOwners.set(key, label);
    }
    if (record.serial && !errors.serial) {
      if (serialOwners.has(record.serial)) errors.serial = `Duplicate serial number in this import/batch (${serialOwners.get(record.serial)}).`;
      else serialOwners.set(record.serial, label);
    }
    return {
      ...record,
      errors,
      valid: Object.keys(errors).length === 0,
      errorText: Object.values(errors).join(' ')
    };
  });
  return {
    rows,
    total: rows.length,
    validCount: rows.filter((row) => row.valid).length,
    invalidCount: rows.filter((row) => !row.valid).length
  };
}

/** Removes any serial record linked to this account, then creates/updates the new one. */
export function syncSerialRecord(db, account, code, now) {
  const oldCode = normaliseSerial(account.serial);
  const newCode = normaliseSerial(code);
  if (oldCode && oldCode !== newCode) {
    db.serials = db.serials.filter((serial) => !(normaliseSerial(serial.code) === oldCode && serial.assignedTo === account.id));
  }
  if (!newCode) {
    account.serial = null;
    account.serialAssignedAt = null;
    return null;
  }
  let record = findSerial(db, newCode);
  if (!record) {
    record = { code: newCode, role: account.role, status: 'assigned', assignedTo: account.id, assignedAt: now, createdAt: now };
    db.serials.push(record);
  }
  record.code = newCode;
  record.role = account.role;
  record.status = 'assigned';
  record.assignedTo = account.id;
  record.assignedAt = now;
  record.createdAt = Number(record.createdAt) || now;
  account.serial = newCode;
  account.serialAssignedAt = now;
  return record;
}

export function createSerialRecord(db, raw, role, actor, now = Date.now()) {
  const safe = safeRole(role);
  const record = normaliseSerialRecord(raw, safe);
  const errors = validateSerialRecord(db, record, safe, null, 'create');
  if (Object.keys(errors).length) return { ok: false, errors };
  const account = createAccountRecord({
    role: safe,
    name: record.name,
    className: record.className,
    loginId: record.username,
    password: record.password,
    serial: record.serial,
    active: record.active,
    autoApprove: record.autoApprove,
    permanent: false
  }, now);
  db.accounts.push(account);
  syncSerialRecord(db, account, record.serial, now);
  appendActivity(db, actor, 'serial-create', `Created ${safe} serial record and login account for ${account.loginId}.`, now);
  return { ok: true, errors: {}, account: publicAccount(account), serial: account.serial };
}

export function updateSerialRecord(db, accountId, raw, role, actor, now = Date.now()) {
  const safe = safeRole(role);
  const account = findAccountById(db, accountId);
  if (!account) return { ok: false, errors: { general: 'That serial record no longer exists.' } };
  if (account.permanent || account.role === 'admin') return { ok: false, errors: { general: 'Administrator accounts are not managed as serial records.' } };
  if (account.role !== safe) return { ok: false, errors: { general: 'Use the matching Student Serials or Teacher Serials section.' } };
  const record = normaliseSerialRecord(raw, safe);
  const errors = validateSerialRecord(db, record, safe, account.id, 'edit');
  if (Object.keys(errors).length) return { ok: false, errors };
  account.name = record.name;
  account.className = record.className;
  account.loginId = record.username;
  account.active = record.active;
  account.autoApprove = record.autoApprove;
  if (record.password) {
    account.salt = makeSalt();
    account.passwordHash = hashPassword(record.password, account.salt, PASSWORD_HASH_ITERATIONS);
    account.hashIterations = PASSWORD_HASH_ITERATIONS;
    account.passwordUpdatedAt = now;
  }
  syncSerialRecord(db, account, record.serial, now);
  appendActivity(db, actor, 'serial-update', `Updated ${safe} serial record and login account for ${account.loginId}.`, now);
  return { ok: true, errors: {}, account: publicAccount(account), serial: account.serial };
}

export function deleteSerialRecord(db, accountId, actor, now = Date.now()) {
  const account = findAccountById(db, accountId);
  if (!account) return { ok: false, errors: { general: 'That serial record no longer exists.' } };
  if (account.permanent || account.role === 'admin') return { ok: false, errors: { general: 'Administrator accounts are not managed as serial records.' } };
  const oldSerial = normaliseSerial(account.serial) || null;
  db.serials = db.serials.filter((serial) => !(serial.assignedTo === account.id
    || (oldSerial && normaliseSerial(serial.code) === oldSerial)));
  db.accounts = db.accounts.filter((entry) => entry.id !== account.id);
  appendActivity(db, actor, 'serial-delete', `Deleted the ${account.role} serial record and linked login account for ${account.loginId}. Existing requests were kept.`, now);
  return { ok: true, errors: {}, account: publicAccount(account), serial: oldSerial };
}

export function applySerialRows(db, inputRows, actor, now = Date.now()) {
  const preview = prepareSerialRows(db, inputRows);
  const created = [];
  const failed = [];
  for (const row of preview.rows) {
    if (!row.valid) {
      failed.push({ ...safeSerialRow(row), status: 'error', reason: row.errorText || 'Incomplete record.' });
      continue;
    }
    try {
      const result = createSerialRecord(db, row, row.role, actor, now);
      if (!result.ok) throw new Error(Object.values(result.errors).join(' ') || 'Record could not be created.');
      created.push(result.account);
      failed.push({ ...safeSerialRow(row), status: 'created', reason: 'Created and linked.', accountId: result.account.id });
    } catch (error) {
      failed.push({ ...safeSerialRow(row), status: 'error', reason: error && error.message ? error.message : 'Record could not be created.' });
    }
  }
  return {
    ok: created.length > 0,
    successful: created.length,
    unsuccessful: preview.invalidCount + (failed.filter((row) => row.status === 'error').length - preview.invalidCount),
    total: preview.total,
    created,
    report: failed,
    rows: preview.rows.map(safeSerialRow)
  };
}
