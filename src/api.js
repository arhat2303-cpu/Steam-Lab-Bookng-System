import {
  formatDateTime, formatDate, formatTime, formatDuration, formatLongWeekday,
  dayKey, startOfDay, parseHHMM, csvEscape, makeId, hashPassword, makeSalt,
  PASSWORD_HASH_ITERATIONS, verifyPassword, readFileBytes, putFile, getFile, clearFiles, bytesToBase64,
  base64ToBytes, utf8ToString, toBytes, getStorageNotice, clampNumber
} from './core.js';
import {
  DEFAULT_SETTINGS, VALID_PRIORITIES, ACTIVE_STATUSES, PERMANENT_ADMINS,
  getDb, commitDb, replaceDb, resetToFactoryDatabase, findAccountById, findAccountByLogin,
  findRequestById, findSerial, makeRequestCode, nextSerialCodes, createAccountRecord,
  validateDatabase, serialFormat, publicAccount
} from './db.js';
import { estimateFromFile, isSupportedUpload, getExtension, MODEL_EXTENSIONS, IMAGE_EXTENSIONS } from './estimate.js';
import { scheduleRequests } from './scheduler.js';
import {
  SERIAL_TEMPLATE_FILE, SERIAL_TEMPLATE_MIME, buildSerialsTemplate, parseSerialsWorkbook
} from './xlsx.js';
import {
  prepareSerialRows, applySerialRows,
  createSerialRecord as createSerialRecordPure,
  updateSerialRecord as updateSerialRecordPure,
  deleteSerialRecord as deleteSerialRecordPure
} from './serials.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export const STATUS_LABELS = {
  pending: 'Pending review',
  approved: 'Approved',
  rejected: 'Rejected',
  printing: 'Printing',
  printed: 'Printed · awaiting hand-over',
  handed: 'Handed over',
  cancelled: 'Cancelled'
};

export const PRIORITY_LABELS = {
  urgent: 'Urgent',
  high: 'High',
  normal: 'Normal',
  low: 'Low'
};

export const MATERIALS = ['PLA', 'PETG', 'ABS', 'TPU', 'Resin', 'Nylon', 'Other'];

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normaliseSerial(value) {
  return String(value || '').trim().toUpperCase();
}

function serialPattern(role) {
  return role === 'student' ? /^STU-\d{4}$/ : /^T-\d{4}$/;
}

const PERMANENT_ADMIN_IDS = new Set(PERMANENT_ADMINS.map((admin) => admin.id));
const PERMANENT_ADMIN_LOGINS = new Set(PERMANENT_ADMINS.map((admin) => admin.loginId.toUpperCase()));

function isPermanentAdmin(account) {
  if (!account) return false;
  return Boolean(account.permanent)
    || PERMANENT_ADMIN_IDS.has(account.id)
    || PERMANENT_ADMIN_LOGINS.has(String(account.loginId || '').toUpperCase());
}

function requireSession(actor) {
  const session = getSessionAccount();
  if (!session) throw new Error('Sign in is required for this action.');
  if (actor && actor.id && actor.id !== session.id) throw new Error('The signed-in account does not match this request.');
  return session;
}

function requireAdmin(actor) {
  const session = requireSession(actor);
  if (session.role !== 'admin') throw new Error('Administrator sign-in is required for account management.');
  return session;
}

function assertActorRole(actor, roles) {
  if (!actor || !roles.includes(actor.role)) throw new Error('This account does not have permission for that action.');
}

function requireSessionActor(actor, roles) {
  const session = requireSession(actor);
  assertActorRole(session, roles);
  return session;
}

function commitIfRequested(options) {
  if (!options || options.commit !== false) commitDb();
}

function actorName(actor) {
  if (!actor) return 'system';
  if (typeof actor === 'string') return actor;
  return actor.name || actor.loginId || actor.id || 'system';
}

function addActivity(db, actor, action, detail, now = Date.now()) {
  db.activity.push({
    id: makeId('act'),
    at: now,
    actor: typeof actor === 'object' ? actor.id : (actor || 'system'),
    actorName: actorName(actor),
    action,
    detail
  });
  db.activity = db.activity.slice(-100);
}

export function effectiveMinutes(request) {
  const adjusted = Number(request && request.adjustedMinutes);
  if (Number.isFinite(adjusted) && adjusted > 0) return adjusted;
  const estimate = request && isObject(request.estimate) ? request.estimate : {};
  const total = Number(estimate.totalMinutes);
  if (Number.isFinite(total) && total > 0) return total;
  const perCopy = Number(estimate.minutes) || 30;
  const copies = Math.max(1, Number(request && request.copies) || 1);
  return perCopy * copies;
}

export function statusText(request) {
  if (request.status === 'approved' && request.slotConfirmedAt) return 'Slot confirmed';
  return STATUS_LABELS[request.status] || request.status;
}

export function scheduleText(request) {
  const segments = request && request.schedule && Array.isArray(request.schedule.segments) ? request.schedule.segments : [];
  if (!segments.length) return 'Not scheduled';
  const first = segments[0];
  const last = segments[segments.length - 1];
  const opening = `${formatDateTime(first.start)} – ${formatTime(first.end)}`;
  return segments.length > 1 ? `${opening} · ${segments.length} blocks until ${formatDate(last.end)}` : opening;
}

function scheduleSignature(request) {
  const schedule = request.schedule || {};
  const segments = Array.isArray(schedule.segments) ? schedule.segments : [];
  return JSON.stringify({
    segments: segments.map((segment) => [segment.start, segment.end, segment.coolEnd]),
    reason: schedule.reason || '',
    fixed: Boolean(schedule.fixed),
    scheduledAt: schedule.scheduledAt || null,
    releasedAt: schedule.releasedAt || null
  });
}

