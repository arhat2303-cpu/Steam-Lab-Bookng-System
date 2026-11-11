import assert from 'node:assert/strict';
import { makeId, makeSalt, hashPassword, verifyPassword, PASSWORD_HASH_ITERATIONS } from '../src/core.js';
import {
  resetToFactoryDatabase, getDb, commitDb, findAccountByLogin,
  findAccountById, publicAccount, validateDatabase
} from '../src/db.js';
import {
  getSessionAccount, login, logout, createAccount, updateAccount, deleteAccount,
  approveRequest, createSerialEntry, changeOwnPassword,
  createAdminAccount, updateAdminAccount, deleteAdminAccount
} from '../src/api.js';

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

function generatedPassword() {
  return `${makeId('pw')}-${makeSalt()}`;
}

function becomeFirstAdmin(now = Date.now()) {
  const db = getDb();
  const admin = db.accounts.find((account) => account.role === 'admin' && account.permanent);
  assert.ok(admin, 'a permanent administrator is required');
  db.session = { accountId: admin.id, role: 'admin', name: admin.name, loginAt: now };
  commitDb();
  return getSessionAccount();
}

function freshAdminSession(now = Date.now()) {
  resetToFactoryDatabase(now);
  return becomeFirstAdmin(now);
}

function studentPayload(overrides = {}) {
  return {
    role: 'student',
    name: 'Test Student',
    className: 'Grade 8A',
    loginId: 'test-student',
    password: generatedPassword(),
    serial: 'STU-9101',
    active: true,
    autoApprove: false,
    ...overrides
  };
}

function teacherPayload(overrides = {}) {
  return {
    role: 'teacher',
    name: 'Test Teacher',
    className: '',
    loginId: 'test-teacher',
    password: generatedPassword(),
    serial: '',
    active: true,
    autoApprove: false,
    ...overrides
  };
}

