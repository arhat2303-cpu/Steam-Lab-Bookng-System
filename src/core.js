export const DB_KEY = 'steamlab_db_v1';
export const FILE_DB_NAME = 'steamlab_files_v1';
export const FILE_STORE_NAME = 'files';

const memoryState = new Map();
const memoryFiles = new Map();
let stateStore;
let stateStoreChecked = false;
let fileDbPromise = null;

export const storageStatus = {
  state: 'unknown',
  files: 'unknown',
  stateDetail: '',
  fileDetail: ''
};

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEEKDAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const SHA256_K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
];

export function encodeUtf8Bytes(text) {
  const str = String(text ?? '');
  const bytes = [];
  for (let i = 0; i < str.length; i += 1) {
    let code = str.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < str.length) {
      const low = str.charCodeAt(i + 1);
      if (low >= 0xdc00 && low <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + (low - 0xdc00);
        i += 1;
      }
    }
    if (code < 0x80) bytes.push(code);
    else if (code < 0x800) bytes.push(0xc0 | (code >> 6), 0x80 | (code & 63));
    else if (code < 0x10000) bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
    else bytes.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 63), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
  }
  return new Uint8Array(bytes);
}

export function utf8ToString(input) {
  const bytes = toBytes(input);
  try {
    if (typeof TextDecoder !== 'undefined') return new TextDecoder('utf-8').decode(bytes);
  } catch (_) {
    // Fall through to the pure-JavaScript decoder.
  }
  let out = '';
  let i = 0;
  while (i < bytes.length) {
    const byte = bytes[i];
    let code;
    let width = 1;
    if (byte < 0x80) code = byte;
    else if ((byte & 0xe0) === 0xc0) { code = byte & 0x1f; width = 2; }
    else if ((byte & 0xf0) === 0xe0) { code = byte & 0x0f; width = 3; }
    else if ((byte & 0xf8) === 0xf0) { code = byte & 0x07; width = 4; }
    else { out += String.fromCharCode(byte); i += 1; continue; }
    for (let j = 1; j < width && i + j < bytes.length; j += 1) code = (code << 6) | (bytes[i + j] & 63);
    if (code > 0xffff) {
      code -= 0x10000;
      out += String.fromCharCode(0xd800 + (code >> 10), 0xdc00 + (code & 1023));
    } else out += String.fromCharCode(code);
    i += width;
  }
  return out;
}

export function decodeLatin1(input) {
  const bytes = toBytes(input);
  let out = '';
  for (let offset = 0; offset < bytes.length; offset += 32768) {
    const chunk = bytes.subarray(offset, Math.min(bytes.length, offset + 32768));
    out += String.fromCharCode.apply(null, chunk);
  }
  return out;
}

export function toBytes(input) {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  if (typeof input === 'string') return encodeUtf8Bytes(input);
  if (Array.isArray(input)) return new Uint8Array(input);
  return new Uint8Array(0);
}

function rotr(value, shift) {
  return (value >>> shift) | (value << (32 - shift));
}

