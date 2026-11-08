import {
  DB_KEY, getStorageNotice, stateRemove, clearFiles, downloadBlob, downloadText,
  escapeHtml, formatDateTime, formatDate, formatTime, formatDuration,
  formatLongWeekday, makeId, readFileBytes
} from './core.js';
import {
  getDb, commitDb, DEFAULT_SETTINGS,
  findAccountById, findRequestById, findSerial
} from './db.js';
import {
  bootstrap, ensureSeedFiles, getSessionAccount, login, logout,
  submitRequest, previewEstimate, getRequestFile, reestimateFromFile, approveRequest,
  rejectRequest, confirmSlot, startPrint, markPrinted, handOver, cancelRequest,
  rerunScheduler, assignSerial, updateSettings, resetSettings, computeReports, buildScheduleBoard,
  exportRequestsCsv, exportSerialsCsv, exportReportCsv, exportBackup, parseBackupText,
  importBackup, resetFactoryData,
  createSerialEntry, updateSerialEntry, deleteSerialEntry, bulkCreateSerialRows,
  serialsTemplate, previewSerialsWorkbook, importSerialRows, changeOwnPassword,
  STATUS_LABELS, PRIORITY_LABELS, MATERIALS,
  scheduleText, statusText, effectiveMinutes, getUploadExtensionsText, fileSizeLabel,
  decodeBackupBytes
} from './api.js';
import { MODEL_EXTENSIONS, IMAGE_EXTENSIONS } from './estimate.js';
import { runSelfTest } from './selftest.js';