test('factory database starts with exactly three permanent admins and no student or teacher accounts', () => {
  freshAdminSession();
  const db = getDb();
  assert.equal(db.accounts.length, 3);
  assert.equal(db.accounts.filter((account) => account.role === 'admin' && account.permanent).length, 3);
  assert.equal(db.accounts.find((account) => account.loginId === 'ARHATSHAH8149').name, 'ARHAT SHAH');
  assert.equal(db.accounts.find((account) => account.loginId === 'ruthvikabrs123').name, 'RUTHVIKA VANKADHARA');
  assert.equal(db.accounts.find((account) => account.loginId === 'SHASHI1234').name, 'Shashmith Chatterjee');
  assert.equal(db.accounts.filter((account) => account.role === 'student' || account.role === 'teacher').length, 0);
  assert.equal(db.requests.length, 0);
  assert.equal(db.serials.length, 0);
  for (const account of db.accounts) {
    assert.equal(Object.prototype.hasOwnProperty.call(account, 'password'), false);
    assert.match(account.passwordHash, /^[a-f0-9]{64}$/i);
    assert.equal(account.hashIterations, PASSWORD_HASH_ITERATIONS);
    assert.ok(account.salt);
  }
  const safe = publicAccount(db.accounts[0]);
  assert.equal(Object.prototype.hasOwnProperty.call(safe, 'salt'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(safe, 'passwordHash'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(safe, 'hashIterations'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(safe, 'password'), false);
  assert.doesNotThrow(() => validateDatabase(db));
});

test('students and teachers can change their own password after verification', () => {
  const admin = freshAdminSession();
  const payload = studentPayload({ loginId: 'password-student', serial: 'STU-9701' });
  const created = createSerialEntry(payload, 'student', admin);
  assert.equal(created.ok, true, Object.values(created.errors || {}).join(' '));
  const signedIn = login({ role: 'student', loginId: payload.loginId, password: payload.password });
  assert.equal(signedIn.ok, true);

  const wrongCurrent = changeOwnPassword({ currentPassword: 'not-current', newPassword: 'Changed@2026', confirmPassword: 'Changed@2026' }, signedIn.account);
  assert.equal(wrongCurrent.ok, false);
  assert.match(wrongCurrent.errors.currentPassword, /incorrect/i);

  const mismatch = changeOwnPassword({ currentPassword: payload.password, newPassword: 'Changed@2026', confirmPassword: 'Different@2026' }, signedIn.account);
  assert.equal(mismatch.ok, false);
  assert.match(mismatch.errors.confirmPassword, /do not match/i);

  const changed = changeOwnPassword({ currentPassword: payload.password, newPassword: 'Changed@2026', confirmPassword: 'Changed@2026' }, signedIn.account);
  assert.equal(changed.ok, true, Object.values(changed.errors || {}).join(' '));
  assert.equal(Object.prototype.hasOwnProperty.call(changed.account, 'password'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(changed.account, 'salt'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(changed.account, 'passwordHash'), false);
  logout();

  const oldLogin = login({ role: 'student', loginId: payload.loginId, password: payload.password });
  assert.equal(oldLogin.ok, false);
  const newLogin = login({ role: 'student', loginId: payload.loginId, password: 'Changed@2026' });
  assert.equal(newLogin.ok, true);
  assert.equal(newLogin.account.name, payload.name);
  assert.equal(newLogin.account.className, payload.className);
  assert.equal(newLogin.account.serial, payload.serial);
  logout();
});

test('all three permanent administrator usernames are present', () => {
  freshAdminSession();
  const db = getDb();
  assert.ok(findAccountByLogin(db, 'ARHATSHAH8149', 'admin'));
  assert.ok(findAccountByLogin(db, 'ruthvikabrs123', 'admin'));
  assert.ok(findAccountByLogin(db, 'SHASHI1234', 'admin'));
  assert.equal(db.accounts.filter((account) => account.role === 'admin').length, 3);
});

test('a persisted retired administrator username is migrated without resetting existing data', () => {
  freshAdminSession();
  const legacy = JSON.parse(JSON.stringify(getDb()));
  const admin = legacy.accounts.find((account) => account.id === 'acc-admin-ruthvika20');
  assert.ok(admin, 'the stable second administrator id is missing');
  const originalHash = admin.passwordHash;
  admin.loginId = 'RUTHVIKA20';
  legacy.settings.dailyCapMinutes = 395;
  const validated = validateDatabase(legacy);
  const migrated = validated.accounts.find((account) => account.id === admin.id);
  assert.equal(migrated.loginId, 'ruthvikabrs123');
  assert.equal(migrated.name, 'RUTHVIKA VANKADHARA');
  assert.equal(migrated.passwordHash, originalHash);
  assert.equal(validated.settings.dailyCapMinutes, 395);
  assert.ok(findAccountByLogin(validated, 'ruthvikabrs123', 'admin'));
  assert.equal(findAccountByLogin(validated, 'RUTHVIKA20', 'admin'), null);
  assert.doesNotThrow(() => validateDatabase(validated));
});

test('an older two-admin database gains the third permanent admin without losing data', () => {
  freshAdminSession();
  const legacy = JSON.parse(JSON.stringify(getDb()));
  legacy.accounts = legacy.accounts.filter((account) => account.loginId !== 'SHASHI1234');
  legacy.settings.dailyCapMinutes = 391;
  assert.equal(legacy.accounts.length, 2);
  const migrated = validateDatabase(legacy);
  assert.equal(migrated.accounts.filter((account) => account.role === 'admin' && account.permanent).length, 3);
  const added = findAccountByLogin(migrated, 'SHASHI1234', 'admin');
  assert.equal(added.name, 'Shashmith Chatterjee');
  assert.equal(added.permanent, true);
  assert.equal(migrated.settings.dailyCapMinutes, 391);
  assert.doesNotThrow(() => validateDatabase(migrated));
});

test('administrators can create other administrators who can also add administrators', () => {
  const admin = freshAdminSession();
  const password = generatedPassword();
  const created = createAdminAccount({ name: 'Added Administrator', username: 'added.admin', password, active: true }, admin);
  assert.equal(created.ok, true, Object.values(created.errors || {}).join(' '));
  assert.equal(created.account.role, 'admin');
  assert.equal(created.account.permanent, false);
  assert.equal(Object.prototype.hasOwnProperty.call(created.account, 'passwordHash'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(created.account, 'password'), false);

  const signedIn = login({ role: 'admin', loginId: 'added.admin', password });
  assert.equal(signedIn.ok, true);
  assert.equal(signedIn.account.role, 'admin');
  const nested = createAdminAccount({ name: 'Nested Administrator', username: 'nested.admin', password: generatedPassword(), active: true }, signedIn.account);
  assert.equal(nested.ok, true, Object.values(nested.errors || {}).join(' '));
  assert.equal(nested.account.role, 'admin');
  logout();
});

test('added administrators can be edited and deleted, while permanent admins stay protected', () => {
  const admin = freshAdminSession();
  const originalPassword = generatedPassword();
  const created = createAdminAccount({ name: 'Editable Administrator', username: 'editable.admin', password: originalPassword, active: true }, admin);
  assert.equal(created.ok, true, Object.values(created.errors || {}).join(' '));
  const id = created.account.id;
  const newPassword = generatedPassword();
  const updated = updateAdminAccount(id, { name: 'Renamed Administrator', username: 'renamed.admin', password: newPassword, active: true }, admin);
  assert.equal(updated.ok, true, Object.values(updated.errors || {}).join(' '));
  assert.equal(updated.account.name, 'Renamed Administrator');
  assert.equal(updated.account.loginId, 'renamed.admin');
  assert.equal(updateAdminAccount(id, { name: 'Duplicate', username: 'ARHATSHAH8149', password: generatedPassword(), active: true }, admin).ok, false);

  logout();
  const changedLogin = login({ role: 'admin', loginId: 'renamed.admin', password: newPassword });
  assert.equal(changedLogin.ok, true);
  logout();
  const adminAgain = becomeFirstAdmin();
  const permanent = getDb().accounts.find((account) => account.loginId === 'SHASHI1234');
  assert.equal(updateAdminAccount(permanent.id, { name: 'Changed', username: 'changed.admin', password: generatedPassword(), active: true }, adminAgain).ok, false);
  assert.equal(deleteAdminAccount(permanent.id, adminAgain).ok, false);
  const deleted = deleteAdminAccount(id, adminAgain);
  assert.equal(deleted.ok, true, Object.values(deleted.errors || {}).join(' '));
  assert.equal(getDb().accounts.filter((account) => account.role === 'admin').length, 3);
  assert.doesNotThrow(() => validateDatabase(getDb()));
});

test('login verifies salted hashes without a serial and returns a credential-free account', () => {
  const admin = freshAdminSession();
  const payload = studentPayload({ name: 'Amina Rahman', className: 'Grade 9B', serial: 'STU-9201' });
  const created = createAccount(payload, admin);
  assert.equal(created.ok, true, Object.values(created.errors || {}).join(' '));
  assert.equal(created.account.className, 'Grade 9B');
  assert.equal(created.account.serial, 'STU-9201');
  assert.equal(Object.prototype.hasOwnProperty.call(created.account, 'passwordHash'), false);

  const wrong = login({ role: 'student', loginId: payload.loginId, password: 'incorrect-password' });
  assert.equal(wrong.ok, false);
  assert.match(wrong.errors.password, /incorrect/i);

  const signedIn = login({ role: 'student', loginId: payload.loginId, password: payload.password });
  assert.equal(signedIn.ok, true, Object.values(signedIn.errors || {}).join(' '));
  assert.equal(signedIn.account.name, 'Amina Rahman');
  assert.equal(signedIn.account.className, 'Grade 9B');
  assert.equal(signedIn.account.serial, 'STU-9201');
  assert.equal(Object.prototype.hasOwnProperty.call(signedIn.account, 'password'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(signedIn.account, 'salt'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(signedIn.account, 'passwordHash'), false);
  assert.equal(getSessionAccount().role, 'student');
  logout();
});

test('iterated salted password verification depends on the stored iteration count', () => {
  const admin = freshAdminSession();
  const payload = studentPayload({ loginId: 'iterated-student', serial: 'STU-9601' });
  const created = createAccount(payload, admin);
  assert.equal(created.ok, true);
  const stored = findAccountById(getDb(), created.account.id);
  assert.equal(stored.hashIterations, PASSWORD_HASH_ITERATIONS);
  assert.equal(verifyPassword(payload.password, stored), true);
  assert.equal(verifyPassword('not-the-issued-password', stored), false);
  assert.notEqual(stored.passwordHash, hashPassword(payload.password, stored.salt, PASSWORD_HASH_ITERATIONS + 1));
  stored.hashIterations += 1;
  assert.equal(verifyPassword(payload.password, stored), false);
});

test('workflow mutations require a matching signed-in actor, not a forged role object', () => {
  resetToFactoryDatabase();
  const forged = { id: 'forged-teacher', role: 'teacher', name: 'Forged Teacher' };
  const options = { minutes: '', priority: 'normal' };
  assert.throws(() => approveRequest(getDb(), 'missing', options, forged), /Sign in is required/i);
  const admin = freshAdminSession();
  assert.throws(() => approveRequest(getDb(), 'missing', options, { ...forged, id: 'different-id' }), /does not match/i);
  assert.equal(admin.role, 'admin');
});

test('duplicate usernames and student serial numbers are rejected', () => {
  const admin = freshAdminSession();
  const first = studentPayload({ loginId: 'unique-student', serial: 'STU-9301' });
  assert.equal(createAccount(first, admin).ok, true);

  const duplicateUsername = createAccount(studentPayload({
    loginId: 'UNIQUE-STUDENT',
    serial: 'STU-9302',
    password: generatedPassword()
  }), admin);
  assert.equal(duplicateUsername.ok, false);
  assert.match(duplicateUsername.errors.loginId, /already used/i);

  const duplicateSerial = createAccount(studentPayload({
    loginId: 'another-student',
    serial: 'STU-9301',
    password: generatedPassword()
  }), admin);
  assert.equal(duplicateSerial.ok, false);
  assert.match(duplicateSerial.errors.serial, /already assigned/i);

  assert.equal(getDb().accounts.filter((account) => account.role === 'student').length, 1);
});

test('account management requires an authenticated administrator', () => {
  const admin = freshAdminSession();
  const payload = studentPayload({ loginId: 'student-guard', serial: 'STU-9401' });
  const created = createAccount(payload, admin);
  assert.equal(created.ok, true);
  const signedIn = login({ role: 'student', loginId: payload.loginId, password: payload.password });
  assert.equal(signedIn.ok, true);
  const student = signedIn.account;

  assert.throws(() => createAccount(studentPayload({ loginId: 'blocked', serial: 'STU-9402' }), student), /Administrator sign-in/i);
  assert.throws(() => updateAccount(student.id, { ...studentPayload(), password: '' }, student), /Administrator sign-in/i);
  assert.throws(() => deleteAccount(student.id, student), /Administrator sign-in/i);
  assert.equal(getDb().accounts.some((account) => account.loginId === 'blocked'), false);
});

test('permanent administrator accounts cannot be changed or deleted', () => {
  const admin = freshAdminSession();
  const db = getDb();
  const permanent = db.accounts.find((account) => account.permanent);
  assert.ok(permanent);

  const deleted = deleteAccount(permanent.id, admin);
  assert.equal(deleted.ok, false);
  assert.match(deleted.errors.general, /cannot be deleted/i);

  const updated = updateAccount(permanent.id, {
    role: 'admin',
    name: 'Changed Administrator',
    className: '',
    loginId: 'CHANGED ADMIN',
    password: generatedPassword(),
    serial: '',
    active: true,
    autoApprove: false
  }, admin);
  assert.equal(updated.ok, false);
  assert.match(updated.errors.general, /fixed/i);
  assert.equal(getDb().accounts.length, 3);
  assert.ok(findAccountByLogin(getDb(), permanent.loginId, 'admin'));
});

test('student and teacher CRUD persists registered details and username/password changes', () => {
  const admin = freshAdminSession();
  const student = studentPayload({ loginId: 'crud-student', serial: 'STU-9501', name: 'Original Student', className: 'Grade 7A' });
  const createdStudent = createAccount(student, admin);
  assert.equal(createdStudent.ok, true);

  const newStudentPassword = generatedPassword();
  const studentUpdate = updateAccount(createdStudent.account.id, studentPayload({
    name: 'Updated Student',
    className: 'Grade 10C',
    loginId: 'updated-student',
    password: newStudentPassword,
    serial: 'STU-9502'
  }), admin);
  assert.equal(studentUpdate.ok, true, Object.values(studentUpdate.errors || {}).join(' '));
  let db = getDb();
  let storedStudent = findAccountById(db, createdStudent.account.id);
  assert.equal(storedStudent.name, 'Updated Student');
  assert.equal(storedStudent.className, 'Grade 10C');
  assert.equal(storedStudent.serial, 'STU-9502');
  assert.equal(Object.prototype.hasOwnProperty.call(storedStudent, 'password'), false);

  const studentLogin = login({ role: 'student', loginId: 'updated-student', password: newStudentPassword });
  assert.equal(studentLogin.ok, true);
  assert.equal(studentLogin.account.className, 'Grade 10C');
  assert.equal(studentLogin.account.serial, 'STU-9502');
  logout();

  const teacherAdmin = becomeFirstAdmin();
  const teacher = teacherPayload({ loginId: 'crud-teacher', name: 'Original Teacher' });
  const createdTeacher = createAccount(teacher, teacherAdmin);
  assert.equal(createdTeacher.ok, true);
  assert.equal(createdTeacher.account.serial, null);
  assert.equal(createdTeacher.account.className, '');

  const newTeacherPassword = generatedPassword();
  const teacherUpdate = updateAccount(createdTeacher.account.id, teacherPayload({
    name: 'Updated Teacher',
    loginId: 'updated-teacher',
    password: newTeacherPassword
  }), teacherAdmin);
  assert.equal(teacherUpdate.ok, true, Object.values(teacherUpdate.errors || {}).join(' '));

  const teacherLogin = login({ role: 'teacher', loginId: 'updated-teacher', password: newTeacherPassword });
  assert.equal(teacherLogin.ok, true);
  assert.equal(teacherLogin.account.name, 'Updated Teacher');
  assert.equal(teacherLogin.account.serial, null);
  assert.equal(Object.prototype.hasOwnProperty.call(teacherLogin.account, 'passwordHash'), false);
  logout();

  const adminAgain = becomeFirstAdmin();
  const removedStudent = deleteAccount(createdStudent.account.id, adminAgain);
  assert.equal(removedStudent.ok, true, Object.values(removedStudent.errors || {}).join(' '));
  const removedTeacher = deleteAccount(createdTeacher.account.id, adminAgain);
  assert.equal(removedTeacher.ok, true, Object.values(removedTeacher.errors || {}).join(' '));
  db = getDb();
  assert.equal(db.accounts.length, 3);
  assert.equal(db.accounts.filter((account) => account.role === 'student' || account.role === 'teacher').length, 0);
  assert.equal(db.serials.find((serial) => serial.code === 'STU-9502').status, 'free');
  assert.doesNotThrow(() => validateDatabase(db));
});

if (failures) {
  console.error(`\n${failures} account/authentication test(s) FAILED.`);
  process.exitCode = 1;
} else {
  console.log(`\nAll ${names.length} account/authentication tests PASSED.`);
}