export function runScheduler(db, now = Date.now()) {
  const before = db.requests.map(scheduleSignature).join('|');
  for (const request of db.requests) {
    if (request.status === 'printing' && (!Array.isArray(request.schedule.segments) || !request.schedule.segments.length) && request.workflow.startedAt) {
      const start = Number(request.workflow.startedAt);
      const end = start + effectiveMinutes(request) * 60000;
      request.schedule.segments = [{ start, end, coolEnd: end + Number(db.settings.restGapMinutes || 0) * 60000, minutes: effectiveMinutes(request) }];
    }
  }
  const result = scheduleRequests({ requests: db.requests, settings: db.settings, now });
  for (const request of db.requests) {
    const placement = result.placements[request.id];
    if (request.status === 'printing') {
      if (placement && placement.segments.length) {
        request.schedule.segments = placement.segments.map((segment) => ({ ...segment }));
      }
      request.schedule.fixed = true;
      request.schedule.reason = 'Locked while printing; the scheduler will not move this job.';
      continue;
    }
    if (request.status === 'approved') {
      if (placement && !placement.unscheduled && placement.segments.length) {
        request.schedule = {
          segments: placement.segments.map((segment) => ({ ...segment })),
          reason: placement.reason,
          scheduledAt: now,
          fixed: false,
          releasedAt: null
        };
      } else {
        request.schedule = {
          segments: [],
          reason: placement ? placement.reason : 'No valid slot is currently available.',
          scheduledAt: now,
          fixed: false,
          releasedAt: null
        };
      }
      continue;
    }
    if (Array.isArray(request.schedule.segments) && request.schedule.segments.length) {
      request.schedule.segments = [];
      request.schedule.fixed = false;
      request.schedule.releasedAt = request.schedule.releasedAt || now;
      request.schedule.reason = request.schedule.reason || 'Reservation released; future printing time is available again.';
    }
  }
  const after = db.requests.map(scheduleSignature).join('|');
  return { result, changed: before !== after };
}

export function bootstrap(now = Date.now()) {
  const db = getDb();
  const outcome = runScheduler(db, now);
  if (outcome.changed) commitDb();
  return db;
}

export async function ensureSeedFiles() {
  const db = getDb();
  let changed = false;
  for (const request of db.requests) {
    const pointer = request.file && request.file.pointer;
    if (!pointer || pointer.backend !== 'seed') continue;
    const stored = await getFile(pointer);
    if (!stored) continue;
    const fresh = await putFile(pointer.key, stored.bytes, { name: request.file.name || pointer.name, mime: request.file.mime || pointer.mime });
    request.file.pointer = { ...pointer, ...fresh, seedKey: pointer.seedKey || pointer.key };
    request.file.size = stored.bytes.length;
    changed = true;
  }
  if (changed) commitDb();
  return { changed, notice: getStorageNotice() };
}

export function getSessionAccount() {
  const db = getDb();
  if (!db.session) return null;
  const account = findAccountById(db, db.session.accountId);
  if (!account || !account.active) {
    db.session = null;
    commitDb();
    return null;
  }
  return publicAccount(account);
}

function releaseAccountSerial(db, account) {
  if (!account || !account.serial) return;
  const record = findSerial(db, account.serial);
  if (record && record.assignedTo === account.id) {
    record.status = 'free';
    record.assignedTo = null;
    record.assignedAt = null;
  }
  account.serial = null;
  account.serialAssignedAt = null;
}

export function login(payload, now = Date.now()) {
  const db = getDb();
  const role = String(payload.role || '');
  const loginId = String(payload.loginId || '').trim();
  const password = String(payload.password || '');
  const errors = {};
  if (!['student', 'teacher', 'admin'].includes(role)) errors.general = 'Choose a valid role.';
  if (!loginId) errors.loginId = 'Enter your username.';
  if (!password) errors.password = 'Enter your password.';
  if (Object.keys(errors).length) return { ok: false, errors };

  const account = findAccountByLogin(db, loginId, role);
  if (!account || !account.active || !verifyPassword(password, account)) {
    errors.password = 'Username or password is incorrect.';
    return { ok: false, errors };
  }
  db.session = { accountId: account.id, role: account.role, name: account.name, loginAt: now };
  addActivity(db, account, 'login', `${account.name} signed in as ${account.role}.`, now);
  commitDb();
  return { ok: true, account: publicAccount(account), errors: {} };
}

export function logout(actor, now = Date.now()) {
  const db = getDb();
  addActivity(db, actor || db.session, 'logout', 'Signed out.', now);
  db.session = null;
  commitDb();
  return true;
}

function validateRequestFields(db, form, actor, studentId) {
  const errors = {};
  const title = String(form.title || '').trim();
  const infill = Number(form.infill);
  const copies = Number(form.copies);
  const material = String(form.material || '').trim();
  if (!title) errors.title = 'Give this print request a title.';
  if (!Number.isFinite(infill) || infill < 0 || infill > 100) errors.infill = 'Infill must be between 0 and 100%.';
  if (!Number.isFinite(copies) || copies < 1 || copies > 99 || !Number.isInteger(copies)) errors.copies = 'Copies must be a whole number from 1 to 99.';
  if (!material) errors.material = 'Choose a material.';
  if (actor && actor.role === 'admin') {
    const student = findAccountById(db, studentId);
    if (!student || student.role !== 'student' || !student.active) errors.studentId = 'Choose an active student account.';
  }
  if (studentId) {
    const active = db.requests.filter((request) => request.studentId === studentId && ACTIVE_STATUSES.includes(request.status)).length;
    const cap = Math.max(1, Number(db.settings.maxActivePerStudent) || 3);
    if (active >= cap) errors.general = `This student already has ${active} active requests; the lab limit is ${cap}.`;
  }
  return errors;
}

function validateUpload(db, file) {
  const errors = {};
  if (!file) {
    errors.file = 'Choose a 3D model or supporting image to upload.';
    return errors;
  }
  const extension = getExtension(file.name);
  if (!isSupportedUpload(file.name)) {
    errors.file = `Unsupported file type .${extension || 'unknown'}. Allowed: ${MODEL_EXTENSIONS.map((item) => `.${item}`).join(' ')} plus common images.`;
    return errors;
  }
  const size = Number(file.size) || 0;
  const limit = Math.max(1, Number(db.settings.maxUploadMB) || 25) * 1024 * 1024;
  if (size <= 0) errors.file = 'The selected file is empty.';
  else if (size > limit) errors.file = `File is ${(size / 1024 / 1024).toFixed(1)} MB; the lab limit is ${db.settings.maxUploadMB} MB.`;
  return errors;
}

export async function previewEstimate(file, form, now = Date.now()) {
  const db = getDb();
  const errors = { ...validateUpload(db, file), ...validateRequestFields(db, form, null, null) };
  delete errors.title;
  delete errors.material;
  delete errors.general;
  delete errors.studentId;
  if (Object.keys(errors).length) return { ok: false, errors };
  let bytes;
  try {
    bytes = await readFileBytes(file);
  } catch (error) {
    return { ok: false, errors: { file: error.message || 'The file could not be read.' } };
  }
  const estimate = estimateFromFile({
    name: file.name,
    bytes,
    size: Number(file.size) || bytes.length,
    infill: Number(form.infill),
    copies: Number(form.copies),
    buildVolume: db.settings.buildVolume,
    now
  });
  return { ok: true, errors: {}, bytes, estimate };
}