export function sha256Hex(message) {
  const bytes = Array.from(encodeUtf8Bytes(message));
  const bitLength = bytes.length * 8;
  const highBits = Math.floor(bitLength / 0x100000000);
  const lowBits = bitLength >>> 0;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  bytes.push((highBits >>> 24) & 255, (highBits >>> 16) & 255, (highBits >>> 8) & 255, highBits & 255);
  bytes.push((lowBits >>> 24) & 255, (lowBits >>> 16) & 255, (lowBits >>> 8) & 255, lowBits & 255);

  const H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const words = new Array(64);
  for (let offset = 0; offset < bytes.length; offset += 64) {
    for (let i = 0; i < 16; i += 1) {
      const p = offset + i * 4;
      words[i] = (((bytes[p] << 24) | (bytes[p + 1] << 16) | (bytes[p + 2] << 8) | bytes[p + 3]) >>> 0);
    }
    for (let i = 16; i < 64; i += 1) {
      const s0 = rotr(words[i - 15], 7) ^ rotr(words[i - 15], 18) ^ (words[i - 15] >>> 3);
      const s1 = rotr(words[i - 2], 17) ^ rotr(words[i - 2], 19) ^ (words[i - 2] >>> 10);
      words[i] = (words[i - 16] + s0 + words[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i += 1) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + SHA256_K[i] + words[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + temp1) >>> 0;
      d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
    }
    H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0;
    H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0;
    H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
  }
  return H.map((value) => value.toString(16).padStart(8, '0')).join('');
}

export function makeSalt() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

export function hashPassword(password, salt) {
  return sha256Hex(`steamlab.v1|${salt}|${String(password ?? '')}|${salt}`);
}

export function verifyPassword(password, salt, expectedHash) {
  if (!salt || !expectedHash) return false;
  const actual = hashPassword(password, salt);
  if (actual.length !== expectedHash.length) return false;
  let difference = 0;
  for (let i = 0; i < actual.length; i += 1) difference |= actual.charCodeAt(i) ^ expectedHash.charCodeAt(i);
  return difference === 0;
}

function safeStorage() {
  if (stateStoreChecked) return stateStore;
  stateStoreChecked = true;
  try {
    const candidate = globalThis.localStorage;
    if (!candidate) throw new Error('localStorage is not available');
    const probeKey = '__steamlab_storage_probe__';
    candidate.setItem(probeKey, '1');
    candidate.removeItem(probeKey);
    stateStore = candidate;
    storageStatus.state = 'localStorage';
    return stateStore;
  } catch (error) {
    stateStore = null;
    storageStatus.state = 'memory';
    storageStatus.stateDetail = error && error.message ? error.message : String(error);
    return null;
  }
}

export function stateGet(storage) {
  const isReal = storage === undefined;
  const target = isReal ? safeStorage() : storage;
  try {
    if (!target || typeof target.getItem !== 'function') {
      return isReal && memoryState.has(DB_KEY) ? memoryState.get(DB_KEY) : null;
    }
    return target.getItem(DB_KEY);
  } catch (error) {
    if (isReal) {
      storageStatus.state = 'memory';
      storageStatus.stateDetail = error && error.message ? error.message : String(error);
      return memoryState.has(DB_KEY) ? memoryState.get(DB_KEY) : null;
    }
    return null;
  }
}

export function stateSet(value, storage) {
  const isReal = storage === undefined;
  const target = isReal ? safeStorage() : storage;
  const text = String(value);
  try {
    if (!target || typeof target.setItem !== 'function') throw new Error('Storage target is unavailable');
    target.setItem(DB_KEY, text);
    if (isReal) {
      storageStatus.state = 'localStorage';
      memoryState.set(DB_KEY, text);
    }
    return true;
  } catch (error) {
    if (isReal) {
      memoryState.set(DB_KEY, text);
      storageStatus.state = 'memory';
      storageStatus.stateDetail = error && error.message ? error.message : String(error);
    }
    return false;
  }
}

export function stateRemove(storage) {
  const isReal = storage === undefined;
  const target = isReal ? safeStorage() : storage;
  if (isReal) memoryState.delete(DB_KEY);
  try {
    if (target && typeof target.removeItem === 'function') target.removeItem(DB_KEY);
    return true;
  } catch (error) {
    if (isReal) {
      storageStatus.state = 'memory';
      storageStatus.stateDetail = error && error.message ? error.message : String(error);
    }
    return false;
  }
}

export function makeMemoryStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
    clear() { values.clear(); }
  };
}

export function getStorageNotice() {
  const parts = [];
  if (storageStatus.state === 'memory') {
    parts.push('In-memory mode: browser storage is blocked, so database changes will not survive a reload.');
  }
  if (storageStatus.files === 'memory') {
    parts.push('IndexedDB is blocked, so uploaded files are kept in memory only.');
  }
  return parts.join(' ');
}

function openFileDb() {
  if (fileDbPromise) return fileDbPromise;
  fileDbPromise = new Promise((resolve, reject) => {
    try {
      const factory = globalThis.indexedDB;
      if (!factory) throw new Error('IndexedDB is not available');
      const request = factory.open(FILE_DB_NAME, 1);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(FILE_STORE_NAME)) database.createObjectStore(FILE_STORE_NAME, { keyPath: 'key' });
      };
      request.onsuccess = () => {
        storageStatus.files = 'indexeddb';
        resolve(request.result);
      };
      request.onerror = () => reject(request.error || new Error('IndexedDB open failed'));
      request.onblocked = () => reject(new Error('IndexedDB open was blocked'));
    } catch (error) {
      reject(error);
    }
  }).catch((error) => {
    fileDbPromise = null;
    throw error;
  });
  return fileDbPromise;
}

function markFileFallback(error) {
  storageStatus.files = 'memory';
  storageStatus.fileDetail = error && error.message ? error.message : String(error);
}