const esc = escapeHtml;
const DAY_NAMES = [
  { value: 1, label: 'Monday' }, { value: 2, label: 'Tuesday' }, { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' }, { value: 5, label: 'Friday' }, { value: 6, label: 'Saturday' },
  { value: 0, label: 'Sunday' }
];

const ICON_PATHS = {
  logo: '<path d="M4 7.5 12 3l8 4.5v9L12 21l-8-4.5v-9Z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9"/><path d="M8 5.5v4M16 5.5v4"/>',
  student: '<path d="M3 9.5 12 5l9 4.5-9 4.5-9-4.5Z"/><path d="M7 11.5V16c0 1.3 2.2 2.5 5 2.5s5-1.2 5-2.5v-4.5M21 9.5v5"/>',
  teacher: '<rect x="4" y="4" width="16" height="17" rx="2"/><path d="M9 4V3h6v1M8 10h8M8 14h8M8 18h5"/>',
  admin: '<path d="M12 3 4.5 6v5.5c0 4.6 3.1 8.2 7.5 9.5 4.4-1.3 7.5-4.9 7.5-9.5V6L12 3Z"/><path d="m9 12 2 2 4-4"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  back: '<path d="M19 12H5M11 18l-6-6 6-6"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>',
  file: '<path d="M6 3h8l4 4v14H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"/><path d="M14 3v5h4M8 13h8M8 17h5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 10h18"/>',
  check: '<path d="m5 12 4 4 10-10"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  play: '<path d="m8 5 11 7-11 7V5Z"/>',
  printer: '<path d="M6 9V4h12v5M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M6 15h12v6H6zM18 12h.01"/>',
  box: '<path d="m4 8 8-4 8 4v8l-8 4-8-4V8Z"/><path d="m4 8 8 4 8-4M12 12v8"/>',
  hand: '<path d="M8 13V6a1.5 1.5 0 0 1 3 0v5M11 11V4.5a1.5 1.5 0 0 1 3 0V11M14 10V6a1.5 1.5 0 0 1 3 0v7M17 10.5a1.5 1.5 0 0 1 3 0V15c0 3.3-2.7 6-6 6h-2c-2.4 0-4.5-1.4-5.4-3.6L4 12.5a1.5 1.5 0 0 1 2.6-1.5L8 13"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5"/><path d="M5 20h14"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5M14 11v5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  users: '<path d="M16 20v-1.5a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4V20"/><circle cx="9.5" cy="7.5" r="3.5"/><path d="M22 20v-1.5a4 4 0 0 0-3-3.9M16.5 4.2a3.5 3.5 0 0 1 0 6.6"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6V21h-4v-.1a1.7 1.7 0 0 0-1.1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.1 16.9l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.6-1H3v-4h.1a1.7 1.7 0 0 0 1.6-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1L7.1 4l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 2.8V3h4v-.1a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1 2.8 2.8-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.1v4h-.1a1.7 1.7 0 0 0-1.6 1Z"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  database: '<ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 6.3M20 5v6h-6"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
  alert: '<path d="M12 3 2.5 20h19L12 3Z"/><path d="M12 9v5M12 17h.01"/>',
  memory: '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M7 10v4M12 10v4M17 10v4M7 18v2M17 18v2"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  logout: '<path d="M10 5H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h5M14 8l4 4-4 4M8 12h10"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9 2 2-2 2 1.5 1.5L20 10l-2 2-1.5-1.5L11 16"/>',
  save: '<path d="M5 4h11l3 3v13H5V4Z"/><path d="M8 4v6h8V4M8 20v-6h8v6"/>',
  edit: '<path d="M4 20h4L20 8l-4-4L4 16v4Z"/><path d="m14 6 4 4"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  home: '<path d="m3 11 9-8 9 8"/><path d="M5 10v10h14V10M9 20v-6h6v6"/>'
};

function icon(name, size = 20) {
  const paths = ICON_PATHS[name] || ICON_PATHS.info;
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
}

function blankLogin() {
  return { loginId: '', password: '' };
}

function makeDraft() {
  return {
    file: null,
    fileName: '',
    bytes: null,
    estimate: null,
    form: { title: '', notes: '', material: 'PLA', colour: 'Blue', infill: '20', copies: '1', studentId: '' }
  };
}

function makeSerialForm(role = 'student') {
  return { name: '', className: '', serial: '', username: '', password: '', active: true, autoApprove: false, role };
}

function makeBulkSerialRow(role = 'student', index = 1) {
  return { id: makeId('bulk'), ...makeSerialForm(role), source: `Bulk row ${index}`, rowNumber: index };
}

function makeBulkSerialRows(role = 'student', count = 2) {
  return Array.from({ length: count }, (_, index) => makeBulkSerialRow(role, index + 1));
}

function blankPasswordForm() {
  return { currentPassword: '', newPassword: '', confirmPassword: '' };
}

function makeSettingsForm(settings) {
  const source = settings || DEFAULT_SETTINGS;
  return {
    openTime: source.openTime,
    closeTime: source.closeTime,
    workingDays: (source.workingDays || []).map(Number),
    slotMinutes: String(source.slotMinutes),
    restGapMinutes: String(source.restGapMinutes),
    dailyCapMinutes: String(source.dailyCapMinutes),
    minLeadMinutes: String(source.minLeadMinutes),
    maxActivePerStudent: String(source.maxActivePerStudent),
    maxUploadMB: String(source.maxUploadMB),
    buildVolume: {
      x: String(source.buildVolume.x),
      y: String(source.buildVolume.y),
      z: String(source.buildVolume.z)
    }
  };
}

const state = {
  session: null,
  view: 'landing',
  loginRole: null,
  loginForm: blankLogin(),
  errors: {},
  success: {},
  filters: { search: '', status: 'all', priority: 'all' },
  draft: makeDraft(),
  lastSubmission: null,
  confirm: null,
  settingsForm: makeSettingsForm(DEFAULT_SETTINGS),
  backupFile: null,
  backupFileName: '',
  toasts: [],
  serialMode: 'student',
  serialFormOpen: false,
  serialEditId: null,
  serialForm: makeSerialForm('student'),
  bulkSerialRows: makeBulkSerialRows('student', 2),
  bulkReport: null,
  excelFile: null,
  excelFileName: '',
  excelPreview: null,
  excelReport: null,
  passwordChangeOpen: false,
  passwordForm: blankPasswordForm()
};

function resetSerialWorkspace(role = 'student') {
  state.serialMode = role === 'teacher' ? 'teacher' : 'student';
  state.serialFormOpen = false;
  state.serialEditId = null;
  state.serialForm = makeSerialForm(state.serialMode);
  state.bulkSerialRows = makeBulkSerialRows(state.serialMode, 2);
  state.bulkReport = null;
  state.excelFile = null;
  state.excelFileName = '';
  state.excelPreview = null;
  state.excelReport = null;
}

let fatalError = null;
let bootstrapped = false;

const VIEW_META = {
  landing: { title: 'STEAM Lab Booking System', subtitle: 'One printer, one queue, one clear schedule.' },
  login: { title: 'Sign in', subtitle: 'Choose your role and sign in with your issued username and password.' },
  'student-requests': { title: 'My requests', subtitle: 'Only your print requests are shown here.' },
  'student-new': { title: 'New print request', subtitle: 'Upload a model and get a computed print-time estimate.' },
  'student-schedule': { title: 'Two-week schedule', subtitle: 'Other students’ booked time appears only as anonymous occupied blocks.' },
  'teacher-review': { title: 'Review queue', subtitle: 'Check estimates, approve or reject, and confirm slots.' },
  'teacher-schedule': { title: 'Schedule board', subtitle: 'Booked blocks and reserved cool-down gaps for the single printer.' },
  'teacher-requests': { title: 'All requests', subtitle: 'Search, filter, and run the print workflow.' },
  'admin-reports': { title: 'Reports & overview', subtitle: 'Live counts, printing hours, busiest students, and activity.' },
  'admin-review': { title: 'Review queue', subtitle: 'Admin access to teacher review and approval tools.' },
  'admin-schedule': { title: 'Schedule board', subtitle: 'Full visibility of booked blocks and cool-down gaps.' },
  'admin-requests': { title: 'All requests', subtitle: 'Search, filter, and run the print workflow.' },
  'admin-new-request': { title: 'Submit on behalf of a student', subtitle: 'Create a real student request using the same upload and estimator.' },
  'admin-serials': { title: 'Serial numbers', subtitle: 'Create, bulk-add, import, edit, delete, and export linked serial records and accounts.' },
  'admin-settings': { title: 'Lab settings', subtitle: 'Lab hours, capacity, lead time, upload limits, and build volume.' },
  'admin-data': { title: 'Data & backup', subtitle: 'Export JSON and CSV, import a validated backup, or restore the two permanent administrator accounts.' }
};

const NAV = {
  student: [
    { view: 'student-requests', label: 'My requests', icon: 'list' },
    { view: 'student-new', label: 'New request', icon: 'upload' },
    { view: 'student-schedule', label: 'Schedule', icon: 'calendar' }
  ],
  teacher: [
    { view: 'teacher-review', label: 'Review queue', icon: 'check' },
    { view: 'teacher-schedule', label: 'Schedule board', icon: 'calendar' },
    { view: 'teacher-requests', label: 'All requests', icon: 'list' }
  ],
  admin: [
    { view: 'admin-reports', label: 'Reports', icon: 'chart' },
    { view: 'admin-review', label: 'Review queue', icon: 'check' },
    { view: 'admin-schedule', label: 'Schedule board', icon: 'calendar' },
    { view: 'admin-requests', label: 'All requests', icon: 'list' },
    { view: 'admin-new-request', label: 'New request', icon: 'upload' },
    { view: 'admin-serials', label: 'Serials', icon: 'key' },
    { view: 'admin-settings', label: 'Lab settings', icon: 'settings' },
    { view: 'admin-data', label: 'Data & backup', icon: 'database' }
  ]
};

function defaultView(role) {
  if (role === 'student') return 'student-requests';
  if (role === 'teacher') return 'teacher-review';
  return 'admin-reports';
}

function viewAllowed(role, view) {
  return (NAV[role] || []).some((item) => item.view === view);
}

function renderAccessDenied() {
  return `
    <section class="card" data-testid="access-denied">
      <div class="card-header"><div><h2>Access restricted</h2><p>Your signed-in role determines which workspaces are available.</p></div></div>
      ${emptyState('Administrator access required', 'This workspace is not available for your account. Use the sidebar to return to an allowed view.', 'key')}
    </section>`;
}

function viewMeta(view) {
  return VIEW_META[view] || VIEW_META.landing;
}

function isSelfTestRoute() {
  return String(location.hash || '').replace(/^#\/?/, '').toLowerCase() === 'selftest';
}

function storageNoticeHtml() {
  const notice = getStorageNotice();
  if (!notice) return '';
  return `<div class="storage-notice" data-testid="storage-notice" role="status">${icon('memory', 18)}<span>${esc(notice)}</span></div>`;
}

function fieldError(key) {
  return `<div class="inline-error" aria-live="polite">${esc(state.errors[key] || '')}</div>`;
}

function selected(value, expected) {
  return String(value) === String(expected) ? ' selected' : '';
}

function checked(value) {
  return value ? ' checked' : '';
}

function statusClass(request) {
  if (request.status === 'approved' && request.slotConfirmedAt) return 'confirmed';
  return request.status;
}

function statusBadge(request) {
  return `<span class="badge ${statusClass(request)}">${esc(statusText(request))}</span>`;
}

function priorityBadge(priority) {
  const value = PRIORITY_LABELS[priority] ? priority : 'normal';
  return `<span class="badge ${value}">${esc(PRIORITY_LABELS[value])}</span>`;
}

function toast(message, type = 'info', detail = '') {
  const item = { id: makeId('toast'), message, type, detail };
  state.toasts.push(item);
  state.toasts = state.toasts.slice(-4);
  renderToasts();
  setTimeout(() => {
    state.toasts = state.toasts.filter((entry) => entry.id !== item.id);
    renderToasts();
  }, 4200);
}

function renderToasts() {
  const region = document.getElementById('toast-region');
  if (!region) return;
  region.innerHTML = state.toasts.map((item) => `
    <div class="toast ${esc(item.type)}" role="status">
      ${icon(item.type === 'success' ? 'check' : item.type === 'error' ? 'alert' : 'info', 18)}
      <div><strong>${esc(item.message)}</strong>${item.detail ? `<small>${esc(item.detail)}</small>` : ''}</div>
    </div>
  `).join('');
}

function render() {
  const app = document.getElementById('app');
  if (!app) return;
  const active = document.activeElement;
  const focusId = active && active.id ? active.id : '';
  let selectionStart = null;
  let selectionEnd = null;
  try {
    if (active && typeof active.setSelectionRange === 'function' && active.type !== 'file') {
      selectionStart = active.selectionStart;
      selectionEnd = active.selectionEnd;
    }
  } catch (_) { /* Some input types do not expose selection. */ }

  let html;
  if (fatalError) html = renderFatalMarkup();
  else if (isSelfTestRoute()) html = renderSelfTestPage();
  else if (!state.session) html = state.view === 'login' ? renderLogin() : renderLanding();
  else html = renderAppShell();
  app.innerHTML = html;

  if (focusId) {
    const replacement = document.getElementById(focusId);
    if (replacement) {
      try { replacement.focus({ preventScroll: true }); } catch (_) { replacement.focus(); }
      try {
        if (selectionStart !== null && typeof replacement.setSelectionRange === 'function' && replacement.type !== 'file') {
          replacement.setSelectionRange(selectionStart, selectionEnd);
        }
      } catch (_) { /* Non-text controls cannot restore a selection. */ }
    }
  }
  renderToasts();
}

function renderFatalMarkup() {
  const message = fatalError && fatalError.message ? fatalError.message : String(fatalError || 'Unknown boot error');
  const stack = fatalError && fatalError.stack ? fatalError.stack : 'No stack trace was provided.';
  return `
    <main class="fatal-shell">
      <section class="fatal-panel">
        <div class="eyebrow">Boot safety panel</div>
        <h1>The app could not start normally</h1>
        <p>Your data was not silently cleared. Use Reset app data below to start from the two permanent administrator accounts.</p>
        <div class="message-box error"><strong>${esc(message)}</strong></div>
        <pre>${esc(stack)}</pre>
        <div class="btn-row">
          <button class="btn danger" type="button" data-action="reset-fatal">${icon('refresh', 18)} Reset app data</button>
        </div>
        <div class="inline-error fatal-reset-result" aria-live="polite"></div>
      </section>
    </main>`;
}

function renderFatal(error) {
  if (fatalError) return;
  fatalError = error instanceof Error ? error : new Error(String(error));
  render();
}

function renderLanding() {
  return `
    <main class="landing">
      <div class="landing-inner">
        ${storageNoticeHtml()}
        <section class="landing-card">
          <div class="brand-line">
            <span class="brand-mark">${icon('logo', 26)}</span>
            <span class="brand-text">School STEAM Lab</span>
          </div>
          <div class="eyebrow">One printer · one queue · one clear schedule</div>
          <h1>STEAM Lab Booking System</h1>
          <p class="landing-subtitle">Request a 3D print, have a teacher approve and schedule it, then follow the job from the queue to hand-over.</p>
          <div class="role-grid">
            <button class="role-button" type="button" data-action="choose-role" data-role="student" data-testid="role-student">
              <span class="role-icon">${icon('student', 28)}</span>
              <span><strong>Student</strong><span>Upload a model, track your own requests, and see occupied time anonymously.</span></span>
              <span class="role-arrow">Student sign-in ${icon('arrow', 16)}</span>
            </button>
            <button class="role-button" type="button" data-action="choose-role" data-role="teacher" data-testid="role-teacher">
              <span class="role-icon">${icon('teacher', 28)}</span>
              <span><strong>Teacher</strong><span>Review estimates, approve with adjustments, confirm slots, and run the print workflow.</span></span>
              <span class="role-arrow">Teacher sign-in ${icon('arrow', 16)}</span>
            </button>
            <button class="role-button" type="button" data-action="choose-role" data-role="admin" data-testid="role-admin">
              <span class="role-icon">${icon('admin', 28)}</span>
              <span><strong>Admin</strong><span>Manage accounts, serials, lab settings, reports, backups, and all workflows.</span></span>
              <span class="role-arrow">Admin sign-in ${icon('arrow', 16)}</span>
            </button>
          </div>
        </section>
      </div>
    </main>`;
}

function renderLogin() {
  const role = state.loginRole || 'student';
  const title = role === 'student' ? 'Student sign in' : role === 'teacher' ? 'Teacher sign in' : 'Admin sign in';
  const loginLabel = role === 'admin' ? 'Admin username' : 'Username';
  return `
    <main class="auth-shell">
      <section class="auth-visual">
        <div>
          <div class="brand-line" style="justify-content:flex-start">
            <span class="brand-mark">${icon('logo', 26)}</span>
            <span class="brand-text">STEAM Lab Booking System</span>
          </div>
          <h1>${esc(title)}</h1>
          <p>One school 3D printer, one honest queue. Sign in with the username and password issued by your administrator.</p>
          <div class="auth-points">
            <div class="auth-point">${icon('check', 19)}<span>Accounts are created by an administrator; registered details appear automatically after sign-in.</span></div>
            <div class="auth-point">${icon('check', 19)}<span>File-based estimates, cool-down gaps, daily caps, and printable workflow states.</span></div>
            <div class="auth-point">${icon('check', 19)}<span>No external services, fonts, images, or analytics.</span></div>
          </div>
        </div>
        <small>School STEAM Lab · single-printer booking portal</small>
      </section>
      <section class="auth-panel">
        <div class="auth-card">
          ${storageNoticeHtml()}
          <button class="btn ghost" type="button" data-action="back-to-roles">${icon('back', 17)} Choose another role</button>
          <h2>${esc(title)}</h2>
          <p class="muted">Enter the username and password issued by the lab.</p>
          <form data-form="login" data-testid="login-form" data-role="${esc(role)}" novalidate>
            <div class="form-grid">
              <div class="form-field span-2">
                <label for="login-loginId">${esc(loginLabel)}</label>
                <input id="login-loginId" name="loginId" type="text" value="${esc(state.loginForm.loginId || '')}" autocomplete="username">
                ${fieldError('loginId')}
              </div>
              <div class="form-field span-2">
                <label for="login-password">Password</label>
                <input id="login-password" name="password" type="password" value="${esc(state.loginForm.password || '')}" autocomplete="current-password">
                ${fieldError('password')}
              </div>
              <div class="form-field span-2">${fieldError('general')}</div>
            </div>
            <div class="btn-row">
              <button class="btn primary" type="button" data-action="submit-form" data-form-kind="login" data-testid="login-submit">Sign in ${icon('arrow', 17)}</button>
            </div>
          </form>
          <div class="auth-note">Student and teacher accounts are created by an administrator. No name, class, or serial number is needed to sign in.</div>
        </div>
      </section>
    </main>`;
}

function renderSidebar(account) {
  const nav = NAV[account.role] || NAV.student;
  return `
    <aside class="sidebar">
      <div class="sidebar-brand">
        <span class="brand-mark">${icon('logo', 23)}</span>
        <span><strong>STEAM Lab</strong><small>Booking System</small></span>
      </div>
      <div>
        <div class="sidebar-section-label">Workspace</div>
        <nav class="sidebar-nav" aria-label="Main navigation">
          ${nav.map((item) => `<button class="nav-button ${state.view === item.view ? 'active' : ''}" type="button" data-action="nav" data-view="${esc(item.view)}" aria-current="${state.view === item.view ? 'page' : 'false'}">${icon(item.icon, 18)}<span>${esc(item.label)}</span></button>`).join('')}
        </nav>
      </div>
      <div class="sidebar-footer">
        <div class="user-card">
          <span class="avatar">${esc(String(account.name || 'U').trim().charAt(0).toUpperCase())}</span>
          <span><strong>${esc(account.name)}</strong><small>${esc(account.role)} · ${esc(account.loginId)}</small></span>
        </div>
        <button class="btn logout-button" type="button" data-action="logout">${icon('logout', 17)} Sign out</button>
      </div>
    </aside>`;
}

function renderTopbar(account) {
  const meta = viewMeta(state.view);
  return `
    <header class="topbar">
      <div><h1>${esc(meta.title)}</h1><p>${esc(meta.subtitle)}</p></div>
      <div class="topbar-actions">
        <span class="role-pill">${icon(account.role === 'student' ? 'student' : account.role === 'teacher' ? 'teacher' : 'admin', 16)} ${esc(account.role)}</span>
        <span class="role-pill">${icon('printer', 16)} One 3D printer</span>
      </div>
    </header>`;
}

function renderConfirmBar() {
  if (!state.confirm) return '';
  return `
    <div class="confirm-bar" role="alertdialog" aria-live="assertive">
      <div><strong>${esc(state.confirm.title || 'Please confirm')}</strong><p>${esc(state.confirm.label || '')}</p></div>
      <div class="btn-row">
        <button class="btn danger" type="button" data-action="confirm-yes">Yes, continue</button>
        <button class="btn" type="button" data-action="confirm-no">Keep it</button>
      </div>
    </div>`;
}

function renderPasswordChangeForm() {
  const form = state.passwordForm;
  return `
    <div class="card soft" style="margin-top:16px" data-testid="password-change-panel">
      <div class="card-header"><div><h3>Change password</h3><p>Your registered name, class, serial number, and username stay read-only.</p></div></div>
      <form data-form="change-password" data-testid="password-change-form" novalidate>
        <div class="form-grid">
          <div class="form-field"><label for="current-password">Current Password</label><input id="current-password" name="currentPassword" type="password" value="${esc(form.currentPassword)}" autocomplete="current-password">${fieldError('currentPassword')}</div>
          <div class="form-field"><label for="new-password">New Password</label><input id="new-password" name="newPassword" type="password" value="${esc(form.newPassword)}" autocomplete="new-password">${fieldError('newPassword')}</div>
          <div class="form-field"><label for="confirm-password">Confirm New Password</label><input id="confirm-password" name="confirmPassword" type="password" value="${esc(form.confirmPassword)}" autocomplete="new-password">${fieldError('confirmPassword')}</div>
          <div class="form-field span-2">${fieldError('general')}</div>
        </div>
        <div class="btn-row" style="margin-top:16px">
          <button class="btn primary" type="button" data-action="submit-form" data-form-kind="change-password" data-testid="save-password">${icon('save', 17)} Save new password</button>
          <button class="btn" type="button" data-action="cancel-password-change">Cancel</button>
        </div>
      </form>
    </div>`;
}

function renderAccountIdentity(account) {
  const roleLabel = account.role === 'student' ? 'Student' : account.role === 'teacher' ? 'Teacher' : 'Administrator';
  const fourth = account.role === 'student'
    ? metric('Student serial', account.serial || 'Not assigned', 'Read-only registered serial')
    : account.role === 'teacher'
      ? metric('Issued serial', account.serial || 'Not required', 'Optional lab record')
      : metric('Account scope', 'All registered users', 'Full administrator access');
  const passwordAction = account.role === 'admin' ? '' : `<button class="btn small" type="button" data-action="open-password-change" data-testid="open-password-change">${icon('key', 16)} Change password</button>`;
  return `
    <section class="card" data-testid="account-identity">
      <div class="card-header">
        <div><h2>Registered account</h2><p>These details come directly from the account created by an administrator and are read-only here.</p></div>
        <div class="btn-row"><span class="badge neutral">${esc(roleLabel)}</span>${passwordAction}</div>
      </div>
      <div class="grid-4">
        ${metric('Full name', account.name, 'Registered identity')}
        ${metric('Username', account.loginId, 'Used to sign in')}
        ${account.role === 'student' ? metric('Class', account.className || 'Not recorded', 'Assigned by administrator') : metric('Role', roleLabel, 'Account permission')}
        ${fourth}
      </div>
      ${state.passwordChangeOpen && account.role !== 'admin' ? renderPasswordChangeForm() : ''}
    </section>`;
}

function renderAppShell() {
  const account = state.session;
  if (!account) return renderLanding();
  if (!viewAllowed(account.role, state.view)) state.view = defaultView(account.role);
  return `
    <div class="app-shell">
      ${renderSidebar(account)}
      <main class="content">
        <div class="content-inner">
          ${storageNoticeHtml()}
          ${renderTopbar(account)}
          ${renderConfirmBar()}
          ${renderAccountIdentity(account)}
          ${renderView()}
        </div>
      </main>
    </div>`;
}

function renderView() {
  if (!state.session || !viewAllowed(state.session.role, state.view)) return renderAccessDenied();
  switch (state.view) {
    case 'student-requests': return renderStudentRequests();
    case 'student-new': return renderStudentNew();
    case 'student-schedule': return renderSchedule();
    case 'teacher-review':
    case 'admin-review': return renderTeacherReview();
    case 'teacher-schedule':
    case 'admin-schedule': return renderSchedule();
    case 'teacher-requests':
    case 'admin-requests': return renderAllRequests();
    case 'admin-reports': return renderAdminReports();
    case 'admin-new-request': return renderAdminNewRequest();
    case 'admin-serials': return renderAdminSerials();
    case 'admin-settings': return renderAdminSettings();
    case 'admin-data': return renderAdminData();
    default: return `<section class="card"><h2>Unknown view</h2></section>`;
  }
}

function metric(label, value, foot) {
  return `<div class="metric-card"><span class="metric-label">${esc(label)}</span><span class="metric-value">${esc(value)}</span><span class="metric-foot">${esc(foot)}</span></div>`;
}

function emptyState(title, text, iconName = 'info') {
  return `<div class="empty-state">${icon(iconName, 28)}<strong>${esc(title)}</strong><span>${esc(text)}</span></div>`;
}

function estimateDetailsHtml(estimate) {
  if (!estimate) return '';
  const details = estimate.details || {};
  const items = [];
  if (details.volumeMm3 !== undefined) items.push(['Mesh volume', `${Number(details.volumeMm3).toFixed(1)} mm³`]);
  if (details.surfaceAreaMm2 !== undefined) items.push(['Surface area', `${Number(details.surfaceAreaMm2).toFixed(1)} mm²`]);
  if (details.bbox) items.push(['Bounding box', `${details.bbox.x.toFixed(1)} × ${details.bbox.y.toFixed(1)} × ${details.bbox.z.toFixed(1)} mm`]);
  if (details.triangles !== undefined) items.push(['Triangles', String(details.triangles)]);
  if (details.gcodeSeconds !== undefined) items.push(['Slicer seconds', String(details.gcodeSeconds)]);
  if (details.sizeMB !== undefined) items.push(['File size', `${details.sizeMB} MB`]);
  items.push(['Per copy', formatDuration(estimate.perCopyMinutes)]);
  items.push(['All copies', formatDuration(estimate.totalMinutes)]);
  return `
    <div class="estimate-details">
      ${items.map(([label, value]) => `<div><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`).join('')}
    </div>`;
}

function renderEstimatePanel() {
  const estimate = state.draft.estimate;
  if (!estimate) {
    return `<div class="message-box info" data-testid="estimate-empty">Choose a supported model or image to calculate a file-based estimate. Supported: ${esc(getUploadExtensionsText())}.</div>`;
  }
  return `
    <section class="card soft" data-testid="estimate-panel">
      <div class="card-header">
        <div><h3>Computed print-time estimate</h3><p>${esc(estimate.label)}</p></div>
        <span class="badge approved">${esc(estimate.confidence)} confidence</span>
      </div>
      <div class="grid-3">
        <div class="metric-card"><span class="metric-label">Per copy</span><span class="metric-value">${esc(formatDuration(estimate.perCopyMinutes))}</span></div>
        <div class="metric-card"><span class="metric-label">${esc(estimate.copies)} cop${estimate.copies === 1 ? 'y' : 'ies'}</span><span class="metric-value">${esc(formatDuration(estimate.totalMinutes))}</span></div>
        <div class="metric-card"><span class="metric-label">Method</span><span class="metric-value" style="font-size:1.05rem">${esc(estimate.method)}</span></div>
      </div>
      ${estimateDetailsHtml(estimate)}
      <p class="form-note" style="margin-top:14px"><strong>Formula:</strong> ${esc(estimate.formula)}</p>
      ${estimate.warning ? `<div class="message-box warning" style="margin-top:12px">${icon('alert', 17)} ${esc(estimate.warning)}</div>` : ''}
      ${state.errors.estimate ? `<div class="inline-error">${esc(state.errors.estimate)}</div>` : ''}
    </section>`;
}

function renderUploadForm(onBehalf) {
  const db = getDb();
  const students = db.accounts.filter((account) => account.role === 'student' && account.active);
  const form = state.draft.form;
  const accept = [...MODEL_EXTENSIONS, ...IMAGE_EXTENSIONS].map((extension) => `.${extension}`).join(',') + ',image/*';
  const studentField = onBehalf ? `
    <div class="form-field span-2">
      <label for="draft-studentId">Student account</label>
      <select id="draft-studentId" name="studentId" data-draft-field>
        <option value="">Choose an active student</option>
        ${students.map((student) => `<option value="${esc(student.id)}"${selected(form.studentId, student.id)}>${esc(student.name)} · ${esc(student.loginId)}</option>`).join('')}
      </select>
      ${fieldError('studentId')}
    </div>` : '';
  return `
    <section class="card">
      <div class="card-header"><div><h2>${onBehalf ? 'Create a student request' : 'Upload a print request'}</h2><p>The estimate is calculated from the actual file bytes before submission.</p></div></div>
      <form data-form="upload" data-testid="upload-form" novalidate>
        <div class="form-grid">
          ${studentField}
          <div class="form-field span-2">
            <label for="draft-file">3D model or supporting image</label>
            <input id="draft-file" data-testid="file-input" data-field="upload-file" name="file" type="file" accept="${esc(accept)}">
            <span class="form-note">Allowed: ${esc(getUploadExtensionsText())}. Limit: ${esc(db.settings.maxUploadMB)} MB.</span>
            ${state.draft.file ? `<div class="file-pill">${icon('file', 18)} <span>${esc(state.draft.fileName || state.draft.file.name)} · ${esc(fileSizeLabel(state.draft.file.size))}</span></div>` : ''}
            ${fieldError('file')}
          </div>
          <div class="form-field span-2">
            <label for="draft-title">Title</label>
            <input id="draft-title" name="title" data-draft-field type="text" value="${esc(form.title)}" placeholder="e.g. Geometry calibration cube">
            ${fieldError('title')}
          </div>
          <div class="form-field span-2">
            <label for="draft-notes">Notes for the teacher</label>
            <textarea id="draft-notes" name="notes" data-draft-field>${esc(form.notes)}</textarea>
            ${fieldError('notes')}
          </div>
          <div class="form-field">
            <label for="draft-material">Material</label>
            <select id="draft-material" name="material" data-draft-field>
              ${MATERIALS.map((material) => `<option value="${esc(material)}"${selected(form.material, material)}>${esc(material)}</option>`).join('')}
            </select>
            ${fieldError('material')}
          </div>
          <div class="form-field">
            <label for="draft-colour">Colour</label>
            <input id="draft-colour" name="colour" data-draft-field type="text" value="${esc(form.colour)}">
            ${fieldError('colour')}
          </div>
          <div class="form-field">
            <label for="draft-infill">Infill %</label>
            <input id="draft-infill" name="infill" data-draft-field type="number" min="0" max="100" step="1" value="${esc(form.infill)}">
            ${fieldError('infill')}
          </div>
          <div class="form-field">
            <label for="draft-copies">Copies</label>
            <input id="draft-copies" name="copies" data-draft-field type="number" min="1" max="99" step="1" value="${esc(form.copies)}">
            ${fieldError('copies')}
          </div>
          <div class="form-field span-2">${fieldError('general')}</div>
        </div>
        <div class="btn-row" style="margin-top:18px">
          <button class="btn primary" type="button" data-action="submit-form" data-form-kind="upload">${icon('upload', 17)} Submit request</button>
          <button class="btn" type="button" data-action="reestimate-draft">${icon('refresh', 17)} Re-estimate preview</button>
          <button class="btn ghost" type="button" data-action="clear-draft">Clear form</button>
        </div>
      </form>
    </section>
    ${renderEstimatePanel()}`;
}

function renderSuccessPanel(submission) {
  const request = submission.request;
  const scheduled = request.status === 'approved' && request.schedule && request.schedule.segments.length
    ? `<strong>Scheduled slot:</strong> ${esc(scheduleText(request))}`
    : '<strong>Awaiting teacher approval.</strong> Your request is in the review queue.';
  const secondaryView = submission.view === 'admin-new-request' ? 'admin-requests' : 'student-requests';
  const secondaryLabel = submission.view === 'admin-new-request' ? 'Open all requests' : 'View my requests';
  return `
    <section class="success-panel" data-testid="submission-success">
      <div class="success-icon">${icon('check', 28)}</div>
      <h2>Request submitted</h2>
      <p>Your uploaded file and computed estimate were saved.</p>
      <div class="success-code" data-testid="request-code">${esc(request.code)}</div>
      <div class="message-box info" style="margin-top:16px">${scheduled}</div>
      <div class="btn-row" style="margin-top:20px">
        <button class="btn primary" type="button" data-action="new-request">Submit another request</button>
        <button class="btn" type="button" data-action="nav" data-view="${esc(secondaryView)}">${esc(secondaryLabel)}</button>
      </div>
    </section>`;
}

function renderStudentNew() {
  if (state.lastSubmission && state.lastSubmission.view === 'student-new') return renderSuccessPanel(state.lastSubmission);
  return `
    <section class="card soft"><div class="status-strip">${icon('info', 18)} <span>After submission you will get a request code and either a scheduled slot or “awaiting teacher approval”.</span></div></section>
    ${renderUploadForm(false)}`;
}

function renderAdminNewRequest() {
  if (state.lastSubmission && state.lastSubmission.view === 'admin-new-request') return renderSuccessPanel(state.lastSubmission);
  return `
    <section class="card soft"><div class="status-strip">${icon('info', 18)} <span>This uses the same real student request path, including file storage, estimation, active-request limits, and auto-scheduling.</span></div></section>
    ${renderUploadForm(true)}`;
}

function renderStudentRequests() {
  const db = getDb();
  const mine = db.requests.filter((request) => request.studentId === state.session.id).sort((a, b) => b.submittedAt - a.submittedAt);
  const active = mine.filter((request) => ['pending', 'approved', 'printing', 'printed'].includes(request.status)).length;
  return `
    <section class="grid-4" style="margin-bottom:20px">
      ${metric('My requests', mine.length, 'Only your records')}
      ${metric('Active', active, 'Pending through hand-over')}
      ${metric('Approved', mine.filter((request) => request.status === 'approved').length, 'Reserved printer time')}
      ${metric('Completed', mine.filter((request) => request.status === 'handed').length, 'Handed over')}
    </section>
    <section class="card">
      <div class="card-header">
        <div><h2>Request history</h2><p>Other students’ names and filenames are never shown to you.</p></div>
        <div class="btn-row">
          <button class="btn" type="button" data-action="nav" data-view="student-schedule">${icon('calendar', 17)} Schedule</button>
          <button class="btn primary" type="button" data-action="nav" data-view="student-new">${icon('plus', 17)} New request</button>
        </div>
      </div>
      ${mine.length ? mine.map(renderStudentRequestCard).join('') : emptyState('No requests yet', 'Upload your first model to enter the approval queue.', 'upload')}
    </section>`;
}

function renderStudentRequestCard(request) {
  const canCancel = ['pending', 'approved'].includes(request.status);
  const rejection = request.status === 'rejected' && request.rejectionReason
    ? `<div class="message-box error" style="margin-top:12px"><strong>Teacher feedback:</strong> ${esc(request.rejectionReason)}</div>` : '';
  const cancel = request.cancelReason ? `<div class="message-box info" style="margin-top:12px">${esc(request.cancelReason)}</div>` : '';
  return `
    <article class="request-card" data-request-id="${esc(request.id)}" data-request-code="${esc(request.code)}">
      <div class="request-card-head">
        <div><span class="request-code">${esc(request.code)}</span><h3>${esc(request.title)}</h3><small>Submitted ${esc(formatDateTime(request.submittedAt))}</small></div>
        ${statusBadge(request)}
      </div>
      <dl class="detail-list">
        <div><dt>Estimate</dt><dd>${esc(formatDuration(effectiveMinutes(request)))}${request.adjustedMinutes ? ' (teacher override)' : ''}</dd></div>
        <div><dt>Schedule</dt><dd>${esc(scheduleText(request))}</dd></div>
        <div><dt>Material</dt><dd>${esc(request.material)} · ${esc(request.colour)}</dd></div>
        <div><dt>Infill</dt><dd>${esc(request.infill)}% · ${esc(request.copies)} cop${request.copies === 1 ? 'y' : 'ies'}</dd></div>
        <div><dt>File</dt><dd>${esc(request.file.name)} · ${esc(fileSizeLabel(request.file.size))}</dd></div>
        <div><dt>Method</dt><dd>${esc(request.estimate.label || 'Estimate')}</dd></div>
      </dl>
      ${request.notes ? `<p style="margin:14px 0 0"><strong>Notes:</strong> ${esc(request.notes)}</p>` : ''}
      ${request.schedule && request.schedule.reason && request.schedule.segments.length ? `<div class="message-box info" style="margin-top:12px"><strong>Placement:</strong> ${esc(request.schedule.reason)}</div>` : ''}
      ${rejection}${cancel}
      <div class="btn-row">
        <button class="btn small" type="button" data-action="download" data-id="${esc(request.id)}">${icon('download', 16)} Download file</button>
        ${canCancel ? `<button class="btn small danger" type="button" data-action="cancel" data-id="${esc(request.id)}">${icon('x', 16)} Cancel request</button>` : ''}
      </div>
    </article>`;
}

function renderTeacherReview() {
  const db = getDb();
  const pending = db.requests.filter((request) => request.status === 'pending').sort((a, b) => a.submittedAt - b.submittedAt);
  return `
    <section class="card">
      <div class="card-header">
        <div><h2>Waiting for review</h2><p>${pending.length} request${pending.length === 1 ? '' : 's'} need a decision.</p></div>
        <div class="btn-row">
          <button class="btn" type="button" data-action="nav" data-view="${state.session.role === 'admin' ? 'admin-schedule' : 'teacher-schedule'}">${icon('calendar', 17)} Schedule board</button>
          <button class="btn" type="button" data-action="nav" data-view="${state.session.role === 'admin' ? 'admin-requests' : 'teacher-requests'}">${icon('list', 17)} All requests</button>
        </div>
      </div>
      ${state.errors.general ? `<div class="message-box error" style="margin-bottom:14px">${esc(state.errors.general)}</div>` : ''}
      ${pending.length ? pending.map(renderReviewCard).join('') : emptyState('Review queue is clear', 'New student uploads will appear here with their computed estimate.', 'check')}
    </section>`;
}

function renderReviewCard(request) {
  const approveError = state.errors[`approve-${request.id}`] || '';
  const rejectError = state.errors[`reject-${request.id}`] || state.errors.reason || '';
  const reestimateError = state.errors[`reestimate-${request.id}`] || '';
  return `
    <article class="queue-card" data-request-id="${esc(request.id)}" data-request-code="${esc(request.code)}">
      <div class="queue-card-head">
        <div><span class="request-code">${esc(request.code)}</span><h3>${esc(request.title)}</h3><p>${esc(request.studentName)} · submitted ${esc(formatDateTime(request.submittedAt))}</p></div>
        <div class="status-strip">${statusBadge(request)}${priorityBadge(request.priority)}</div>
      </div>
      <dl class="detail-list">
        <div><dt>Model</dt><dd>${esc(request.file.name)} · ${esc(fileSizeLabel(request.file.size))}</dd></div>
        <div><dt>Student</dt><dd>${esc(request.studentName)}</dd></div>
        <div><dt>Estimate</dt><dd>${esc(formatDuration(effectiveMinutes(request)))} · ${esc(request.estimate.label || 'Estimate')}</dd></div>
        <div><dt>Material</dt><dd>${esc(request.material)} · ${esc(request.colour)}</dd></div>
        <div><dt>Infill</dt><dd>${esc(request.infill)}%</dd></div>
        <div><dt>Copies</dt><dd>${esc(request.copies)}</dd></div>
        <div><dt>Method</dt><dd>${esc(request.estimate.formula || 'File-based estimate')}</dd></div>
        <div><dt>Notes</dt><dd>${esc(request.notes || 'No notes')}</dd></div>
      </dl>
      ${request.estimate.warning ? `<div class="message-box warning" style="margin-top:12px">${esc(request.estimate.warning)}</div>` : ''}
      <div class="btn-row" style="margin-top:14px">
        <button class="btn small" type="button" data-action="download" data-id="${esc(request.id)}">${icon('download', 16)} Download model</button>
        <button class="btn small" type="button" data-action="reestimate" data-id="${esc(request.id)}">${icon('refresh', 16)} Re-estimate from file</button>
      </div>
      ${reestimateError ? `<div class="inline-error">${esc(reestimateError)}</div>` : ''}
      <div class="queue-actions">
        <div class="queue-action-panel">
          <h4>Approve with adjustments</h4>
          <div class="form-grid">
            <div class="form-field">
              <label for="minutes-${esc(request.id)}">Override total minutes</label>
              <input id="minutes-${esc(request.id)}" data-adjust-minutes type="number" min="1" step="1" value="${esc(effectiveMinutes(request))}">
            </div>
            <div class="form-field">
              <label for="priority-${esc(request.id)}">Priority</label>
              <select id="priority-${esc(request.id)}" data-adjust-priority>
                ${Object.entries(PRIORITY_LABELS).map(([value, label]) => `<option value="${esc(value)}"${selected(request.priority, value)}>${esc(label)}</option>`).join('')}
              </select>
            </div>
          </div>
          <div class="btn-row"><button class="btn primary small" type="button" data-action="approve" data-id="${esc(request.id)}" data-testid="approve-request">${icon('check', 16)} Approve & schedule</button></div>
          ${approveError ? `<div class="inline-error">${esc(approveError)}</div>` : ''}
        </div>
        <div class="queue-action-panel">
          <h4>Reject with feedback</h4>
          <div class="form-field">
            <label for="reason-${esc(request.id)}">Reason shown to student</label>
            <textarea id="reason-${esc(request.id)}" data-reject-reason placeholder="Explain what needs to change"></textarea>
          </div>
          <div class="btn-row"><button class="btn danger small" type="button" data-action="reject" data-id="${esc(request.id)}">${icon('x', 16)} Reject request</button></div>
          ${rejectError ? `<div class="inline-error">${esc(rejectError)}</div>` : ''}
        </div>
      </div>
    </article>`;
}

function renderAllRequests() {
  return `
    <section class="card">
      <div class="card-header"><div><h2>Searchable request table</h2><p>Every row has a real action based on its current status.</p></div></div>
      ${state.errors.general ? `<div class="message-box error" style="margin-bottom:14px">${esc(state.errors.general)}</div>` : ''}
      <div class="table-toolbar">
        <div class="form-field"><label for="search-input">Search</label><input id="search-input" data-testid="search-input" type="search" value="${esc(state.filters.search)}" placeholder="Code, title, student, material…"></div>
        <div class="form-field"><label for="filter-status">Status</label><select id="filter-status" data-filter="status"><option value="all"${selected(state.filters.status, 'all')}>All statuses</option>${Object.entries(STATUS_LABELS).map(([value, label]) => `<option value="${esc(value)}"${selected(state.filters.status, value)}>${esc(label)}</option>`).join('')}</select></div>
        <div class="form-field"><label for="filter-priority">Priority</label><select id="filter-priority" data-filter="priority"><option value="all"${selected(state.filters.priority, 'all')}>All priorities</option>${Object.entries(PRIORITY_LABELS).map(([value, label]) => `<option value="${esc(value)}"${selected(state.filters.priority, value)}>${esc(label)}</option>`).join('')}</select></div>
        <button class="btn" type="button" data-action="clear-filters">${icon('refresh', 17)} Clear filters</button>
      </div>
      <div id="requests-table">${renderRequestsTable()}</div>
    </section>`;
}

function requestActionsHtml(request) {
  const buttons = [`<button class="btn small" type="button" data-action="download" data-id="${esc(request.id)}">${icon('download', 15)} Download</button>`];
  if (request.status === 'pending') {
    buttons.push(`<button class="btn small" type="button" data-action="nav" data-view="${state.session.role === 'admin' ? 'admin-review' : 'teacher-review'}">Review</button>`);
    buttons.push(`<button class="btn small danger" type="button" data-action="cancel" data-id="${esc(request.id)}">Cancel</button>`);
  } else if (request.status === 'approved') {
    if (!request.slotConfirmedAt) buttons.push(`<button class="btn small" type="button" data-action="confirm-slot" data-id="${esc(request.id)}">Confirm slot</button>`);
    else buttons.push(`<button class="btn small primary" type="button" data-action="start-print" data-id="${esc(request.id)}">Start print</button>`);
    buttons.push(`<button class="btn small danger" type="button" data-action="cancel" data-id="${esc(request.id)}">Cancel</button>`);
  } else if (request.status === 'printing') {
    buttons.push(`<button class="btn small primary" type="button" data-action="mark-printed" data-id="${esc(request.id)}">Mark printed</button>`);
  } else if (request.status === 'printed') {
    buttons.push(`<button class="btn small primary" type="button" data-action="hand-over" data-id="${esc(request.id)}">Handed to student</button>`);
  }
  return `<div class="table-actions">${buttons.join('')}</div>`;
}

function renderRequestsTable() {
  const db = getDb();
  const search = state.filters.search.trim().toLowerCase();
  const rows = db.requests
    .filter((request) => state.filters.status === 'all' || request.status === state.filters.status)
    .filter((request) => state.filters.priority === 'all' || request.priority === state.filters.priority)
    .filter((request) => !search || [request.code, request.title, request.studentName, request.material, request.file.name].some((value) => String(value || '').toLowerCase().includes(search)))
    .sort((a, b) => b.submittedAt - a.submittedAt);
  if (!rows.length) return emptyState('No matching requests', 'Change the search or filters to see more records.', 'search');
  return `
    <div class="table-wrap" data-testid="requests-table">
      <table>
        <thead><tr><th>Code</th><th>Student / model</th><th>Status</th><th>Priority</th><th>Estimate</th><th>Schedule</th><th>Actions</th></tr></thead>
        <tbody>
          ${rows.map((request) => `
            <tr data-request-id="${esc(request.id)}" data-request-code="${esc(request.code)}">
              <td><strong class="request-code">${esc(request.code)}</strong><small>${esc(formatDate(request.submittedAt))}</small></td>
              <td><strong>${esc(request.title)}</strong><small>${esc(request.studentName)} · ${esc(request.file.name)}</small></td>
              <td>${statusBadge(request)}</td>
              <td>${priorityBadge(request.priority)}</td>
              <td>${esc(formatDuration(effectiveMinutes(request)))}<small>${esc(request.material)} · ${esc(request.infill)}%</small></td>
              <td>${esc(scheduleText(request))}<small>${esc(request.schedule.reason || '')}</small></td>
              <td>${requestActionsHtml(request)}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}

function renderSchedule() {
  const db = getDb();
  const board = buildScheduleBoard(db, state.session, Date.now());
  const hourLines = board.hours.map((_, index) => `<span class="hour-line" style="left:${(index / board.hourCount * 100).toFixed(3)}%"></span>`).join('') + '<span class="hour-line" style="left:100%"></span>';
  const isStudent = state.session.role === 'student';
  const note = isStudent
    ? 'Your own booked blocks are labelled. Everyone else’s busy time is anonymous; names and filenames are never exposed.'
    : 'Blue blocks are printing jobs, hatched blocks are reserved cool-down gaps, and purple blocks are locked while printing.';
  return `
    <section class="card">
      <div class="card-header">
        <div><h2>${esc(board.windowLabel)}</h2><p>${esc(note)}</p></div>
        <div class="btn-row">
          <span class="role-pill">${board.totalBlocks} booked blocks</span>
          <span class="role-pill">${board.coolBlocks} cool-down gaps</span>
          ${isStudent
            ? `<button class="btn" type="button" data-action="refresh-board">${icon('refresh', 17)} Refresh board</button>`
            : `<button class="btn" type="button" data-action="rerun-scheduler">${icon('refresh', 17)} Re-run scheduler</button>`}
        </div>
      </div>
      <div class="board-wrap" data-testid="schedule-board">
        <div class="board" style="--hours:${board.hourCount}">
          <div class="board-header">
            <div class="board-date"><strong>Day</strong><small>${esc(board.slotMinutes)} min slots</small></div>
            <div class="board-hours">${board.hours.map((hour) => `<div class="board-hour-label">${esc(hour)}</div>`).join('')}</div>
          </div>
          ${board.days.map((day) => `
            <div class="board-row ${day.closed ? 'closed' : ''} ${day.today ? 'today' : ''}" data-day="${esc(day.key)}">
              <div class="board-date"><strong>${esc(day.label)}</strong><small>${day.closed ? 'Lab closed' : day.today ? 'Today · open' : `${esc(day.longLabel)} · open`}</small></div>
              <div class="timeline ${day.closed ? 'closed' : ''}">
                ${hourLines}
                ${day.intervals.filter((interval) => interval.width > 0).map((interval) => {
                  const width = Math.max(0.45, Math.min(100, interval.width));
                  const testid = interval.kind === 'job' ? 'schedule-block' : 'cool-block';
                  const classes = `board-block ${interval.kind} ${interval.anonymous ? 'anonymous' : ''} ${interval.locked ? 'locked' : ''}`;
                  return `<div class="${classes}" data-testid="${testid}" style="left:${Math.max(0, interval.left)}%;width:${width}%" title="${esc(interval.title)}" aria-label="${esc(interval.title)}">${esc(interval.label)}</div>`;
                }).join('')}
              </div>
            </div>`).join('')}
        </div>
      </div>
      <div class="board-legend">
        <span><i class="legend-swatch job"></i> Booked print</span>
        <span><i class="legend-swatch cool"></i> Cool-down gap (${esc(board.restGapMinutes)} min)</span>
        <span><i class="legend-swatch anonymous"></i> Anonymous occupied</span>
        <span><i class="legend-swatch locked"></i> Printing · locked</span>
      </div>
    </section>
    <section class="card">
      <div class="card-header"><div><h2>Placement reasons</h2><p>Plain-language scheduler explanation for every visible reservation.</p></div></div>
      ${board.reasons.length ? `<div class="board-reasons">${board.reasons.map((entry) => `
        <div class="reason-row">
          <strong>${esc(entry.code)} · ${esc(entry.title)}${entry.studentName ? ` · ${esc(entry.studentName)}` : ''} <span class="badge neutral">${esc(entry.status)}</span></strong>
          <p>${esc(entry.when)} — ${esc(entry.reason)}</p>
        </div>`).join('')}</div>` : emptyState('No own scheduled requests', 'Booked time belonging to other students is shown anonymously on the grid above.', 'calendar')}
    </section>`;
}

function serialModeCards(mode) {
  return `
    <section class="serial-mode-grid" aria-label="Serial management options">
      <button class="serial-mode-card ${mode === 'student' ? 'selected' : ''}" type="button" data-action="serial-mode" data-mode="student" data-testid="serial-mode-student">
        <span class="serial-mode-icon">${icon('student', 30)}</span>
        <span><strong>Student Serials</strong><small>Full name, class, serial number, username, and password.</small></span>
      </button>
      <button class="serial-mode-card ${mode === 'teacher' ? 'selected' : ''}" type="button" data-action="serial-mode" data-mode="teacher" data-testid="serial-mode-teacher">
        <span class="serial-mode-icon">${icon('teacher', 30)}</span>
        <span><strong>Teacher Serials</strong><small>Full name, optional serial number, username, and password.</small></span>
      </button>
    </section>`;
}

function renderSerialForm(mode, editing) {
  const form = state.serialForm;
  const title = mode === 'student' ? 'Student' : 'Teacher';
  const classField = mode === 'student' ? `
    <div class="form-field"><label for="serial-className">Class</label><input id="serial-className" name="className" data-serial-field type="text" value="${esc(form.className)}" placeholder="Class or form">${fieldError('className')}</div>` : '';
  const serialLabel = mode === 'student' ? 'Student Serial Number' : 'Teacher Serial Number (if applicable)';
  const serialPlaceholder = mode === 'student' ? 'Unique STU-#### serial' : 'Optional T-#### serial';
  const autoApprove = mode === 'student' ? `<label><input type="checkbox" name="autoApprove" data-serial-field${checked(form.autoApprove)}> Auto-approve student jobs</label>` : '';
  return `
    <form data-form="serial-record" data-testid="serial-form" data-role="${esc(mode)}" novalidate>
      <div class="form-grid">
        <div class="form-field"><label for="serial-name">${title} Full Name</label><input id="serial-name" name="name" data-serial-field type="text" value="${esc(form.name)}" autocomplete="off">${fieldError('name')}</div>
        ${classField}
        <div class="form-field"><label for="serial-code">${serialLabel}</label><input id="serial-code" name="serial" data-serial-field type="text" value="${esc(form.serial)}" placeholder="${serialPlaceholder}">${fieldError('serial')}</div>
        <div class="form-field"><label for="serial-username">Username</label><input id="serial-username" name="username" data-serial-field type="text" value="${esc(form.username)}" autocomplete="off">${fieldError('username')}</div>
        <div class="form-field"><label for="serial-password">${editing ? 'New password (blank keeps current)' : 'Password'}</label><input id="serial-password" name="password" data-serial-field type="password" value="${esc(form.password)}" autocomplete="new-password">${fieldError('password')}</div>
        <div class="form-field">
          <label>Account options</label>
          <div class="checkbox-row" style="padding-top:10px">
            <label><input type="checkbox" name="active" data-serial-field${checked(form.active)}> Active</label>
            ${autoApprove}
          </div>
        </div>
        <div class="form-field span-2">${fieldError('general')}</div>
      </div>
      <div class="btn-row" style="margin-top:18px">
        <button class="btn primary" type="button" data-action="submit-form" data-form-kind="serial-record" data-testid="save-serial">${icon('save', 17)} ${editing ? 'Save changes' : `Save ${title} serial`}</button>
        <button class="btn" type="button" data-action="cancel-serial-form">Cancel</button>
      </div>
    </form>`;
}

function serialRecordsHtml(db, mode) {
  const accounts = db.accounts.filter((account) => account.role === mode && !account.permanent);
  if (!accounts.length) {
    return emptyState(`No ${mode} serial records`, `Use + Add ${mode === 'student' ? 'Student' : 'Teacher'} Serial, bulk entry, or Excel import to create linked records.`, 'key');
  }
  return `
    <div class="table-wrap"><table>
      <thead><tr><th>Full name</th>${mode === 'student' ? '<th>Class</th>' : ''}<th>Serial number</th><th>Username</th><th>Linked account</th><th>Status</th><th>Actions</th></tr></thead>
      <tbody>${accounts.map((account) => {
        const record = account.serial ? findSerial(db, account.serial) : null;
        return `<tr data-testid="serial-record" data-login-id="${esc(account.loginId)}" data-serial="${esc(account.serial || '')}">
          <td><strong>${esc(account.name)}</strong><small>Created ${esc(formatDate(account.createdAt))}</small></td>
          ${mode === 'student' ? `<td>${esc(account.className || '—')}</td>` : ''}
          <td>${account.serial ? `<strong>${esc(account.serial)}</strong><small>${record ? esc(record.status) : 'untracked'}</small>` : '<small>Not required</small>'}</td>
          <td>${esc(account.loginId)}</td>
          <td><span class="badge approved">Linked</span><small>Login credentials saved</small></td>
          <td><span class="badge ${account.active ? 'handed' : 'cancelled'}">${account.active ? 'Active' : 'Inactive'}</span>${account.autoApprove ? ' <span class="badge approved">Auto-approve</span>' : ''}</td>
          <td><div class="table-actions"><button class="btn small" type="button" data-action="edit-serial" data-id="${esc(account.id)}">${icon('edit', 15)} Edit</button><button class="btn small danger" type="button" data-action="delete-serial" data-id="${esc(account.id)}">${icon('trash', 15)} Delete</button></div></td>
        </tr>`;
      }).join('')}</tbody>
    </table></div>`;
}

function bulkHeadHtml(mode) {
  const columns = mode === 'student'
    ? ['Full Name', 'Class', 'Serial Number', 'Username', 'Password']
    : ['Full Name', 'Serial Number (if applicable)', 'Username', 'Password'];
  return `<div class="bulk-serial-head ${mode}" aria-hidden="true"><span></span>${columns.map((column) => `<span>${esc(column)}</span>`).join('')}<span></span></div>`;
}

function bulkRowsHtml(mode) {
  return state.bulkSerialRows.map((row, index) => `
    <div class="bulk-serial-row ${mode}" data-testid="bulk-serial-row" data-bulk-row data-row-id="${esc(row.id)}" data-index="${index}">
      <span class="bulk-row-number">${index + 1}</span>
      <input data-bulk-field="name" type="text" value="${esc(row.name)}" placeholder="Full name" aria-label="Full name row ${index + 1}">
      ${mode === 'student' ? `<input data-bulk-field="className" type="text" value="${esc(row.className)}" placeholder="Class" aria-label="Class row ${index + 1}">` : ''}
      <input data-bulk-field="serial" type="text" value="${esc(row.serial)}" placeholder="${mode === 'student' ? 'STU-####' : 'Optional T-####'}" aria-label="Serial number row ${index + 1}">
      <input data-bulk-field="username" type="text" value="${esc(row.username)}" placeholder="Username" aria-label="Username row ${index + 1}">
      <input data-bulk-field="password" type="password" value="${esc(row.password)}" placeholder="Password" aria-label="Password row ${index + 1}" autocomplete="new-password">
      <button class="btn small danger" type="button" data-action="remove-bulk-row" data-index="${index}" aria-label="Remove row ${index + 1}"${state.bulkSerialRows.length <= 1 ? ' disabled' : ''}>${icon('x', 15)}</button>
    </div>`).join('');
}

function reportRowHtml(row) {
  return `<tr>
    <td>${esc(row.source || `Row ${row.rowNumber || ''}`)}</td>
    <td>${esc(row.name || '—')}</td>
    <td>${esc(row.username || '—')}</td>
    <td>${esc(row.serial || '—')}</td>
    <td><span class="badge ${row.status === 'created' ? 'approved' : 'cancelled'}">${row.status === 'created' ? 'Created' : 'Unsuccessful'}</span></td>
    <td>${esc(row.reason || (row.errorText || ''))}</td>
  </tr>`;
}

function bulkReportHtml() {
  const report = state.bulkReport;
  if (!report) return '';
  return `
    <div class="card soft" style="margin-top:16px" data-testid="bulk-report">
      <div class="card-header"><div><h3>Bulk result</h3><p>${report.successful} successful, ${report.unsuccessful} unsuccessful, ${report.total} total.</p></div></div>
      <div class="message-box ${report.successful ? 'success' : 'error'}">${report.successful} record${report.successful === 1 ? '' : 's'} created and linked. ${report.unsuccessful} record${report.unsuccessful === 1 ? '' : 's'} need attention.</div>
      <div class="table-wrap"><table><thead><tr><th>Source</th><th>Full name</th><th>Username</th><th>Serial</th><th>Result</th><th>Detail</th></tr></thead><tbody>${report.report.map(reportRowHtml).join('')}</tbody></table></div>
    </div>`;
}

function bulkSerialsHtml(mode) {
  return `
    <section class="card" data-testid="bulk-generate-section">
      <div class="card-header"><div><h2>Bulk Generate</h2><p>Enter every username and password yourself. Full name, class, serial number, username, and password remain separate fields.</p></div></div>
      <form data-form="bulk-serials" data-testid="bulk-serials-form" novalidate>
        ${bulkHeadHtml(mode)}
        ${bulkRowsHtml(mode)}
        <div class="btn-row" style="margin-top:16px">
          <button class="btn primary" type="button" data-action="submit-form" data-form-kind="bulk-serials" data-testid="save-bulk-serials">${icon('save', 17)} Bulk Generate ${mode === 'student' ? 'Student' : 'Teacher'} Serials</button>
          <button class="btn" type="button" data-action="add-bulk-row" data-testid="add-bulk-row">${icon('plus', 17)} Add row</button>
        </div>
      </form>
      ${bulkReportHtml()}
    </section>`;
}

function excelPreviewHtml() {
  const preview = state.excelPreview;
  if (!preview) return '';
  return `
    <div class="card soft" style="margin-top:16px" data-testid="excel-preview">
      <div class="card-header"><div><h3>Import preview</h3><p>${preview.sheets.length} worksheet${preview.sheets.length === 1 ? '' : 's'} · ${preview.total} row${preview.total === 1 ? '' : 's'} · ${preview.validCount} ready · ${preview.invalidCount} need attention.</p></div></div>
      <div class="message-box warning">Duplicate usernames, duplicate serial numbers, missing fields, and incorrect formats are marked below. Passwords are never shown in this preview.</div>
      <div class="table-wrap"><table>
        <thead><tr><th>Source</th><th>Role</th><th>Full name</th><th>Class</th><th>Serial</th><th>Username</th><th>Password</th><th>Status</th><th>Detail</th></tr></thead>
        <tbody>${preview.rows.map((row) => `<tr>
          <td>${esc(row.source || `Row ${row.rowNumber || ''}`)}</td>
          <td>${esc(row.role)}</td>
          <td>${esc(row.name || '—')}</td>
          <td>${row.role === 'student' ? esc(row.className || '—') : '<small>Not required</small>'}</td>
          <td>${esc(row.serial || '—')}</td>
          <td>${esc(row.username || '—')}</td>
          <td>${row.password ? '<span class="badge handed">Provided</span>' : '<span class="badge cancelled">Missing</span>'}</td>
          <td><span class="badge ${row.valid ? 'approved' : 'cancelled'}">${row.valid ? 'Ready' : 'Unsuccessful'}</span></td>
          <td>${esc(row.errorText || 'Ready to import')}</td>
        </tr>`).join('')}</tbody>
      </table></div>
      <div class="btn-row" style="margin-top:16px">
        <button class="btn primary" type="button" data-action="confirm-excel-import" data-testid="confirm-excel-import"${preview.validCount ? '' : ' disabled'}>${icon('check', 17)} Confirm import</button>
        <button class="btn" type="button" data-action="cancel-excel-import">Cancel</button>
      </div>
    </div>`;
}

function excelReportHtml() {
  const report = state.excelReport;
  if (!report) return '';
  return `
    <div class="card soft" style="margin-top:16px" data-testid="excel-report">
      <div class="card-header"><div><h3>Import success/error report</h3><p>${report.successful} successful, ${report.unsuccessful} unsuccessful, ${report.total} total.</p></div></div>
      <div class="message-box ${report.successful ? 'success' : 'error'}">${report.successful} record${report.successful === 1 ? '' : 's'} imported and linked. ${report.unsuccessful} row${report.unsuccessful === 1 ? '' : 's'} were skipped.</div>
      <div class="table-wrap"><table><thead><tr><th>Source</th><th>Full name</th><th>Username</th><th>Serial</th><th>Result</th><th>Detail</th></tr></thead><tbody>${report.report.map(reportRowHtml).join('')}</tbody></table></div>
    </div>`;
}

function excelSerialsHtml() {
  return `
    <section class="card" data-testid="excel-section">
      <div class="card-header"><div><h2>Excel template & import</h2><p>Download a formatted two-sheet workbook, fill it in, preview every row, then confirm the import.</p></div></div>
      <div class="btn-row"><button class="btn primary" type="button" data-action="download-excel-template" data-testid="download-excel-template">${icon('download', 17)} Download Excel Template</button></div>
      <div class="form-section">
        <h3>Upload Excel file</h3>
        <p>Student columns: Full Name, Class, Serial Number, Username, Password. Teacher columns: Full Name, Serial Number (if applicable), Username, Password.</p>
        <div class="form-field"><label for="excel-file">Completed .xlsx workbook</label><input id="excel-file" data-field="excel-file" data-testid="excel-file" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"></div>
        ${state.excelFileName ? `<div class="file-pill" style="margin-top:10px">${icon('file', 17)} ${esc(state.excelFileName)}</div>` : ''}
        <div class="btn-row" style="margin-top:14px"><button class="btn" type="button" data-action="upload-excel" data-testid="upload-excel">${icon('upload', 17)} Preview Excel import</button></div>
        ${state.errors.excel ? `<div class="message-box error" style="margin-top:12px">${esc(state.errors.excel)}</div>` : ''}
        ${excelPreviewHtml()}
        ${excelReportHtml()}
      </div>
    </section>`;
}

function serialPoolHtml(db) {
  const free = db.serials.filter((serial) => serial.status === 'free');
  const eligibleAccounts = (role) => db.accounts.filter((account) => account.role === role && account.active && !account.permanent);
  return `
    <section class="card">
      <div class="card-header">
        <div><h2>Serial pool</h2><p>All assigned and free codes. Assignment controls remain available for pre-existing free codes.</p></div>
        <button class="btn" type="button" data-action="export-serials">${icon('download', 17)} Export serials CSV</button>
      </div>
      ${free.length ? `<div class="serial-grid" style="margin-bottom:16px">${free.map((serial) => `<div class="serial-chip free">${esc(serial.code)} · ${esc(serial.role)}</div>`).join('')}</div>` : ''}
      ${state.errors.serialAssign ? `<div class="message-box error">${esc(state.errors.serialAssign)}</div>` : ''}
      ${db.serials.length ? `
        <div class="table-wrap"><table>
          <thead><tr><th>Serial</th><th>Role</th><th>Status</th><th>Assigned to</th><th>Assigned at</th><th>Assign</th></tr></thead>
          <tbody>${db.serials.slice().sort((a, b) => a.code.localeCompare(b.code)).map((serial) => {
            const account = serial.assignedTo ? findAccountById(db, serial.assignedTo) : null;
            const accounts = eligibleAccounts(serial.role);
            return `<tr>
              <td><strong>${esc(serial.code)}</strong></td><td>${esc(serial.role)}</td>
              <td><span class="badge ${serial.status === 'free' ? 'handed' : 'approved'}">${esc(serial.status)}</span></td>
              <td>${account ? `${esc(account.name)}<small>${esc(account.loginId)}</small>` : '<small>Unassigned</small>'}</td>
              <td>${serial.assignedAt ? esc(formatDateTime(serial.assignedAt)) : '<small>Not assigned yet</small>'}</td>
              <td>${serial.status === 'free' ? `<div class="table-actions"><select data-serial-select="${esc(serial.code)}" aria-label="Account for ${esc(serial.code)}"><option value="">Choose account</option>${accounts.map((item) => `<option value="${esc(item.id)}">${esc(item.name)} · ${esc(item.loginId)}</option>`).join('')}</select><button class="btn small" type="button" data-action="assign-serial" data-code="${esc(serial.code)}">Assign</button></div>` : '<small>Linked to this account</small>'}</td>
            </tr>`;
          }).join('')}</tbody>
        </table></div>` : emptyState('No serial records yet', 'Create an individual record, use bulk entry, or import a completed Excel template.', 'key')}
    </section>`;
}

function renderAdminSerials() {
  const db = getDb();
  const mode = state.serialMode === 'teacher' ? 'teacher' : 'student';
  const title = mode === 'student' ? 'Student Serials' : 'Teacher Serials';
  const accounts = db.accounts.filter((account) => account.role === mode && !account.permanent);
  const modeSerials = db.serials.filter((serial) => serial.role === mode);
  const free = db.serials.filter((serial) => serial.status === 'free');
  return `
    ${serialModeCards(mode)}
    <section class="grid-4" style="margin-bottom:20px">
      ${metric(`${mode} records`, accounts.length, 'Linked login accounts')}
      ${metric('Assigned codes', modeSerials.filter((serial) => serial.status === 'assigned').length, 'Synchronised serial records')}
      ${metric('Free codes', free.length, 'Available for assignment')}
      ${metric('All codes', db.serials.length, 'Created or imported')}
    </section>
    <section class="card">
      <div class="card-header">
        <div><h2>${title}</h2><p>Every saved record creates a linked login account. Passwords are hashed and are never displayed after entry.</p></div>
        <button class="btn primary" type="button" data-action="add-serial-form" data-testid="add-${mode}-serial">${icon('plus', 17)} Add ${mode === 'student' ? 'Student' : 'Teacher'} Serial</button>
      </div>
      ${state.serialFormOpen ? renderSerialForm(mode, Boolean(state.serialEditId)) : ''}
      ${serialRecordsHtml(db, mode)}
    </section>
    ${bulkSerialsHtml(mode)}
    ${excelSerialsHtml()}
    ${serialPoolHtml(db)}`;
}

function renderAdminSettings() {
  const form = state.settingsForm;
  const numberField = (name, label, min, max, extra = '') => `
    <div class="form-field"><label for="settings-${esc(name)}">${esc(label)}</label><input id="settings-${esc(name)}" name="${esc(name)}" type="number" min="${min}" max="${max}" value="${esc(form[name])}">${extra ? `<span class="form-note">${esc(extra)}</span>` : ''}${fieldError(name)}</div>`;
  return `
    <section class="card">
      <div class="card-header"><div><h2>Lab configuration</h2><p>Saving recalculates every approved future reservation immediately.</p></div></div>
      <form data-form="settings" data-settings-form novalidate>
        <div class="form-grid">
          <div class="form-field"><label for="settings-openTime">Open time</label><input id="settings-openTime" name="openTime" type="time" value="${esc(form.openTime)}">${fieldError('openTime')}</div>
          <div class="form-field"><label for="settings-closeTime">Close time</label><input id="settings-closeTime" name="closeTime" type="time" value="${esc(form.closeTime)}">${fieldError('closeTime')}</div>
          <div class="form-field span-2"><label>Working days</label><div class="checkbox-row">${DAY_NAMES.map((day) => `<label><input type="checkbox" name="workingDays" value="${day.value}"${checked(form.workingDays.includes(day.value))}> ${esc(day.label)}</label>`).join('')}</div>${fieldError('workingDays')}</div>
          ${numberField('slotMinutes', 'Slot length (minutes)', 5, 180)}
          ${numberField('restGapMinutes', 'Rest / cool-down gap (minutes)', 0, 240)}
          ${numberField('dailyCapMinutes', 'Daily printing cap (minutes)', 30, 1440, 'Default 420 min = 7 hours')}
          ${numberField('minLeadMinutes', 'Minimum lead time (minutes)', 0, 10080, 'Default 720 min = 12 hours')}
          ${numberField('maxActivePerStudent', 'Max active requests per student', 1, 20)}
          ${numberField('maxUploadMB', 'Upload size limit (MB)', 1, 200)}
          <div class="form-field span-2"><label>Build volume (mm)</label><div class="grid-3">
            <input name="buildVolumeX" aria-label="Build volume X" type="number" min="50" max="2000" value="${esc(form.buildVolume.x)}">
            <input name="buildVolumeY" aria-label="Build volume Y" type="number" min="50" max="2000" value="${esc(form.buildVolume.y)}">
            <input name="buildVolumeZ" aria-label="Build volume Z" type="number" min="50" max="2000" value="${esc(form.buildVolume.z)}">
          </div><span class="form-note">X · Y · Z. STL estimates warn when the mesh exceeds these limits.</span>${fieldError('buildVolume_x')}${fieldError('buildVolume_y')}${fieldError('buildVolume_z')}</div>
          <div class="form-field span-2">${fieldError('general')}</div>
        </div>
        <div class="btn-row" style="margin-top:18px">
          <button class="btn primary" type="button" data-action="submit-form" data-form-kind="settings">${icon('save', 17)} Save settings</button>
          <button class="btn" type="button" data-action="reset-settings">${icon('refresh', 17)} Reset to defaults</button>
          <button class="btn" type="button" data-action="rerun-scheduler">${icon('calendar', 17)} Re-run scheduler</button>
        </div>
      </form>
    </section>`;
}

function renderAdminReports() {
  const db = getDb();
  const report = computeReports(db);
  return `
    <section class="grid-4" style="margin-bottom:20px">
      ${metric('Total jobs', report.totalJobs, 'All submitted requests')}
      ${metric('Average job', formatDuration(report.averageJobLength), 'Estimated / adjusted length')}
      ${metric('Scheduled hours', `${report.scheduledHours} h`, 'Across all visible weeks')}
      ${metric('Handed over', `${report.completionRate}%`, 'Completion rate')}
    </section>
    <div class="grid-2">
      <section class="card">
        <div class="card-header"><div><h2>Jobs by status</h2><p>Computed live from the request table.</p></div><button class="btn small" type="button" data-action="export-report-csv">${icon('download', 16)} Export CSV</button></div>
        <div class="report-status-grid">${Object.entries(report.statusCounts).map(([status, count]) => `<div class="report-status-item"><span class="badge ${esc(status)}">${esc(STATUS_LABELS[status])}</span><strong>${esc(count)}</strong></div>`).join('')}</div>
      </section>
      <section class="card">
        <div class="card-header"><div><h2>Busiest students</h2><p>Ranked by non-cancelled job count.</p></div></div>
        ${report.busiestStudents.length ? `<div class="table-wrap"><table><thead><tr><th>Student</th><th>Jobs</th><th>Print minutes</th></tr></thead><tbody>${report.busiestStudents.map((student) => `<tr><td>${esc(student.name)}</td><td>${esc(student.jobs)}</td><td>${esc(formatDuration(student.minutes))}</td></tr>`).join('')}</tbody></table></div>` : emptyState('No completed job data', 'Submit and approve jobs to populate this report.', 'chart')}
      </section>
    </div>
    <div class="grid-2">
      <section class="card">
        <div class="card-header"><div><h2>Printing hours per week</h2><p>Scheduled and completed printing minutes grouped by ISO-style week.</p></div></div>
        ${report.weeklyHours.length ? `<div class="table-wrap"><table><thead><tr><th>Week</th><th>Hours</th><th>Minutes</th></tr></thead><tbody>${report.weeklyHours.map((week) => `<tr><td>${esc(week.label)}</td><td>${esc(week.hours)} h</td><td>${esc(Math.round(week.minutes))} min</td></tr>`).join('')}</tbody></table></div>` : emptyState('No printing hours yet', 'Approved schedules and printed jobs will appear here.', 'clock')}
      </section>
      <section class="card">
        <div class="card-header"><div><h2>Recent activity</h2><p>Every state-changing operation is recorded.</p></div></div>
        ${report.recentActivity.length ? report.recentActivity.map((entry) => `<div class="activity-item"><span class="activity-dot"></span><div><strong>${esc(entry.detail)}</strong><small>${esc(entry.actorName || entry.actor)} · ${esc(formatDateTime(entry.at))}</small></div></div>`).join('') : emptyState('No activity yet', 'Actions will be logged here.', 'list')}
      </section>
    </div>`;
}

function renderAdminData() {
  return `
    <div class="grid-2">
      <section class="card">
        <div class="card-header"><div><h2>Export</h2><p>JSON backup includes uploaded file bytes; CSV is a flat request table.</p></div></div>
        <div class="btn-row">
          <button class="btn primary" type="button" data-action="export-backup">${icon('database', 17)} Export DB as JSON</button>
          <button class="btn" type="button" data-action="export-requests-csv">${icon('download', 17)} Export requests CSV</button>
        </div>
        <div class="form-section">
          <h3>Import a validated backup</h3>
          <p>Only a steamlab-backup-v2 file with a valid database and file list is accepted.</p>
          <div class="form-field"><label for="backup-file">Backup JSON file</label><input id="backup-file" data-field="backup-file" data-testid="backup-file" type="file" accept=".json,application/json"></div>
          ${state.backupFileName ? `<div class="file-pill" style="margin-top:10px">${icon('file', 17)} ${esc(state.backupFileName)}</div>` : ''}
          <div class="btn-row" style="margin-top:14px"><button class="btn" type="button" data-action="import-backup">${icon('upload', 17)} Validate & import</button></div>
          ${state.errors.backup ? `<div class="message-box error" style="margin-top:12px">${esc(state.errors.backup)}</div>` : ''}
          ${state.success.backup ? `<div class="message-box success" style="margin-top:12px">${esc(state.success.backup)}</div>` : ''}
        </div>
      </section>
      <section class="card">
        <div class="card-header"><div><h2>Reset</h2><p>Restore the two permanent administrator accounts and clear all student accounts, teacher accounts, serials, settings, requests, and uploaded files.</p></div></div>
        <div class="message-box warning">${icon('alert', 17)} This clears current app data and uploaded files from the browser store. It asks for an in-app confirmation first.</div>
        <div class="btn-row" style="margin-top:16px"><button class="btn danger" type="button" data-action="reset-factory">${icon('trash', 17)} Reset to factory accounts</button></div>
      </section>
    </div>`;
}

function renderSelfTestPage() {
  let result;
  try {
    result = runSelfTest();
  } catch (error) {
    result = {
      ok: false,
      passed: 0,
      failed: 1,
      firstFailure: 'self-test harness',
      checks: [{ name: 'self-test harness', pass: false, detail: error && error.stack ? error.stack : String(error) }]
    };
  }
  return `
    <main class="selftest-shell">
      <section class="selftest-card">
        ${storageNoticeHtml()}
        <div class="brand-line" style="justify-content:flex-start"><span class="brand-mark">${icon('logo', 24)}</span><span class="brand-text">In-page self-test</span></div>
        <h1>Live scheduler & persistence check</h1>
        <p>This route builds an isolated temporary store. It does not read or write the real app database.</p>
        <div class="selftest-result ${result.ok ? 'pass' : 'fail'}" data-testid="selftest-result">
          ${icon(result.ok ? 'check' : 'alert', 30)}
          <span>${result.ok ? 'PASS' : 'FAIL'}${result.ok ? ` — ${result.passed} assertions passed` : ` — ${esc(result.firstFailure || 'assertion failed')}`}</span>
        </div>
        <div class="card soft">
          ${result.checks.map((item) => `
            <div class="selftest-check">
              <span class="check-badge ${item.pass ? 'pass' : 'fail'}">${item.pass ? 'PASS' : 'FAIL'}</span>
              <div><strong>${esc(item.name)}</strong><small>${esc(item.detail)}</small></div>
            </div>`).join('')}
        </div>
        <div class="btn-row" style="margin-top:18px">
          <button class="btn primary" type="button" data-action="rerun-selftest">${icon('refresh', 17)} Run again</button>
          <button class="btn" type="button" data-action="leave-selftest">Back to app</button>
        </div>
      </section>
    </main>`;
}

function readSerialForm(form) {
  const data = new FormData(form);
  state.serialForm = {
    name: String(data.get('name') || ''),
    className: String(data.get('className') || ''),
    serial: String(data.get('serial') || ''),
    username: String(data.get('username') || ''),
    password: String(data.get('password') || ''),
    active: data.has('active'),
    autoApprove: data.has('autoApprove'),
    role: state.serialMode
  };
  return state.serialForm;
}

function readBulkRows(form) {
  const mode = state.serialMode === 'teacher' ? 'teacher' : 'student';
  const rows = [...form.querySelectorAll('[data-bulk-row]')].map((row, index) => ({
    id: row.dataset.rowId || makeId('bulk'),
    role: mode,
    name: row.querySelector('[data-bulk-field="name"]').value,
    className: mode === 'student' ? row.querySelector('[data-bulk-field="className"]').value : '',
    serial: row.querySelector('[data-bulk-field="serial"]').value,
    username: row.querySelector('[data-bulk-field="username"]').value,
    password: row.querySelector('[data-bulk-field="password"]').value,
    active: true,
    autoApprove: false,
    source: `Bulk row ${index + 1}`,
    rowNumber: index + 1
  }));
  state.bulkSerialRows = rows;
  return rows;
}

function readPasswordForm(form) {
  const data = new FormData(form);
  state.passwordForm = {
    currentPassword: String(data.get('currentPassword') || ''),
    newPassword: String(data.get('newPassword') || ''),
    confirmPassword: String(data.get('confirmPassword') || '')
  };
  return state.passwordForm;
}

function readSettingsForm(form) {
  const data = new FormData(form);
  state.settingsForm = {
    openTime: String(data.get('openTime') || ''),
    closeTime: String(data.get('closeTime') || ''),
    workingDays: data.getAll('workingDays').map(Number),
    slotMinutes: String(data.get('slotMinutes') || ''),
    restGapMinutes: String(data.get('restGapMinutes') || ''),
    dailyCapMinutes: String(data.get('dailyCapMinutes') || ''),
    minLeadMinutes: String(data.get('minLeadMinutes') || ''),
    maxActivePerStudent: String(data.get('maxActivePerStudent') || ''),
    maxUploadMB: String(data.get('maxUploadMB') || ''),
    buildVolume: {
      x: String(data.get('buildVolumeX') || ''),
      y: String(data.get('buildVolumeY') || ''),
      z: String(data.get('buildVolumeZ') || '')
    }
  };
  return state.settingsForm;
}

function settingsPayload() {
  const form = state.settingsForm;
  return {
    openTime: form.openTime,
    closeTime: form.closeTime,
    workingDays: form.workingDays,
    slotMinutes: Number(form.slotMinutes),
    restGapMinutes: Number(form.restGapMinutes),
    dailyCapMinutes: Number(form.dailyCapMinutes),
    minLeadMinutes: Number(form.minLeadMinutes),
    maxActivePerStudent: Number(form.maxActivePerStudent),
    maxUploadMB: Number(form.maxUploadMB),
    buildVolume: {
      x: Number(form.buildVolume.x),
      y: Number(form.buildVolume.y),
      z: Number(form.buildVolume.z)
    }
  };
}

function readDraftForm(form) {
  const data = new FormData(form);
  for (const key of ['title', 'notes', 'material', 'colour', 'infill', 'copies', 'studentId']) {
    if (data.has(key)) state.draft.form[key] = String(data.get(key) || '');
  }
  return state.draft.form;
}

function clearDraftErrors() {
  for (const key of ['file', 'title', 'notes', 'material', 'colour', 'infill', 'copies', 'studentId', 'general', 'estimate']) delete state.errors[key];
}

async function refreshDraftEstimate() {
  clearDraftErrors();
  if (!state.draft.file) {
    state.draft.estimate = null;
    state.draft.bytes = null;
    render();
    toast('Choose a file first', 'info', 'The estimate is calculated from the uploaded bytes.');
    return;
  }
  try {
    const result = await previewEstimate(state.draft.file, state.draft.form);
    if (!result.ok) {
      state.draft.estimate = null;
      state.draft.bytes = null;
      Object.assign(state.errors, result.errors);
      render();
      toast('Estimate needs attention', 'error', Object.values(result.errors)[0] || 'Check the upload fields.');
      return;
    }
    state.draft.bytes = result.bytes;
    state.draft.estimate = result.estimate;
    render();
    toast('Estimate calculated', 'success', `${result.estimate.label} · ${formatDuration(result.estimate.totalMinutes)} total`);
  } catch (error) {
    state.errors.file = error.message || 'The estimate could not be calculated.';
    render();
    toast('Estimate failed', 'error', state.errors.file);
  }
}

function refreshTableOnly() {
  const container = document.getElementById('requests-table');
  if (container) container.innerHTML = renderRequestsTable();
}

function clearActionErrors() {
  state.errors = {};
  state.success = {};
}

async function handleAction(action, button, event) {
  if (button && button.tagName === 'BUTTON') event.preventDefault();
  const db = fatalError || isSelfTestRoute() ? null : getDbSafe();
  try {
    switch (action) {
      case 'submit-form': {
        const form = button.closest('form[data-form]');
        if (!form) throw new Error('The form is no longer available.');
        await handleSubmit({ target: form, preventDefault() {} });
        break;
      }
      case 'choose-role': {
        state.loginRole = button.dataset.role;
        state.view = 'login';
        state.loginForm = blankLogin();
        clearActionErrors();
        render();
        toast(`${state.loginRole} sign-in opened`, 'info', 'Enter the username and password issued by your administrator.');
        break;
      }
      case 'back-to-roles': {
        state.view = 'landing';
        state.loginRole = null;
        clearActionErrors();
        render();
        toast('Role chooser opened', 'info');
        break;
      }
      case 'nav': {
        const nextView = button.dataset.view;
        if (!state.session || !viewAllowed(state.session.role, nextView)) {
          render();
          toast('Access denied', 'error', 'Your role cannot open that workspace.');
          break;
        }
        state.view = nextView;
        state.confirm = null;
        clearActionErrors();
        render();
        toast(`${viewMeta(state.view).title} opened`, 'info');
        break;
      }
      case 'logout': {
        const role = state.session ? state.session.role : 'student';
        logout(state.session);
        state.session = null;
        state.view = 'login';
        state.loginRole = role;
        state.loginForm = blankLogin();
        state.passwordChangeOpen = false;
        state.passwordForm = blankPasswordForm();
        resetSerialWorkspace('student');
        clearActionErrors();
        render();
        toast('Signed out', 'success', 'Sign-in page opened.');
        break;
      }
      case 'download': {
        const file = await getRequestFile(button.dataset.id, state.session);
        if (!file) throw new Error('That uploaded file is no longer available in this browser.');
        downloadBlob(file.bytes, file.name, file.mime);
        toast('Download started', 'success', file.name);
        break;
      }
      case 'reestimate-draft': {
        await refreshDraftEstimate();
        break;
      }
      case 'clear-draft': {
        state.draft = makeDraft();
        state.lastSubmission = null;
        clearDraftErrors();
        render();
        toast('Draft cleared', 'info');
        break;
      }
      case 'new-request': {
        state.draft = makeDraft();
        state.lastSubmission = null;
        clearActionErrors();
        render();
        toast('Ready for another request', 'info');
        break;
      }
      case 'reestimate': {
        const id = button.dataset.id;
        try {
          const estimate = await reestimateFromFile(id, state.session);
          delete state.errors[`reestimate-${id}`];
          render();
          toast('Re-estimated from file', 'success', `${estimate.label} · ${formatDuration(estimate.totalMinutes)} total`);
        } catch (error) {
          state.errors[`reestimate-${id}`] = error && error.message ? error.message : String(error);
          render();
          toast('Re-estimate failed', 'error', state.errors[`reestimate-${id}`]);
        }
        break;
      }
      case 'approve': {
        const id = button.dataset.id;
        const card = button.closest('[data-request-id]');
        const minutes = card.querySelector('[data-adjust-minutes]').value;
        const priority = card.querySelector('[data-adjust-priority]').value;
        const result = approveRequest(db, id, { minutes, priority }, state.session);
        if (!result.ok) {
          state.errors[`approve-${id}`] = Object.values(result.errors).join(' ');
          render();
          toast('Approval needs attention', 'error', state.errors[`approve-${id}`]);
        } else {
          delete state.errors[`approve-${id}`];
          render();
          toast('Approved and scheduled', 'success', result.schedule);
        }
        break;
      }
      case 'reject': {
        const id = button.dataset.id;
        const card = button.closest('[data-request-id]');
        const reason = card.querySelector('[data-reject-reason]').value;
        const result = rejectRequest(db, id, reason, state.session);
        if (!result.ok) {
          state.errors[`reject-${id}`] = Object.values(result.errors).join(' ');
          render();
          toast('Rejection needs a reason', 'error', state.errors[`reject-${id}`]);
        } else {
          delete state.errors[`reject-${id}`];
          render();
          toast('Request rejected', 'success', 'The reason is now visible to the student.');
        }
        break;
      }
      case 'confirm-slot': {
        const result = confirmSlot(db, button.dataset.id, state.session);
        handleOperationResult(result, 'Slot confirmed', 'Slot could not be confirmed');
        break;
      }
      case 'start-print': {
        const result = startPrint(db, button.dataset.id, state.session);
        handleOperationResult(result, 'Print started', 'Print could not be started', 'Job is locked; the scheduler will not move it.');
        break;
      }
      case 'mark-printed': {
        const result = markPrinted(db, button.dataset.id, state.session);
        handleOperationResult(result, 'Marked printed', 'Could not mark printed', 'Future reserved time was released.');
        break;
      }
      case 'hand-over': {
        const result = handOver(db, button.dataset.id, state.session);
        handleOperationResult(result, 'Handed to student', 'Hand-over could not be completed');
        break;
      }
      case 'cancel': {
        const request = findRequestById(db, button.dataset.id);
        state.confirm = { type: 'cancel', id: button.dataset.id, title: 'Cancel this request?', label: request ? `${request.code} · ${request.title} will release its reserved time.` : 'This request will release its reserved time.' };
        render();
        toast('Confirm cancellation', 'info', 'Use the confirmation bar above.');
        break;
      }
      case 'confirm-no': {
        state.confirm = null;
        render();
        toast('No changes made', 'info');
        break;
      }
      case 'confirm-yes': {
        await handleConfirmYes();
        break;
      }
      case 'refresh-board': {
        render();
        toast('Schedule board refreshed', 'info');
        break;
      }
      case 'rerun-scheduler': {
        rerunScheduler(state.session);
        render();
        toast('Scheduler re-run', 'success', 'Cool-down gaps, caps, and priorities were recalculated.');
        break;
      }
      case 'clear-filters': {
        state.filters = { search: '', status: 'all', priority: 'all' };
        render();
        toast('Filters cleared', 'info');
        break;
      }
      case 'serial-mode': {
        const mode = button.dataset.mode === 'teacher' ? 'teacher' : 'student';
        resetSerialWorkspace(mode);
        clearActionErrors();
        render();
        toast(`${mode === 'student' ? 'Student' : 'Teacher'} Serials opened`, 'info');
        break;
      }
      case 'add-serial-form': {
        state.serialFormOpen = true;
        state.serialEditId = null;
        state.serialForm = makeSerialForm(state.serialMode);
        clearActionErrors();
        render();
        toast('Add serial record', 'info', 'All fields are entered separately.');
        break;
      }
      case 'cancel-serial-form': {
        state.serialFormOpen = false;
        state.serialEditId = null;
        state.serialForm = makeSerialForm(state.serialMode);
        clearActionErrors();
        render();
        toast('Serial form closed', 'info');
        break;
      }
      case 'edit-serial': {
        const account = findAccountById(db, button.dataset.id);
        if (!account) throw new Error('That serial record no longer exists.');
        state.serialMode = account.role === 'teacher' ? 'teacher' : 'student';
        state.serialFormOpen = true;
        state.serialEditId = account.id;
        state.serialForm = {
          name: account.name,
          className: account.className || '',
          serial: account.serial || '',
          username: account.loginId,
          password: '',
          active: account.active,
          autoApprove: Boolean(account.autoApprove),
          role: state.serialMode
        };
        clearActionErrors();
        render();
        toast('Editing serial record', 'info', account.loginId);
        break;
      }
      case 'delete-serial': {
        const account = findAccountById(db, button.dataset.id);
        state.confirm = {
          type: 'delete-serial',
          id: button.dataset.id,
          title: 'Delete this serial record?',
          label: account ? `${account.name} (${account.loginId}) and its serial ${account.serial || 'record'} will be removed with the linked login account. Existing requests stay in reports.` : 'This serial record and its linked login account will be removed.'
        };
        render();
        toast('Confirm serial deletion', 'info', 'Use the confirmation bar above.');
        break;
      }
      case 'add-bulk-row': {
        const form = button.closest('form[data-form="bulk-serials"]');
        if (form) readBulkRows(form);
        state.bulkSerialRows.push(makeBulkSerialRow(state.serialMode, state.bulkSerialRows.length + 1));
        state.bulkReport = null;
        render();
        toast('Bulk row added', 'info');
        break;
      }
      case 'remove-bulk-row': {
        const form = button.closest('form[data-form="bulk-serials"]');
        if (form) readBulkRows(form);
        if (state.bulkSerialRows.length <= 1) {
          toast('At least one bulk row is required', 'info');
          break;
        }
        state.bulkSerialRows.splice(Number(button.dataset.index), 1);
        state.bulkReport = null;
        render();
        toast('Bulk row removed', 'info');
        break;
      }
      case 'download-excel-template': {
        const template = serialsTemplate(state.session);
        downloadBlob(template.bytes, template.fileName, template.mime);
        toast('Excel template downloaded', 'success', template.fileName);
        break;
      }
      case 'upload-excel': {
        if (!state.excelFile) {
          state.errors.excel = 'Choose a completed .xlsx workbook first.';
          render();
          toast('No Excel file selected', 'error', state.errors.excel);
          break;
        }
        const bytes = await readFileBytes(state.excelFile);
        const preview = previewSerialsWorkbook(bytes, state.session);
        state.excelPreview = preview;
        state.excelReport = null;
        delete state.errors.excel;
        render();
        toast('Excel preview ready', 'success', `${preview.validCount} ready, ${preview.invalidCount} need attention.`);
        break;
      }
      case 'confirm-excel-import': {
        if (!state.excelPreview) throw new Error('Preview an Excel workbook before importing.');
        const result = importSerialRows(state.excelPreview.rows, state.session);
        state.excelReport = result;
        state.excelPreview = null;
        state.excelFile = null;
        state.excelFileName = '';
        render();
        toast('Excel import complete', result.successful ? 'success' : 'error', `${result.successful} successful, ${result.unsuccessful} unsuccessful.`);
        break;
      }
      case 'cancel-excel-import': {
        state.excelPreview = null;
        state.excelFile = null;
        state.excelFileName = '';
        delete state.errors.excel;
        render();
        toast('Excel import cancelled', 'info');
        break;
      }
      case 'open-password-change': {
        if (!state.session || state.session.role === 'admin') {
          toast('Access denied', 'error', 'Only students and teachers can change their own password here.');
          break;
        }
        state.passwordChangeOpen = true;
        state.passwordForm = blankPasswordForm();
        clearActionErrors();
        render();
        toast('Change password opened', 'info');
        break;
      }
      case 'cancel-password-change': {
        state.passwordChangeOpen = false;
        state.passwordForm = blankPasswordForm();
        clearActionErrors();
        render();
        toast('Password change cancelled', 'info');
        break;
      }
      case 'assign-serial': {
        const row = button.closest('tr');
        const select = row.querySelector('[data-serial-select]');
        const result = assignSerial({ code: button.dataset.code, accountId: select.value }, state.session);
        if (!result.ok) {
          state.errors.serialAssign = Object.values(result.errors).join(' ');
          render();
          toast('Serial not assigned', 'error', state.errors.serialAssign);
        } else {
          delete state.errors.serialAssign;
          render();
          toast('Serial assigned', 'success', `${result.code} → ${result.account.loginId}`);
        }
        break;
      }
      case 'export-serials': {
        downloadText('steamlab-serials.csv', exportSerialsCsv(db, state.session), 'text/csv;charset=utf-8');
        toast('Serial CSV exported', 'success');
        break;
      }
      case 'export-report-csv': {
        downloadText('steamlab-report.csv', exportReportCsv(db), 'text/csv;charset=utf-8');
        toast('Report CSV exported', 'success');
        break;
      }
      case 'reset-settings': {
        const result = resetSettings(state.session);
        state.settingsForm = makeSettingsForm(result.settings);
        clearActionErrors();
        render();
        toast('Settings reset to defaults', 'success', 'Schedule was recalculated.');
        break;
      }
      case 'export-backup': {
        const backup = await exportBackup(state.session);
        downloadText('steamlab-backup.json', JSON.stringify(backup, null, 2), 'application/json;charset=utf-8');
        toast('JSON backup exported', 'success', `${backup.files.length} uploaded files included`);
        break;
      }
      case 'export-requests-csv': {
        downloadText('steamlab-requests.csv', exportRequestsCsv(db), 'text/csv;charset=utf-8');
        toast('Requests CSV exported', 'success');
        break;
      }
      case 'import-backup': {
        if (!state.backupFile) {
          state.errors.backup = 'Choose a JSON backup file first.';
          render();
          toast('No backup selected', 'error', state.errors.backup);
          break;
        }
        try {
          const bytes = await readFileBytes(state.backupFile);
          const payload = parseBackupText(decodeBackupBytes(bytes));
          const result = await importBackup(payload, state.session);
          state.backupFile = null;
          state.backupFileName = '';
          state.session = null;
          state.view = 'login';
          state.loginRole = 'admin';
          state.loginForm = blankLogin();
          state.settingsForm = makeSettingsForm(getDb().settings);
          state.success.backup = `Imported ${result.requests} requests, ${result.accounts} accounts, and ${result.files} files. Sign in again.`;
          clearActionErrors();
          state.success.backup = `Imported ${result.requests} requests, ${result.accounts} accounts, and ${result.files} files. Sign in again.`;
          render();
          toast('Backup imported', 'success', state.success.backup);
        } catch (error) {
          state.errors.backup = error.message || 'Backup validation failed.';
          render();
          toast('Backup rejected', 'error', state.errors.backup);
        }
        break;
      }
      case 'reset-factory': {
        state.confirm = { type: 'reset', title: 'Reset all app data?', label: 'All student and teacher accounts, serials, settings, requests, and uploaded files will be cleared. Only the two permanent administrator accounts will remain.' };
        render();
        toast('Confirm factory reset', 'info', 'Use the confirmation bar above.');
        break;
      }
      case 'rerun-selftest': {
        render();
        toast('Self-test re-run', 'info');
        break;
      }
      case 'leave-selftest': {
        location.hash = '';
        if (!bootstrapped) bootSafely();
        else render();
        toast('Returned to app', 'info');
        break;
      }
      case 'reset-fatal': {
        stateRemove(DB_KEY);
        try { await clearFiles(); } catch (_) { /* Reset can continue with the DB key removed. */ }
        try {
          location.reload();
        } catch (_) {
          const result = document.querySelector('.fatal-reset-result');
          if (result) result.textContent = 'App data was cleared. Reload this page to start from factory accounts.';
        }
        toast('App data reset', 'success', 'Reloading with factory accounts.');
        break;
      }
      default:
        toast('Unknown action', 'error', action);
    }
  } catch (error) {
    state.errors.general = error && error.message ? error.message : String(error);
    if (!fatalError) render();
    toast('Action failed', 'error', state.errors.general);
  }
}

function getDbSafe() {
  try { return getDb(); } catch (_) { return null; }
}

function handleOperationResult(result, successTitle, errorTitle, detail = '') {
  if (!result || !result.ok) {
    const message = result ? Object.values(result.errors || {}).join(' ') : 'That operation is no longer available.';
    state.errors.general = message;
    render();
    toast(errorTitle, 'error', message);
  } else {
    delete state.errors.general;
    render();
    toast(successTitle, 'success', detail || scheduleText(result.request));
  }
}

async function handleConfirmYes() {
  const confirmation = state.confirm;
  if (!confirmation) return;
  const db = getDb();
  if (confirmation.type === 'cancel') {
    const result = cancelRequest(db, confirmation.id, state.session, 'Cancelled before printing.');
    state.confirm = null;
    handleOperationResult(result, 'Request cancelled', 'Request could not be cancelled', 'Reserved time was released and the scheduler re-ran.');
  } else if (confirmation.type === 'delete-serial') {
    const result = deleteSerialEntry(confirmation.id, state.session);
    state.confirm = null;
    if (!result.ok) {
      state.errors.general = Object.values(result.errors).join(' ');
      render();
      toast('Serial not deleted', 'error', state.errors.general);
    } else {
      if (state.serialEditId === confirmation.id) {
        state.serialFormOpen = false;
        state.serialEditId = null;
        state.serialForm = makeSerialForm(state.serialMode);
      }
      render();
      toast('Serial record deleted', 'success', 'The linked login account was removed. Existing requests were preserved.');
    }
  } else if (confirmation.type === 'reset') {
    await resetFactoryData(state.session);
    state.session = null;
    state.view = 'login';
    state.loginRole = 'admin';
    state.loginForm = blankLogin();
    state.confirm = null;
    state.draft = makeDraft();
    state.lastSubmission = null;
    state.passwordChangeOpen = false;
    state.passwordForm = blankPasswordForm();
    resetSerialWorkspace('student');
    state.settingsForm = makeSettingsForm(getDb().settings);
    clearActionErrors();
    render();
    toast('Factory accounts restored', 'success', 'Only the two permanent administrator accounts remain.');
  }
}

async function handleSubmit(event) {
  const form = event.target.closest('form[data-form]');
  if (!form) return;
  event.preventDefault();
  try {
    const kind = form.dataset.form;
    if (kind === 'login') {
      const data = new FormData(form);
      state.loginForm = {
        loginId: String(data.get('loginId') || ''),
        password: String(data.get('password') || '')
      };
      const result = login({ role: form.dataset.role, ...state.loginForm });
      if (!result.ok) {
        state.errors = result.errors;
        render();
        toast('Sign-in needs attention', 'error', 'Check the highlighted fields.');
      } else {
        state.session = result.account;
        state.view = defaultView(result.account.role);
        state.loginRole = null;
        state.passwordChangeOpen = false;
        state.passwordForm = blankPasswordForm();
        clearActionErrors();
        render();
        toast(`Welcome, ${result.account.name}`, 'success', `${result.account.role} workspace opened`);
      }
    } else if (kind === 'upload') {
      readDraftForm(form);
      const result = await submitRequest({ ...state.draft.form, file: state.draft.file }, state.session);
      if (!result.ok) {
        state.errors = result.errors;
        render();
        toast('Request needs attention', 'error', Object.values(result.errors)[0] || 'Check the form.');
      } else {
        state.lastSubmission = { view: state.view, request: JSON.parse(JSON.stringify(result.request)) };
        state.draft = makeDraft();
        clearActionErrors();
        render();
        toast('Request submitted', 'success', `${result.request.code} saved with its uploaded file.`);
      }
    } else if (kind === 'serial-record') {
      const payload = readSerialForm(form);
      const wasEditing = Boolean(state.serialEditId);
      const result = wasEditing
        ? updateSerialEntry(state.serialEditId, payload, state.serialMode, state.session)
        : createSerialEntry(payload, state.serialMode, state.session);
      if (!result.ok) {
        state.errors = result.errors;
        render();
        toast('Serial record needs attention', 'error', Object.values(result.errors)[0] || 'Check the form.');
      } else {
        state.serialFormOpen = false;
        state.serialEditId = null;
        state.serialForm = makeSerialForm(state.serialMode);
        clearActionErrors();
        render();
        toast(wasEditing ? 'Serial record updated' : 'Serial record created', 'success', `${result.account.loginId} saved and linked.`);
      }
    } else if (kind === 'bulk-serials') {
      const rows = readBulkRows(form);
      const result = bulkCreateSerialRows(rows, state.serialMode, state.session);
      state.bulkReport = result;
      if (result.successful) state.bulkSerialRows = makeBulkSerialRows(state.serialMode, 2);
      clearActionErrors();
      render();
      toast('Bulk generation complete', result.successful ? 'success' : 'error', `${result.successful} successful, ${result.unsuccessful} unsuccessful.`);
    } else if (kind === 'change-password') {
      const payload = readPasswordForm(form);
      const result = changeOwnPassword(payload, state.session);
      if (!result.ok) {
        state.errors = result.errors;
        render();
        toast('Password change needs attention', 'error', Object.values(result.errors)[0] || 'Check the form.');
      } else {
        state.passwordChangeOpen = false;
        state.passwordForm = blankPasswordForm();
        clearActionErrors();
        render();
        toast('Password changed', 'success', 'Use the new password for future sign-ins.');
      }
    } else if (kind === 'settings') {
      readSettingsForm(form);
      const result = updateSettings(settingsPayload(), state.session);
      if (!result.ok) {
        state.errors = result.errors;
        render();
        toast('Settings need attention', 'error', Object.values(result.errors)[0] || 'Check the form.');
      } else {
        state.settingsForm = makeSettingsForm(result.settings);
        clearActionErrors();
        render();
        toast('Lab settings saved', 'success', 'Approved reservations were recalculated.');
      }
    }
  } catch (error) {
    state.errors.general = error && error.message ? error.message : String(error);
    if (!fatalError) render();
    toast('Form submission failed', 'error', state.errors.general);
  }
}

function handleInput(event) {
  const target = event.target;
  if (target.matches('[data-draft-field]')) {
    if (target.name) state.draft.form[target.name] = target.value;
  }
  if (target.id === 'search-input') {
    state.filters.search = target.value;
    refreshTableOnly();
  }
  const loginForm = target.closest('form[data-form="login"]');
  if (loginForm) {
    const data = new FormData(loginForm);
    state.loginForm = {
      loginId: String(data.get('loginId') || ''),
      password: String(data.get('password') || '')
    };
  }
  const serialForm = target.closest('form[data-form="serial-record"]');
  if (serialForm) readSerialForm(serialForm);
  const bulkForm = target.closest('form[data-form="bulk-serials"]');
  if (bulkForm) readBulkRows(bulkForm);
  const passwordForm = target.closest('form[data-form="change-password"]');
  if (passwordForm) readPasswordForm(passwordForm);
  const settingsForm = target.closest('form[data-form="settings"]');
  if (settingsForm) readSettingsForm(settingsForm);
}

async function handleChange(event) {
  const target = event.target;
  if (target.matches('[data-field="upload-file"]')) {
    const file = target.files && target.files[0] ? target.files[0] : null;
    state.draft.file = file;
    state.draft.fileName = file ? file.name : '';
    state.draft.bytes = null;
    state.draft.estimate = null;
    await refreshDraftEstimate();
    return;
  }
  if (target.matches('[data-field="backup-file"]')) {
    const file = target.files && target.files[0] ? target.files[0] : null;
    state.backupFile = file;
    state.backupFileName = file ? file.name : '';
    delete state.errors.backup;
    render();
    toast(file ? 'Backup file selected' : 'Backup selection cleared', 'info', file ? file.name : '');
    return;
  }
  if (target.matches('[data-field="excel-file"]')) {
    const file = target.files && target.files[0] ? target.files[0] : null;
    state.excelFile = file;
    state.excelFileName = file ? file.name : '';
    state.excelPreview = null;
    state.excelReport = null;
    delete state.errors.excel;
    render();
    toast(file ? 'Excel file selected' : 'Excel selection cleared', 'info', file ? file.name : '');
    return;
  }
  if (target.matches('[data-filter]')) {
    state.filters[target.dataset.filter] = target.value;
    refreshTableOnly();
    toast('Filters updated', 'info');
    return;
  }
  if (target.matches('[data-draft-field]') && ['infill', 'copies'].includes(target.name)) {
    await refreshDraftEstimate();
    return;
  }
  const serialForm = target.closest('form[data-form="serial-record"]');
  if (serialForm) {
    readSerialForm(serialForm);
    return;
  }
  const bulkForm = target.closest('form[data-form="bulk-serials"]');
  if (bulkForm) {
    readBulkRows(bulkForm);
    return;
  }
  const passwordForm = target.closest('form[data-form="change-password"]');
  if (passwordForm) {
    readPasswordForm(passwordForm);
    return;
  }
  const settingsForm = target.closest('form[data-form="settings"]');
  if (settingsForm) {
    readSettingsForm(settingsForm);
    return;
  }
}

function bootSafely() {
  try {
    if (isSelfTestRoute()) {
      render();
      return;
    }
    const db = bootstrap();
    state.session = getSessionAccount();
    state.settingsForm = makeSettingsForm(db.settings);
    state.view = state.session ? defaultView(state.session.role) : 'landing';
    bootstrapped = true;
    render();
    const noticeBefore = getStorageNotice();
    ensureSeedFiles().then(() => {
      if (!fatalError && getStorageNotice() !== noticeBefore) render();
    }).catch((error) => {
      if (!fatalError) {
        toast('File storage fallback active', 'info', error && error.message ? error.message : 'Seed files remain downloadable.');
        render();
      }
    });
  } catch (error) {
    renderFatal(error);
  }
}

window.addEventListener('error', (event) => {
  if (!fatalError) renderFatal(event.error || new Error(event.message || 'Unexpected browser error'));
});
window.addEventListener('unhandledrejection', (event) => {
  if (!fatalError) renderFatal(event.reason instanceof Error ? event.reason : new Error(String(event.reason)));
});
window.addEventListener('hashchange', () => {
  if (isSelfTestRoute()) render();
  else if (!bootstrapped) bootSafely();
  else render();
});
document.addEventListener('click', (event) => {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  handleAction(button.dataset.action, button, event);
});
document.addEventListener('submit', handleSubmit);
document.addEventListener('input', handleInput);
document.addEventListener('change', (event) => {
  handleChange(event).catch((error) => {
    if (!fatalError) renderFatal(error instanceof Error ? error : new Error(String(error)));
  });
});

bootSafely();