export function createRequestRecord(db, payload, actor, now = Date.now()) {
  assertActorRole(actor, ['student', 'admin']);
  const studentId = actor && actor.role === 'admin' ? String(payload.studentId || '') : (actor && actor.id);
  const student = findAccountById(db, studentId);
  const errors = validateRequestFields(db, payload, actor, studentId);
  if (!student || student.role !== 'student') errors.studentId = 'A student account is required for this request.';
  if (Object.keys(errors).length) return { ok: false, errors };
  const code = makeRequestCode(db);
  const autoApproved = Boolean(student.autoApprove);
  const request = {
    id: makeId('req'),
    code,
    studentId: student.id,
    studentName: student.name,
    title: String(payload.title).trim(),
    notes: String(payload.notes || '').trim(),
    material: String(payload.material || 'PLA').trim(),
    colour: String(payload.colour || 'Not specified').trim() || 'Not specified',
    infill: Number(payload.infill),
    copies: Number(payload.copies),
    status: autoApproved ? 'approved' : 'pending',
    priority: 'normal',
    submittedAt: now,
    approvedAt: autoApproved ? now : null,
    approvedBy: autoApproved ? actor.id : null,
    adjustedMinutes: null,
    rejectionReason: null,
    cancelReason: null,
    slotConfirmedAt: null,
    slotConfirmedBy: null,
    file: payload.file,
    estimate: payload.estimate,
    schedule: { segments: [], reason: autoApproved ? 'Auto-approved; scheduler is placing the slot.' : 'Awaiting teacher review.', scheduledAt: null, fixed: false, releasedAt: null },
    workflow: { startedAt: null, printedAt: null, handedAt: null, printMinutes: null },
    createdAt: now
  };
  db.requests.push(request);
  if (autoApproved) runScheduler(db, now);
  addActivity(db, actor, 'request', `${code} submitted by ${student.name}${autoApproved ? ' and auto-approved' : ''}.`, now);
  return { ok: true, errors: {}, request };
}

export async function submitRequest(payload, actor, now = Date.now()) {
  const db = getDb();
  const session = requireSessionActor(actor, ['student', 'admin']);
  const preflight = validateRequestFields(db, payload, session, session.role === 'admin' ? payload.studentId : session.id);
  const fileErrors = validateUpload(db, payload.file);
  const errors = { ...preflight, ...fileErrors };
  if (Object.keys(errors).length) return { ok: false, errors };
  const preview = await previewEstimate(payload.file, payload, now);
  if (!preview.ok) return { ok: false, errors: { ...errors, ...preview.errors } };
  const pointer = await putFile(makeId('file'), preview.bytes, {
    name: payload.file.name,
    mime: payload.file.type || 'application/octet-stream'
  });
  const fileRecord = {
    name: payload.file.name,
    size: Number(payload.file.size) || preview.bytes.length,
    mime: payload.file.type || 'application/octet-stream',
    pointer
  };
  const created = createRequestRecord(db, { ...payload, file: fileRecord, estimate: preview.estimate }, session, now);
  if (!created.ok) return created;
  commitDb();
  return created;
}

export async function getRequestFile(id, actor) {
  const session = requireSession(actor);
  const db = getDb();
  const request = findRequestById(db, id);
  if (!request || !request.file || !request.file.pointer) return null;
  if (session.role === 'student' && request.studentId !== session.id) {
    throw new Error('Students can download only their own uploaded files.');
  }
  const stored = await getFile(request.file.pointer);
  if (!stored) return null;
  return {
    bytes: stored.bytes,
    name: request.file.name || stored.name || 'download.bin',
    mime: request.file.mime || stored.mime || 'application/octet-stream'
  };
}

export async function reestimateFromFile(id, actor, now = Date.now()) {
  const session = requireSessionActor(actor, ['teacher', 'admin']);
  const db = getDb();
  const request = findRequestById(db, id);
  if (!request) throw new Error('That request no longer exists.');
  const stored = await getFile(request.file && request.file.pointer);
  if (!stored) throw new Error('The uploaded file is no longer available for re-estimation.');
  const estimate = estimateFromFile({
    name: request.file.name,
    bytes: stored.bytes,
    size: stored.bytes.length,
    infill: request.infill,
    copies: request.copies,
    buildVolume: db.settings.buildVolume,
    now
  });
  estimate.reestimatedAt = now;
  estimate.previousMinutes = Number(request.estimate.minutes) || null;
  request.estimate = estimate;
  if (request.status === 'approved') runScheduler(db, now);
  addActivity(db, session, 'estimate', `${request.code} re-estimated from ${request.file.name}.`, now);
  commitDb();
  return estimate;
}

export function approveRequestRecord(db, id, options, actor, now = Date.now()) {
  assertActorRole(actor, ['teacher', 'admin']);
  const request = findRequestById(db, id);
  if (!request || request.status !== 'pending') return { ok: false, errors: { general: 'Only pending requests can be approved.' } };
  const errors = {};
  let adjustedMinutes = null;
  if (options.minutes !== '' && options.minutes !== null && options.minutes !== undefined) {
    const minutes = Number(options.minutes);
    if (!Number.isFinite(minutes) || minutes <= 0) errors.minutes = 'Enter a positive number of minutes, or leave blank to use the file estimate.';
    else adjustedMinutes = Math.ceil(minutes);
  }
  const priority = String(options.priority || 'normal');
  if (!VALID_PRIORITIES.includes(priority)) errors.priority = 'Choose a valid priority.';
  if (Object.keys(errors).length) return { ok: false, errors };
  request.status = 'approved';
  request.approvedAt = now;
  request.approvedBy = actor.id;
  request.adjustedMinutes = adjustedMinutes;
  request.priority = priority;
  request.rejectionReason = null;
  request.slotConfirmedAt = null;
  request.slotConfirmedBy = null;
  request.schedule = { segments: [], reason: 'Approved; scheduler is placing the slot.', scheduledAt: null, fixed: false, releasedAt: null };
  runScheduler(db, now);
  addActivity(db, actor, 'approve', `${request.code} approved with ${adjustedMinutes ? `${adjustedMinutes} min override` : 'file estimate'} and ${priority} priority.`, now);
  commitIfRequested(options);
  return { ok: true, errors: {}, request, schedule: scheduleText(request) };
}

export function rejectRequest(db, id, reason, actor, now = Date.now()) {
  const session = requireSessionActor(actor, ['teacher', 'admin']);
  const request = findRequestById(db, id);
  if (!request || request.status !== 'pending') return { ok: false, errors: { reason: 'Only pending requests can be rejected.' } };
  const cleanReason = String(reason || '').trim();
  if (!cleanReason) return { ok: false, errors: { reason: 'A rejection reason is required so the student can see what to change.' } };
  request.status = 'rejected';
  request.rejectionReason = cleanReason;
  request.schedule = { segments: [], reason: 'Rejected; no printer time is reserved.', scheduledAt: null, fixed: false, releasedAt: now };
  runScheduler(db, now);
  addActivity(db, session, 'reject', `${request.code} rejected: ${cleanReason}`, now);
  commitDb();
  return { ok: true, errors: {}, request };
}