function idbTransaction(mode, operation) {
  return openFileDb().then((database) => new Promise((resolve, reject) => {
    try {
      const transaction = database.transaction(FILE_STORE_NAME, mode);
      const store = transaction.objectStore(FILE_STORE_NAME);
      const request = operation(store);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('IndexedDB request failed'));
      transaction.onabort = () => reject(transaction.error || new Error('IndexedDB transaction aborted'));
    } catch (error) {
      reject(error);
    }
  }));
}

export async function putFile(key, bytes, meta = {}) {
  const payload = toBytes(bytes);
  const record = {
    key,
    bytes: new Uint8Array(payload),
    mime: meta.mime || 'application/octet-stream',
    name: meta.name || 'download.bin',
    storedAt: Date.now()
  };
  try {
    await idbTransaction('readwrite', (store) => store.put(record));
    memoryFiles.set(key, record);
    storageStatus.files = 'indexeddb';
    return { backend: 'indexeddb', key, name: record.name, size: record.bytes.length, mime: record.mime, storedAt: record.storedAt };
  } catch (error) {
    memoryFiles.set(key, record);
    markFileFallback(error);
    return { backend: 'memory', key, name: record.name, size: record.bytes.length, mime: record.mime, storedAt: record.storedAt };
  }
}

export async function getFile(pointer) {
  if (!pointer || !pointer.key) return null;
  const memoryRecord = memoryFiles.get(pointer.key);
  if (memoryRecord) return { bytes: new Uint8Array(memoryRecord.bytes), mime: memoryRecord.mime, name: memoryRecord.name, backend: 'memory' };
  if (pointer.backend === 'indexeddb' || pointer.backend === 'seed') {
    try {
      const record = await idbTransaction('readonly', (store) => store.get(pointer.key));
      if (record && record.bytes) return { bytes: new Uint8Array(record.bytes), mime: record.mime, name: pointer.name || record.name, backend: 'indexeddb' };
    } catch (error) {
      markFileFallback(error);
    }
  }
  if (pointer.backend === 'seed' || pointer.seedKey) {
    const bytes = seedFileBytes(pointer.seedKey || pointer.key, pointer.name);
    return { bytes, mime: pointer.mime || 'model/stl', name: pointer.name || 'demo-model.stl', backend: 'seed' };
  }
  return null;
}

export async function deleteFile(pointer) {
  if (!pointer || !pointer.key) return false;
  memoryFiles.delete(pointer.key);
  try {
    await idbTransaction('readwrite', (store) => store.delete(pointer.key));
    return true;
  } catch (error) {
    markFileFallback(error);
    return false;
  }
}

export async function clearFiles() {
  memoryFiles.clear();
  try {
    await idbTransaction('readwrite', (store) => store.clear());
    return true;
  } catch (error) {
    markFileFallback(error);
    return false;
  }
}

function makeAsciiStl(size, label) {
  const s = Number(size) || 10;
  const v = [
    [0, 0, 0], [s, 0, 0], [s, s, 0], [0, s, 0],
    [0, 0, s], [s, 0, s], [s, s, s], [0, s, s]
  ];
  const faces = [
    [0, 3, 2], [0, 2, 1], [4, 5, 6], [4, 6, 7],
    [0, 1, 5], [0, 5, 4], [3, 7, 6], [3, 6, 2],
    [0, 4, 7], [0, 7, 3], [1, 2, 6], [1, 6, 5]
  ];
  const fmt = (n) => Number(n).toFixed(4);
  const lines = [`solid ${label || 'steamlab_demo'}`];
  for (const face of faces) {
    lines.push('  facet normal 0 0 0');
    lines.push('    outer loop');
    for (const index of face) lines.push(`      vertex ${fmt(v[index][0])} ${fmt(v[index][1])} ${fmt(v[index][2])}`);
    lines.push('    endloop');
    lines.push('  endfacet');
  }
  lines.push(`endsolid ${label || 'steamlab_demo'}`);
  return lines.join('\n');
}

export function seedFileBytes(key, name = 'demo-model.stl') {
  const size = String(key).includes('bracket') ? 18 : 12;
  return encodeUtf8Bytes(makeAsciiStl(size, String(name).replace(/[^a-z0-9_]/gi, '_').replace(/\.stl$/i, '')));
}

export async function readFileBytes(file) {
  if (!file) throw new Error('No file was selected.');
  try {
    if (typeof file.arrayBuffer === 'function') return new Uint8Array(await file.arrayBuffer());
  } catch (_) {
    // Fall back to FileReader below.
  }
  if (typeof FileReader === 'undefined') throw new Error('This browser cannot read local files.');
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result));
    reader.onerror = () => reject(reader.error || new Error('The file could not be read.'));
    reader.readAsArrayBuffer(file);
  });
}

