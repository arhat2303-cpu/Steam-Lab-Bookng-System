import assert from 'node:assert/strict';
import { PASSWORD_HASH_ITERATIONS } from '../src/core.js';
import { zipSync, unzipSync, strToU8, strFromU8 } from '../src/fflate.js';
import {
  createFactoryDatabase, normaliseDatabase, publicAccount, validateDatabase
} from '../src/db.js';
import {
  buildSerialsTemplate, parseSerialsWorkbook
} from '../src/xlsx.js';
import {
  prepareSerialRows, applySerialRows, updateSerialRecord, deleteSerialRecord
} from '../src/serials.js';

let failures = 0;
let total = 0;

function test(name, fn) {
  total += 1;
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL ${name}: ${error && error.message ? error.message : String(error)}`);
  }
}

function xmlEscape(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function inlineRow(rowNumber, values) {
  const cells = values.map((value, index) => {
    const reference = `${String.fromCharCode(65 + index)}${rowNumber}`;
    return `<c r="${reference}" t="inlineStr"><is><t>${xmlEscape(value)}</t></is></c>`;
  }).join('');
  return `<row r="${rowNumber}">${cells}</row>`;
}

function withRows(bytes, sheetPath, rowsXml) {
  const entries = unzipSync(bytes);
  const xml = strFromU8(entries[sheetPath]);
  entries[sheetPath] = strToU8(xml.replace('</sheetData>', `${rowsXml}</sheetData>`));
  return zipSync(entries, { level: 0 });
}

function studentRow(overrides = {}) {
  return {
    role: 'student',
    name: 'Serial Student',
    className: 'Grade 8A',
    serial: 'STU-8001',
    username: 'serial.student',
    password: 'Serial@2026',
    source: 'Bulk row 1',
    rowNumber: 1,
    ...overrides
  };
}

function teacherRow(overrides = {}) {
  return {
    role: 'teacher',
    name: 'Serial Teacher',
    className: '',
    serial: 'T-8001',
    username: 'serial.teacher',
    password: 'Serial@2026',
    source: 'Bulk row 2',
    rowNumber: 2,
    ...overrides
  };
}

test('Excel template is a real two-sheet workbook with the required headers', () => {
  const bytes = buildSerialsTemplate();
  assert.equal(bytes[0], 0x50);
  assert.equal(bytes[1], 0x4b);
  const entries = unzipSync(bytes);
  assert.ok(entries['xl/workbook.xml']);
  assert.ok(entries['xl/worksheets/sheet1.xml']);
  assert.ok(entries['xl/worksheets/sheet2.xml']);
  assert.ok(entries['xl/styles.xml']);
  const parsed = parseSerialsWorkbook(bytes);
  assert.deepEqual(parsed.sheets.map((sheet) => sheet.name), ['Student Serials', 'Teacher Serials']);
  assert.deepEqual(parsed.sheets.map((sheet) => sheet.role), ['student', 'teacher']);
  assert.equal(parsed.rows.length, 0);
  assert.equal(parsed.sheets.every((sheet) => sheet.dataRows === 0), true);
  const sheet1 = strFromU8(entries['xl/worksheets/sheet1.xml']);
  for (const header of ['Full Name', 'Class', 'Serial Number', 'Username', 'Password']) assert.ok(sheet1.includes(header), header);
  const sheet2 = strFromU8(entries['xl/worksheets/sheet2.xml']);
  for (const header of ['Full Name', 'Serial Number (if applicable)', 'Username', 'Password']) assert.ok(sheet2.includes(header), header);
});

test('Excel rows are parsed with separate username and full-name fields', () => {
  let bytes = buildSerialsTemplate();
  bytes = withRows(bytes, 'xl/worksheets/sheet1.xml', inlineRow(2, ['Amina Rahman', 'Grade 9B', 'STU-8101', 'amina.rahman', 'Excel@2026']));
  bytes = withRows(bytes, 'xl/worksheets/sheet2.xml', inlineRow(2, ['Mr. Alex Morgan', 'T-8101', 'alex.morgan', 'Excel@2026']));
  const parsed = parseSerialsWorkbook(bytes);
  assert.equal(parsed.rows.length, 2);
  assert.equal(parsed.rows[0].role, 'student');
  assert.equal(parsed.rows[0].name, 'Amina Rahman');
  assert.equal(parsed.rows[0].className, 'Grade 9B');
  assert.equal(parsed.rows[0].serial, 'STU-8101');
  assert.equal(parsed.rows[0].username, 'amina.rahman');
  assert.notEqual(parsed.rows[0].username, parsed.rows[0].name);
  assert.equal(parsed.rows[1].role, 'teacher');
  assert.equal(parsed.rows[1].serial, 'T-8101');
  assert.equal(parsed.rows[1].className, '');
  assert.equal(parsed.rows[1].source, 'Teacher Serials!2');
});

test('duplicate usernames/serials and incomplete rows are detected before import', () => {
  const db = createFactoryDatabase();
  const rows = [
    studentRow(),
    studentRow({ name: 'Duplicate Student', serial: 'STU-8001', username: 'SERIAL.STUDENT', source: 'Bulk row 2', rowNumber: 2 }),
    teacherRow({ username: '', password: '', source: 'Bulk row 3', rowNumber: 3 }),
    teacherRow({ name: 'Second Teacher', serial: 'T-8002', username: 'second.teacher', source: 'Bulk row 4', rowNumber: 4 })
  ];
  const preview = prepareSerialRows(db, rows);
  assert.equal(preview.total, 4);
  assert.equal(preview.validCount, 2);
  assert.equal(preview.invalidCount, 2);
  assert.match(preview.rows[1].errorText, /Duplicate username|already used/i);
  assert.match(preview.rows[1].errorText, /Duplicate serial/i);
  assert.match(preview.rows[2].errorText, /Enter a username/i);
  assert.match(preview.rows[2].errorText, /password/i);
  assert.equal(preview.rows[0].username, 'serial.student');
  assert.notEqual(preview.rows[0].username, preview.rows[0].name);
});

test('bulk import creates synchronised accounts and serial records without exposing passwords', () => {
  const now = Date.now();
  const db = createFactoryDatabase(now);
  const actor = publicAccount(db.accounts[0]);
  const result = applySerialRows(db, [studentRow(), teacherRow()], actor, now);
  assert.equal(result.successful, 2);
  assert.equal(result.unsuccessful, 0);
  assert.equal(result.created.length, 2);
  assert.equal(db.accounts.length, 5);
  assert.equal(db.serials.length, 2);
  for (const account of db.accounts) {
    assert.equal(Object.prototype.hasOwnProperty.call(account, 'password'), false);
    assert.equal(account.hashIterations, PASSWORD_HASH_ITERATIONS);
    assert.match(account.passwordHash, /^[a-f0-9]{64}$/i);
  }
  const student = db.accounts.find((account) => account.loginId === 'serial.student');
  const studentSerial = db.serials.find((serial) => serial.code === 'STU-8001');
  assert.equal(student.className, 'Grade 8A');
  assert.equal(student.serial, 'STU-8001');
  assert.equal(studentSerial.status, 'assigned');
  assert.equal(studentSerial.assignedTo, student.id);
  assert.equal(studentSerial.role, 'student');
  const teacher = db.accounts.find((account) => account.loginId === 'serial.teacher');
  const teacherSerial = db.serials.find((serial) => serial.code === 'T-8001');
  assert.equal(teacher.serial, 'T-8001');
  assert.equal(teacherSerial.assignedTo, teacher.id);
  assert.equal(JSON.stringify(result).includes('Serial@2026'), false);
  assert.doesNotThrow(() => validateDatabase(db));
});

test('editing updates both sides and deleting removes the linked account and serial record', () => {
  const now = Date.now();
  const db = createFactoryDatabase(now);
  const actor = publicAccount(db.accounts[0]);
  applySerialRows(db, [studentRow()], actor, now);
  const account = db.accounts.find((entry) => entry.loginId === 'serial.student');
  const oldHash = account.passwordHash;
  const updated = updateSerialRecord(db, account.id, studentRow({
    name: 'Updated Student',
    className: 'Grade 10C',
    serial: 'STU-8002',
    username: 'updated.student',
    password: ''
  }), 'student', actor, now + 1);
  assert.equal(updated.ok, true);
  assert.equal(updated.account.name, 'Updated Student');
  assert.equal(updated.account.className, 'Grade 10C');
  assert.equal(updated.account.loginId, 'updated.student');
  assert.equal(updated.account.serial, 'STU-8002');
  assert.equal(account.passwordHash, oldHash, 'blank password must preserve the existing hash');
  assert.equal(db.serials.some((serial) => serial.code === 'STU-8001'), false);
  const newRecord = db.serials.find((serial) => serial.code === 'STU-8002');
  assert.equal(newRecord.assignedTo, account.id);
  const deleted = deleteSerialRecord(db, account.id, actor, now + 2);
  assert.equal(deleted.ok, true);
  assert.equal(db.accounts.some((entry) => entry.id === account.id), false);
  assert.equal(db.serials.some((serial) => serial.code === 'STU-8002'), false);
  assert.doesNotThrow(() => validateDatabase(db));
});

test('persisted permanent administrator display names are normalised to the requested names', () => {
  const db = createFactoryDatabase();
  db.accounts[0].name = 'Administrator 1';
  db.accounts[1].name = 'Administrator 2';
  db.accounts[2].name = 'Administrator 3';
  const normalised = normaliseDatabase(db);
  assert.equal(normalised.accounts[0].name, 'ARHAT SHAH');
  assert.equal(normalised.accounts[1].name, 'RUTHVIKA VANKADHARA');
  assert.equal(normalised.accounts[2].name, 'Shashmith Chatterjee');
  assert.equal(normalised.accounts[0].role, 'admin');
  assert.equal(normalised.accounts[1].permanent, true);
  assert.equal(normalised.accounts[2].permanent, true);
  assert.doesNotThrow(() => validateDatabase(normalised));
});

if (failures) {
  console.error(`\n${failures} serial/XLSX test(s) FAILED.`);
  process.exitCode = 1;
} else {
  console.log(`\nAll ${total} serial/XLSX tests PASSED.`);
}