export function confirmSlot(db, id, actor, now = Date.now()) {
  const session = requireSessionActor(actor, ['teacher', 'admin']);
  const request = findRequestById(db, id);
  if (!request || request.status !== 'approved') return { ok: false, errors: { general: 'Only approved requests have a slot to confirm.' } };
  if (!request.schedule.segments.length) return { ok: false, errors: { general: 'This request has no scheduled slot yet.' } };
  request.slotConfirmedAt = now;
  request.slotConfirmedBy = session.id;
  addActivity(db, session, 'confirm', `${request.code} slot confirmed for ${scheduleText(request)}.`, now);
  commitDb();
  return { ok: true, errors: {}, request };
}

export function startPrint(db, id, actor, now = Date.now()) {
  const session = requireSessionActor(actor, ['teacher', 'admin']);
  const request = findRequestById(db, id);
  if (!request || request.status !== 'approved') return { ok: false, errors: { general: 'Start print is available only for approved requests.' } };
  if (!request.slotConfirmedAt) return { ok: false, errors: { general: 'Confirm the slot before starting the print.' } };
  if (!request.schedule.segments.length) return { ok: false, errors: { general: 'This request has no scheduled slot to start.' } };
  request.status = 'printing';
  request.workflow.startedAt = now;
  request.schedule.fixed = true;
  request.schedule.reason = 'Printing in progress; this job is locked and will not be moved.';
  runScheduler(db, now);
  addActivity(db, session, 'start', `${request.code} started printing; schedule locked.`, now);
  commitDb();
  return { ok: true, errors: {}, request };
}

export function markPrinted(db, id, actor, now = Date.now()) {
  const session = requireSessionActor(actor, ['teacher', 'admin']);
  const request = findRequestById(db, id);
  if (!request || request.status !== 'printing') return { ok: false, errors: { general: 'Mark printed is available only while a job is printing.' } };
  request.status = 'printed';
  request.workflow.printedAt = now;
  request.workflow.printMinutes = effectiveMinutes(request);
  request.schedule = { segments: [], reason: 'Released after printing; future reserved time is available again.', scheduledAt: null, fixed: false, releasedAt: now };
  runScheduler(db, now);
  addActivity(db, session, 'printed', `${request.code} marked printed; reserved time released.`, now);
  commitDb();
  return { ok: true, errors: {}, request };
}

export function handOver(db, id, actor, now = Date.now()) {
  const session = requireSessionActor(actor, ['teacher', 'admin']);
  const request = findRequestById(db, id);
  if (!request || request.status !== 'printed') return { ok: false, errors: { general: 'Hand-over is available only after a job is printed.' } };
  request.status = 'handed';
  request.workflow.handedAt = now;
  request.schedule = { segments: [], reason: 'Released after hand-over.', scheduledAt: null, fixed: false, releasedAt: now };
  runScheduler(db, now);
  addActivity(db, session, 'handover', `${request.code} handed to ${request.studentName}.`, now);
  commitDb();
  return { ok: true, errors: {}, request };
}

export function cancelRequestRecord(db, id, actor, reason, now = Date.now(), options = {}) {
  assertActorRole(actor, ['student', 'teacher', 'admin']);
  const request = findRequestById(db, id);
  if (!request) return { ok: false, errors: { general: 'That request no longer exists.' } };
  if (!['pending', 'approved'].includes(request.status)) return { ok: false, errors: { general: 'Only pending or approved requests can be cancelled.' } };
  if (actor && actor.role === 'student' && request.studentId !== actor.id) return { ok: false, errors: { general: 'You can cancel only your own requests.' } };
  request.status = 'cancelled';
  request.cancelReason = String(reason || 'Cancelled before printing.').trim();
  request.schedule = { segments: [], reason: 'Cancelled; reserved time released.', scheduledAt: null, fixed: false, releasedAt: now };
  runScheduler(db, now);
  addActivity(db, actor, 'cancel', `${request.code} cancelled; reserved time released.`, now);
  commitIfRequested(options);
  return { ok: true, errors: {}, request };
}

export function approveRequest(db, id, options, actor, now = Date.now()) {
  const session = requireSessionActor(actor, ['teacher', 'admin']);
  return approveRequestRecord(db, id, options, session, now);
}

export function cancelRequest(db, id, actor, reason, now = Date.now(), options = {}) {
  const session = requireSessionActor(actor, ['student', 'teacher', 'admin']);
  return cancelRequestRecord(db, id, session, reason, now, options);
}

export function rerunScheduler(actor, now = Date.now()) {
  const session = requireSessionActor(actor, ['teacher', 'admin']);
  const db = getDb();
  const outcome = runScheduler(db, now);
  commitDb();
  addActivity(db, session, 'schedule', 'Scheduler re-run manually.', now);
  commitDb();
  return outcome;
}

function validateAccountInput(db, raw, mode, currentAccountId = null) {
  const errors = {};
  const current = currentAccountId ? findAccountById(db, currentAccountId) : null;
  const role = String(raw.role || '');
  const loginId = String(raw.loginId || '').trim();
  const name = String(raw.name || '').trim();
  const className = String(raw.className || '').trim();
  const password = String(raw.password || '');
  const serial = normaliseSerial(raw.serial);
  if (current && isPermanentAdmin(current)) {
    errors.general = 'Permanent administrator accounts are fixed and cannot be changed.';
  }
  if (!['student', 'teacher', 'admin'].includes(role)) errors.role = 'Choose a valid role.';
  if (!name) errors.name = role === 'student' ? 'Enter the student’s full name.' : role === 'teacher' ? 'Enter the teacher’s full name.' : 'Enter a display name.';
  if (!loginId) errors.loginId = 'Enter a username.';
  if (db.accounts.some((account) => account.id !== currentAccountId && account.loginId.toLowerCase() === loginId.toLowerCase())) {
    errors.loginId = 'That username is already used by another account.';
  }
  if ((mode === 'create' || password) && password.length < 6) {
    errors.password = 'Use at least 6 characters, or leave blank to keep the current password.';
  }
  if (role === 'student') {
    if (!className) errors.className = 'Enter the student’s class.';
    if (!serial) errors.serial = 'Enter a unique student serial number.';
    else if (!serialPattern('student').test(serial)) errors.serial = 'Student serial numbers use STU-####.';
    else {
      const duplicateAccount = db.accounts.some((account) => account.id !== currentAccountId
        && account.role === 'student'
        && normaliseSerial(account.serial) === serial);
      const record = findSerial(db, serial);
      if (duplicateAccount) errors.serial = 'That student serial number is already assigned to another account.';
      else if (record && record.role !== 'student') errors.serial = 'That serial belongs to a teacher account.';
      else if (record && record.assignedTo && record.assignedTo !== currentAccountId) errors.serial = 'That serial number is already assigned to another account.';
    }
  }
  return errors;
}