function btoaSafe(binary) {
  if (typeof btoa !== 'undefined') return btoa(binary);
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let out = '';
  for (let i = 0; i < binary.length; i += 3) {
    const a = binary.charCodeAt(i);
    const b = i + 1 < binary.length ? binary.charCodeAt(i + 1) : 0;
    const c = i + 2 < binary.length ? binary.charCodeAt(i + 2) : 0;
    const value = (a << 16) | (b << 8) | c;
    out += alphabet[(value >> 18) & 63] + alphabet[(value >> 12) & 63];
    out += i + 1 < binary.length ? alphabet[(value >> 6) & 63] : '=';
    out += i + 2 < binary.length ? alphabet[value & 63] : '=';
  }
  return out;
}

function atobSafe(base64) {
  if (typeof atob !== 'undefined') return atob(base64);
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const clean = String(base64).replace(/[^A-Za-z0-9+/=]/g, '');
  let out = '';
  for (let i = 0; i < clean.length; i += 4) {
    const a = alphabet.indexOf(clean[i]);
    const b = alphabet.indexOf(clean[i + 1]);
    const c = alphabet.indexOf(clean[i + 2]);
    const d = alphabet.indexOf(clean[i + 3]);
    const value = ((a < 0 ? 0 : a) << 18) | ((b < 0 ? 0 : b) << 12) | ((c < 0 ? 0 : c) << 6) | (d < 0 ? 0 : d);
    out += String.fromCharCode((value >> 16) & 255);
    if (clean[i + 2] && clean[i + 2] !== '=') out += String.fromCharCode((value >> 8) & 255);
    if (clean[i + 3] && clean[i + 3] !== '=') out += String.fromCharCode(value & 255);
  }
  return out;
}

export function bytesToBase64(input) {
  const bytes = toBytes(input);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoaSafe(binary);
}

export function base64ToBytes(base64) {
  const binary = atobSafe(String(base64 || ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i) & 255;
  return bytes;
}

export function downloadBlob(data, name, mime = 'application/octet-stream') {
  const bytes = typeof data === 'string' ? encodeUtf8Bytes(data) : toBytes(data);
  const safeName = String(name || 'download.bin').replace(/[\r\n]/g, '_');
  let url;
  let revoke = false;
  try {
    if (typeof Blob !== 'undefined' && globalThis.URL && typeof globalThis.URL.createObjectURL === 'function') {
      url = globalThis.URL.createObjectURL(new Blob([bytes], { type: mime }));
      revoke = true;
    } else {
      url = `data:${mime};base64,${bytesToBase64(bytes)}`;
    }
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = safeName;
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    if (revoke) setTimeout(() => globalThis.URL.revokeObjectURL(url), 1000);
    return true;
  } catch (_) {
    const anchor = document.createElement('a');
    anchor.href = `data:${mime};base64,${bytesToBase64(bytes)}`;
    anchor.download = safeName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    return true;
  }
}

export function downloadText(name, text, mime = 'text/plain;charset=utf-8') {
  return downloadBlob(String(text), name, mime);
}

export function parseHHMM(value, fallback = 0) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || ''));
  if (!match) return fallback;
  const hours = Math.min(23, Math.max(0, Number(match[1])));
  const minutes = Math.min(59, Math.max(0, Number(match[2])));
  return hours * 60 + minutes;
}

export function minutesToClock(minutes) {
  const value = Math.max(0, Math.round(Number(minutes) || 0));
  return `${String(Math.floor(value / 60) % 24).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}

export function startOfDay(timestamp) {
  const date = new Date(timestamp);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

export function dayKey(timestamp) {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function formatTime(timestamp) {
  const date = new Date(timestamp);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

export function formatDate(timestamp) {
  const date = new Date(timestamp);
  return `${WEEKDAYS[date.getDay()]} ${String(date.getDate()).padStart(2, '0')} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

export function formatDateTime(timestamp) {
  if (!Number.isFinite(Number(timestamp))) return 'Not scheduled';
  return `${formatDate(timestamp)} ${formatTime(timestamp)}`;
}

export function formatLongWeekday(dayIndex) {
  return WEEKDAYS_LONG[dayIndex] || String(dayIndex);
}

export function formatDuration(minutes) {
  const value = Math.max(0, Math.round(Number(minutes) || 0));
  if (value < 60) return `${value} min`;
  const hours = Math.floor(value / 60);
  const rest = value % 60;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

export function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function csvEscape(value) {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function makeId(prefix = 'id') {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}