function assignSerialToAccount(db, account, code, now) {
  const serial = normaliseSerial(code);
  if (!serial) return;
  let record = findSerial(db, serial);
  if (!record) {
    record = { code: serial, role: account.role, status: 'free', assignedTo: null, assignedAt: null, createdAt: now };
    db.serials.push(record);
  }
  record.status = 'assigned';
  record.assignedTo = account.id;
  record.assignedAt = now;
  account.serial = serial;
  account.serialAssignedAt = now;
}

export function createAccount(raw, actor, now = Date.now()) {
  const admin = requireAdmin(actor);
  const db = getDb();
  const errors = validateAccountInput(db, raw, 'create');
  if (Object.keys(errors).length) return { ok: false, errors };
  const account = createAccountRecord({
    role: raw.role,
    name: raw.name,
    className: raw.role === 'student' ? raw.className : '',
    loginId: raw.loginId,
    password: raw.password,
    serial: raw.role === 'student' ? normaliseSerial(raw.serial) : null,
    active: raw.active !== false,
    autoApprove: raw.role === 'student' && Boolean(raw.autoApprove),
    permanent: false
  }, now);
  db.accounts.push(account);
  if (account.serial) assignSerialToAccount(db, account, account.serial, now);
  addActivity(db, admin, 'account-create', `Created ${account.role} account ${account.loginId}.`, now);
  commitDb();
  return { ok: true, errors: {}, account: publicAccount(account) };
}

export function updateAccount(id, raw, actor, now = Date.now()) {
  const admin = requireAdmin(actor);
  const db = getDb();
  const account = findAccountById(db, id);
  if (!account) return { ok: false, errors: { general: 'That account no longer exists.' } };
  if (isPermanentAdmin(account)) return { ok: false, errors: { general: 'Permanent administrator accounts are fixed and cannot be changed.' } };
  const errors = validateAccountInput(db, raw, 'edit', id);
  if (Object.keys(errors).length) return { ok: false, errors };
  const newSerial = raw.role === 'student' ? normaliseSerial(raw.serial) : null;
  if (account.serial !== newSerial) releaseAccountSerial(db, account);
  account.role = raw.role;
  account.name = String(raw.name).trim();
  account.className = raw.role === 'student' ? String(raw.className || '').trim() : '';
  account.loginId = String(raw.loginId).trim();
  account.active = raw.active !== false;
  account.autoApprove = raw.role === 'student' && Boolean(raw.autoApprove);
  if (String(raw.password || '')) {
    account.salt = makeSalt();
    account.passwordHash = hashPassword(raw.password, account.salt, PASSWORD_HASH_ITERATIONS);
    account.hashIterations = PASSWORD_HASH_ITERATIONS;
    account.passwordUpdatedAt = now;
  }
  if (newSerial) assignSerialToAccount(db, account, newSerial, now);
  else account.serialAssignedAt = null;
  addActivity(db, admin, 'account-update', `Updated account ${account.loginId}.`, now);
  commitDb();
  return { ok: true, errors: {}, account: publicAccount(account) };
}

export function deleteAccount(id, actor, now = Date.now()) {
  const admin = requireAdmin(actor);
  const db = getDb();
  const account = findAccountById(db, id);
  if (!account) return { ok: false, errors: { general: 'That account no longer exists.' } };
  if (isPermanentAdmin(account)) return { ok: false, errors: { general: 'Permanent administrator accounts cannot be deleted.' } };
  if (db.session && db.session.accountId === id) return { ok: false, errors: { general: 'You cannot delete the account you are signed in with.' } };
  if (account.role === 'admin' && db.accounts.filter((entry) => entry.role === 'admin' && entry.active).length <= 1) {
    return { ok: false, errors: { general: 'The last active admin account cannot be deleted.' } };
  }
  releaseAccountSerial(db, account);
  db.accounts = db.accounts.filter((entry) => entry.id !== id);
  addActivity(db, admin, 'account-delete', `Deleted account ${account.loginId}. Existing requests were kept.`, now);
  commitDb();
  return { ok: true, errors: {} };
}

export function serialsTemplate(actor) {
  requireAdmin(actor);
  return {
    fileName: SERIAL_TEMPLATE_FILE,
    mime: SERIAL_TEMPLATE_MIME,
    bytes: buildSerialsTemplate()
  };
}

export function previewSerialsWorkbook(bytes, actor) {
  requireAdmin(actor);
  const parsed = parseSerialsWorkbook(bytes);
  const preview = prepareSerialRows(getDb(), parsed.rows);
  return { ...preview, sheets: parsed.sheets };
}

export function importSerialRows(rows, actor, now = Date.now()) {
  const admin = requireAdmin(actor);
  const db = getDb();
  const result = applySerialRows(db, Array.isArray(rows) ? rows : [], admin, now);
  commitDb();
  return result;
}

export function bulkCreateSerialRows(rows, role, actor, now = Date.now()) {
  const admin = requireAdmin(actor);
  const safeRole = role === 'teacher' ? 'teacher' : 'student';
  const db = getDb();
  const result = applySerialRows(db, (Array.isArray(rows) ? rows : []).map((row) => ({ ...row, role: safeRole })), admin, now);
  commitDb();
  return { ...result, role: safeRole };
}

export function createSerialEntry(raw, role, actor, now = Date.now()) {
  const admin = requireAdmin(actor);
  const db = getDb();
  const result = createSerialRecordPure(db, raw, role, admin, now);
  if (result.ok) commitDb();
  return result;
}

export function updateSerialEntry(id, raw, role, actor, now = Date.now()) {
  const admin = requireAdmin(actor);
  const db = getDb();
  const result = updateSerialRecordPure(db, id, raw, role, admin, now);
  if (result.ok) commitDb();
  return result;
}

export function deleteSerialEntry(id, actor, now = Date.now()) {
  const admin = requireAdmin(actor);
  const db = getDb();
  const result = deleteSerialRecordPure(db, id, admin, now);
  if (result.ok) commitDb();
  return result;
}

export function changeOwnPassword(payload, actor, now = Date.now()) {
  const session = requireSession(actor);
  if (!['student', 'teacher'].includes(session.role)) {
    throw new Error('Only student and teacher accounts can change their own password here.');
  }
  const db = getDb();
  const account = findAccountById(db, session.id);
  if (!account) throw new Error('The signed-in account no longer exists.');
  const currentPassword = String(payload.currentPassword || '');
  const newPassword = String(payload.newPassword || '');
  const confirmPassword = String(payload.confirmPassword || '');
  const errors = {};
  if (!currentPassword) errors.currentPassword = 'Enter your current password.';
  if (!newPassword) errors.newPassword = 'Enter a new password.';
  else if (newPassword.length < 6) errors.newPassword = 'Use at least 6 characters for the new password.';
  else if (newPassword.length > 128) errors.newPassword = 'Use 128 characters or fewer for the new password.';
  if (!confirmPassword) errors.confirmPassword = 'Confirm the new password.';
  else if (newPassword !== confirmPassword) errors.confirmPassword = 'The new password and confirmation do not match.';
  if (currentPassword && !verifyPassword(currentPassword, account)) errors.currentPassword = 'Current password is incorrect.';
  if (Object.keys(errors).length) return { ok: false, errors };
  account.salt = makeSalt();
  account.passwordHash = hashPassword(newPassword, account.salt, PASSWORD_HASH_ITERATIONS);
  account.hashIterations = PASSWORD_HASH_ITERATIONS;
  account.passwordUpdatedAt = now;
  addActivity(db, session, 'password', `${session.name} changed their own password.`, now);
  commitDb();
  return { ok: true, errors: {}, account: publicAccount(account) };
}

export function generateSerials(raw, actor, now = Date.now()) {
  const admin = requireAdmin(actor);
  const db = getDb();
  const role = String(raw.role || '');
  const count = Number(raw.count);
  const errors = {};
  if (!['student', 'teacher'].includes(role)) errors.role = 'Choose Student or Teacher serials.';
  if (!Number.isInteger(count) || count < 1 || count > 50) errors.count = 'Generate between 1 and 50 serials.';
  if (Object.keys(errors).length) return { ok: false, errors };
  const codes = nextSerialCodes(db, role, count);
  for (const code of codes) db.serials.push({ code, role, status: 'free', assignedTo: null, assignedAt: null, createdAt: now });
  addActivity(db, admin, 'serials', `Generated ${codes.length} ${role} serial${codes.length === 1 ? '' : 's'}.`, now);
  commitDb();
  return { ok: true, errors: {}, codes };
}

export function assignSerial(raw, actor, now = Date.now()) {
  const admin = requireAdmin(actor);
  const db = getDb();
  const code = normaliseSerial(raw.code);
  const account = findAccountById(db, raw.accountId);
  const record = findSerial(db, code);
  const errors = {};
  if (!record || record.status !== 'free') errors.code = 'Choose a free serial number.';
  if (!account || !account.active || !['student', 'teacher'].includes(account.role)) errors.accountId = 'Choose an active student or teacher account.';
  else if (record && record.role !== account.role) errors.accountId = `A ${record.role} serial cannot be assigned to a ${account.role} account.`;
  if (Object.keys(errors).length) return { ok: false, errors };
  releaseAccountSerial(db, account);
  assignSerialToAccount(db, account, code, now);
  addActivity(db, admin, 'serial-assign', `${code} assigned to ${account.loginId}.`, now);
  commitDb();
  return { ok: true, errors: {}, code, account: publicAccount(account) };
}

export function validateSettingsInput(raw) {
  const errors = {};
  const source = isObject(raw) ? raw : {};
  const settings = { ...DEFAULT_SETTINGS, ...source, buildVolume: { ...DEFAULT_SETTINGS.buildVolume, ...(isObject(source.buildVolume) ? source.buildVolume : {}) } };
  settings.openTime = String(source.openTime || '').trim();
  settings.closeTime = String(source.closeTime || '').trim();
  settings.workingDays = Array.isArray(source.workingDays) ? source.workingDays.map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6) : [];
  const numericFields = [
    ['slotMinutes', 5, 180], ['restGapMinutes', 0, 240], ['dailyCapMinutes', 30, 1440],
    ['minLeadMinutes', 0, 10080], ['maxActivePerStudent', 1, 20], ['maxUploadMB', 1, 200]
  ];
  for (const [field, min, max] of numericFields) {
    const value = Number(source[field]);
    if (!Number.isFinite(value) || value < min || value > max) errors[field] = `Enter a number from ${min} to ${max}.`;
    else settings[field] = Math.round(value);
  }
  for (const axis of ['x', 'y', 'z']) {
    const value = Number(settings.buildVolume[axis]);
    if (!Number.isFinite(value) || value < 50 || value > 2000) errors[`buildVolume_${axis}`] = 'Enter 50–2000 mm.';
    else settings.buildVolume[axis] = Math.round(value);
  }
  if (!/^\d{1,2}:\d{2}$/.test(settings.openTime)) errors.openTime = 'Use HH:MM (for example 08:00).';
  if (!/^\d{1,2}:\d{2}$/.test(settings.closeTime)) errors.closeTime = 'Use HH:MM (for example 17:00).';
  if (!errors.openTime && !errors.closeTime) {
    if (parseHHMM(settings.closeTime, 0) <= parseHHMM(settings.openTime, 0)) errors.closeTime = 'Close time must be after open time.';
  }
  if (!settings.workingDays.length) errors.workingDays = 'Select at least one working day.';
  if (!errors.dailyCapMinutes && !errors.slotMinutes && settings.dailyCapMinutes < settings.slotMinutes) errors.dailyCapMinutes = 'Daily cap must be at least one slot.';
  settings.workingDays = Array.from(new Set(settings.workingDays)).sort((a, b) => a - b);
  return { settings, errors };
}

export function updateSettings(raw, actor, now = Date.now()) {
  const admin = requireAdmin(actor);
  const db = getDb();
  const validation = validateSettingsInput(raw);
  if (Object.keys(validation.errors).length) return { ok: false, errors: validation.errors };
  db.settings = validation.settings;
  runScheduler(db, now);
  addActivity(db, admin, 'settings', 'Lab settings updated; schedule recalculated.', now);
  commitDb();
  return { ok: true, errors: {}, settings: db.settings };
}

export function resetSettings(actor, now = Date.now()) {
  const admin = requireAdmin(actor);
  const db = getDb();
  db.settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  runScheduler(db, now);
  addActivity(db, admin, 'settings', 'Lab settings reset to defaults; schedule recalculated.', now);
  commitDb();
  return { ok: true, errors: {}, settings: db.settings };
}

function weekStart(timestamp) {
  const day = startOfDay(timestamp);
  const weekday = new Date(day).getDay();
  return day - ((weekday + 6) % 7) * DAY_MS;
}

export function computeReports(db) {
  const statusCounts = {};
  for (const status of Object.keys(STATUS_LABELS)) statusCounts[status] = 0;
  for (const request of db.requests) {
    if (statusCounts[request.status] !== undefined) statusCounts[request.status] += 1;
  }
  const weekly = new Map();
  const addWeekMinutes = (timestamp, minutes) => {
    const key = weekStart(timestamp);
    const entry = weekly.get(key) || { weekStart: key, label: `Week of ${formatDate(key)}`, minutes: 0 };
    entry.minutes += Math.max(0, Number(minutes) || 0);
    weekly.set(key, entry);
  };
  for (const request of db.requests) {
    if (['approved', 'printing'].includes(request.status) && Array.isArray(request.schedule.segments)) {
      for (const segment of request.schedule.segments) {
        addWeekMinutes(segment.start, Number(segment.minutes) || (segment.end - segment.start) / 60000);
      }
    } else if (['printed', 'handed'].includes(request.status) && request.workflow.printedAt) {
      addWeekMinutes(request.workflow.printedAt, request.workflow.printMinutes || effectiveMinutes(request));
    }
  }
  const weeklyHours = Array.from(weekly.values())
    .sort((a, b) => a.weekStart - b.weekStart)
    .map((entry) => ({ ...entry, hours: Number((entry.minutes / 60).toFixed(2)) }));
  const studentMap = new Map();
  for (const request of db.requests) {
    if (request.status === 'cancelled') continue;
    const entry = studentMap.get(request.studentId) || { studentId: request.studentId, name: request.studentName, jobs: 0, minutes: 0 };
    entry.jobs += 1;
    entry.minutes += effectiveMinutes(request);
    studentMap.set(request.studentId, entry);
  }
  const busiestStudents = Array.from(studentMap.values()).sort((a, b) => b.jobs - a.jobs || b.minutes - a.minutes || a.name.localeCompare(b.name)).slice(0, 8);
  const lengths = db.requests.filter((request) => !['rejected', 'cancelled'].includes(request.status)).map(effectiveMinutes);
  const averageJobLength = lengths.length ? Number((lengths.reduce((sum, value) => sum + value, 0) / lengths.length).toFixed(1)) : 0;
  const handed = statusCounts.handed || 0;
  return {
    statusCounts,
    totalJobs: db.requests.length,
    weeklyHours,
    busiestStudents,
    averageJobLength,
    completionRate: db.requests.length ? Number((handed / db.requests.length * 100).toFixed(1)) : 0,
    scheduledHours: Number((weeklyHours.reduce((sum, week) => sum + week.hours, 0)).toFixed(2)),
    recentActivity: db.activity.slice(-12).reverse()
  };
}

export function buildScheduleBoard(db, viewer, now = Date.now()) {
  const settings = db.settings;
  const openMinutes = parseHHMM(settings.openTime, 480);
  const closeMinutes = parseHHMM(settings.closeTime, 1020);
  const startHour = Math.floor(openMinutes / 60);
  const endHour = Math.ceil(Math.max(closeMinutes, openMinutes + 60) / 60);
  const totalMinutes = Math.max(60, (endHour - startHour) * 60);
  const hours = [];
  for (let hour = startHour; hour < endHour; hour += 1) hours.push(`${String(hour).padStart(2, '0')}:00`);
  const today = startOfDay(now);
  const weekday = new Date(today).getDay();
  const boardStart = today - ((weekday + 6) % 7) * DAY_MS;
  const boardEnd = boardStart + 14 * DAY_MS;
  const days = [];
  const daysByKey = new Map();
  for (let index = 0; index < 14; index += 1) {
    const date = boardStart + index * DAY_MS;
    const day = {
      date,
      key: dayKey(date),
      label: formatDate(date),
      longLabel: formatLongWeekday(new Date(date).getDay()),
      weekday: new Date(date).getDay(),
      closed: !settings.workingDays.includes(new Date(date).getDay()),
      today: date === today,
      intervals: []
    };
    days.push(day);
    daysByKey.set(day.key, day);
  }
  const gapMs = Math.max(0, Number(settings.restGapMinutes) || 0) * 60000;
  const role = viewer && viewer.role ? viewer.role : 'guest';
  const ownId = viewer && viewer.id;

  const appendInterval = (request, start, end, kind) => {
    if (end <= start || start >= boardEnd || end <= boardStart) return;
    for (const day of days) {
      const windowStart = day.date + startHour * 60 * 60000;
      const windowEnd = day.date + endHour * 60 * 60000;
      const clippedStart = Math.max(start, windowStart);
      const clippedEnd = Math.min(end, windowEnd);
      if (clippedEnd <= clippedStart) continue;
      const anonymous = role === 'student' && request.studentId !== ownId;
      const label = anonymous
        ? (kind === 'cool' ? 'Reserved gap' : 'Occupied')
        : kind === 'cool'
          ? 'Cool-down'
          : `${request.code} · ${request.title}${role === 'student' ? '' : ` · ${request.studentName}`}`;
      day.intervals.push({
        id: `${request.id}-${kind}-${Math.round(start)}`,
        kind,
        anonymous,
        locked: request.status === 'printing',
        status: request.status,
        requestId: request.id,
        label,
        title: anonymous ? label : `${request.code} — ${statusText(request)}${kind === 'cool' ? ' cool-down gap' : ''}`,
        left: Number(((clippedStart - windowStart) / 60000 / totalMinutes * 100).toFixed(3)),
        width: Number(((clippedEnd - clippedStart) / 60000 / totalMinutes * 100).toFixed(3))
      });
    }
  };

  for (const request of db.requests) {
    const segments = request.schedule && Array.isArray(request.schedule.segments) ? request.schedule.segments : [];
    for (const segment of segments) {
      appendInterval(request, Number(segment.start), Number(segment.end), 'job');
      const coolEnd = Number(segment.coolEnd || Number(segment.end) + gapMs);
      if (gapMs > 0) appendInterval(request, Number(segment.end), coolEnd, 'cool');
    }
  }
  for (const day of days) day.intervals.sort((a, b) => a.left - b.left || a.width - b.width);

  const reasons = [];
  for (const request of db.requests) {
    if (!request.schedule || !Array.isArray(request.schedule.segments) || !request.schedule.segments.length) continue;
    if (role === 'student' && request.studentId !== ownId) continue;
    reasons.push({
      requestId: request.id,
      code: request.code,
      title: request.title,
      studentName: role === 'student' ? '' : request.studentName,
      status: statusText(request),
      reason: request.schedule.reason || 'Scheduled in the next free valid slot.',
      when: scheduleText(request)
    });
  }
  return {
    days,
    hours,
    hourCount: hours.length,
    boardStart,
    boardEnd,
    windowLabel: `${formatDate(boardStart)} – ${formatDate(boardEnd - DAY_MS)}`,
    todayKey: dayKey(today),
    reasons,
    totalBlocks: days.reduce((sum, day) => sum + day.intervals.filter((interval) => interval.kind === 'job').length, 0),
    coolBlocks: days.reduce((sum, day) => sum + day.intervals.filter((interval) => interval.kind === 'cool').length, 0),
    slotMinutes: settings.slotMinutes,
    restGapMinutes: settings.restGapMinutes
  };
}

export function exportRequestsCsv(db) {
  const header = ['Code', 'Student', 'Title', 'Status', 'Priority', 'Material', 'Colour', 'Infill', 'Copies', 'Estimate min', 'Adjusted min', 'Submitted', 'Schedule', 'Reason', 'File'];
  const rows = db.requests.map((request) => [
    request.code, request.studentName, request.title, statusText(request), PRIORITY_LABELS[request.priority] || request.priority,
    request.material, request.colour, request.infill, request.copies, effectiveMinutes(request), request.adjustedMinutes || '',
    formatDateTime(request.submittedAt), scheduleText(request), request.schedule.reason || '', request.file.name || ''
  ]);
  return [header, ...rows].map((row) => row.map(csvEscape).join(',')).join('\r\n');
}

export function exportSerialsCsv(db, actor) {
  requireAdmin(actor);
  const header = ['Serial', 'Role', 'Status', 'Assigned to', 'Assigned at'];
  const rows = db.serials.map((serial) => {
    const account = serial.assignedTo ? findAccountById(db, serial.assignedTo) : null;
    return [serial.code, serial.role, serial.status, account ? `${account.name} (${account.loginId})` : '', serial.assignedAt ? formatDateTime(serial.assignedAt) : ''];
  });
  return [header, ...rows].map((row) => row.map(csvEscape).join(',')).join('\r\n');
}

export function exportReportCsv(db) {
  const report = computeReports(db);
  const rows = [['Section', 'Metric', 'Value']];
  for (const [status, count] of Object.entries(report.statusCounts)) rows.push(['Jobs by status', STATUS_LABELS[status], count]);
  for (const week of report.weeklyHours) rows.push(['Printing hours per week', week.label, week.hours]);
  for (const student of report.busiestStudents) rows.push(['Busiest students', student.name, `${student.jobs} jobs / ${formatDuration(student.minutes)}`]);
  rows.push(['Summary', 'Average job length', formatDuration(report.averageJobLength)]);
  rows.push(['Summary', 'Handed-over completion rate', `${report.completionRate}%`]);
  return rows.map((row) => row.map(csvEscape).join(',')).join('\r\n');
}

export async function exportBackup(actor, now = Date.now()) {
  requireAdmin(actor);
  const db = getDb();
  const validDb = validateDatabase(db);
  const files = [];
  const seen = new Set();
  for (const request of validDb.requests) {
    const pointer = request.file && request.file.pointer;
    if (!pointer || !pointer.key || seen.has(pointer.key)) continue;
    const stored = await getFile(pointer);
    if (!stored) continue;
    seen.add(pointer.key);
    files.push({
      key: pointer.key,
      name: request.file.name || stored.name || 'download.bin',
      mime: request.file.mime || stored.mime || 'application/octet-stream',
      size: stored.bytes.length,
      base64: bytesToBase64(stored.bytes)
    });
  }
  return { format: 'steamlab-backup-v2', createdAt: now, db: validDb, files };
}

export function parseBackupText(text) {
  let payload;
  try {
    payload = JSON.parse(String(text));
  } catch (_) {
    throw new Error('Backup is not valid JSON.');
  }
  if (!isObject(payload) || payload.format !== 'steamlab-backup-v2' || !isObject(payload.db) || !Array.isArray(payload.files)) {
    throw new Error('Backup must be a steamlab-backup-v2 JSON object with db and files.');
  }
  return payload;
}

export async function importBackup(payload, actor, now = Date.now()) {
  const admin = requireAdmin(actor);
  if (!isObject(payload) || payload.format !== 'steamlab-backup-v2' || !isObject(payload.db) || !Array.isArray(payload.files)) {
    throw new Error('Backup failed validation before any database change.');
  }
  const db = validateDatabase(payload.db);
  const pointerByKey = new Map();
  for (const [index, file] of payload.files.entries()) {
    if (!isObject(file) || typeof file.key !== 'string' || typeof file.base64 !== 'string') {
      throw new Error(`Backup file ${index + 1} is missing a key or base64 payload.`);
    }
    let bytes;
    try { bytes = base64ToBytes(file.base64); } catch (_) { throw new Error(`Backup file ${index + 1} has invalid base64 data.`); }
    const pointer = await putFile(file.key, bytes, { name: file.name || 'download.bin', mime: file.mime || 'application/octet-stream' });
    pointerByKey.set(file.key, { ...pointer, seedKey: file.key, size: bytes.length, name: file.name || pointer.name, mime: file.mime || pointer.mime });
  }
  for (const request of db.requests) {
    const pointer = request.file && request.file.pointer;
    if (!pointer || !pointerByKey.has(pointer.key)) continue;
    request.file.pointer = { ...pointer, ...pointerByKey.get(pointer.key) };
    request.file.name = request.file.pointer.name || request.file.name;
    request.file.size = request.file.pointer.size || request.file.size;
  }
  db.session = null;
  addActivity(db, admin, 'import', `Imported ${db.requests.length} requests, ${db.accounts.length} accounts, and ${payload.files.length} files.`, now);
  replaceDb(db);
  return { accounts: db.accounts.length, requests: db.requests.length, files: payload.files.length };
}

export async function resetFactoryData(actor, now = Date.now()) {
  requireAdmin(actor);
  await clearFiles();
  const db = resetToFactoryDatabase(now);
  runScheduler(db, now);
  commitDb();
  await ensureSeedFiles();
  return getDb();
}

export function parseSettingsForm(raw) {
  return validateSettingsInput(raw);
}


export function getUploadExtensionsText() {
  return `${MODEL_EXTENSIONS.map((extension) => `.${extension}`).join(' ')} · ${IMAGE_EXTENSIONS.map((extension) => `.${extension}`).join(' ')}`;
}

export function serialPrefix(role) {
  return serialFormat(role);
}

export function fileSizeLabel(bytes) {
  const size = Number(bytes) || 0;
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(2)} MB`;
}

export function estimateBytes(bytes) {
  return toBytes(bytes).length;
}

export function decodeBackupBytes(bytes) {
  return utf8ToString(bytes);
}

export function clampSetting(value, min, max, fallback) {
  return clampNumber(value, min, max, fallback);
}
