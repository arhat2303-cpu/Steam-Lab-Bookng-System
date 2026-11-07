export const MODEL_EXTENSIONS = [
  'stl', 'obj', '3mf', 'gcode', 'gco', 'g', 'step', 'stp', 'iges', 'igs', 'zip', 'ply', 'amf'
];
export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'svg', 'tif', 'tiff', 'heic'];
export const GCODE_EXTENSIONS = ['gcode', 'gco', 'g'];

const DEFAULT_BUILD_VOLUME = { x: 220, y: 220, z: 250 };
const FLOW_RATE_MM3_PER_MIN = 1800;
const SHELL_THICKNESS_MM = 0.8;
const SETUP_MINUTES = 4;
const TRAVEL_FACTOR = 1.08;

export function getExtension(name) {
  const match = /\.([a-z0-9]+)$/i.exec(String(name || '').trim());
  return match ? match[1].toLowerCase() : '';
}

export function isSupportedUpload(name) {
  const extension = getExtension(name);
  return MODEL_EXTENSIONS.includes(extension) || IMAGE_EXTENSIONS.includes(extension);
}

function toBytes(input) {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  if (typeof input === 'string') {
    const bytes = new Uint8Array(input.length);
    for (let i = 0; i < input.length; i += 1) bytes[i] = input.charCodeAt(i) & 255;
    return bytes;
  }
  if (Array.isArray(input)) return new Uint8Array(input);
  return new Uint8Array(0);
}

function decodeLatin1(bytes, limit = bytes.length) {
  const length = Math.min(bytes.length, limit);
  let out = '';
  for (let offset = 0; offset < length; offset += 32768) {
    const chunk = bytes.subarray(offset, Math.min(length, offset + 32768));
    out += String.fromCharCode.apply(null, chunk);
  }
  return out;
}

function asciiSample(bytes, maxBytes = 8000000) {
  if (bytes.length <= maxBytes) return decodeLatin1(bytes);
  const first = Math.floor(maxBytes * 0.7);
  const last = maxBytes - first;
  return `${decodeLatin1(bytes.subarray(0, first))}\n${decodeLatin1(bytes.subarray(Math.max(first, bytes.length - last)))}`;
}

function clamp(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function findDurationSeconds(text) {
  let seconds = 0;
  let found = false;
  const colon = /(\d{1,2}):(\d{2}):(\d{2})(?:\.\d+)?/.exec(text);
  if (colon) {
    seconds = Number(colon[1]) * 3600 + Number(colon[2]) * 60 + Number(colon[3]);
    found = true;
  }
  const unitPattern = /(\d+(?:\.\d+)?)\s*(d|day|days|h|hr|hrs|hour|hours|m|min|mins|minute|minutes|s|sec|secs|second|seconds)\b/gi;
  let match;
  let unitSeconds = 0;
  while ((match = unitPattern.exec(text)) !== null) {
    const amount = Number(match[1]);
    const unit = match[2].toLowerCase();
    if (unit.startsWith('d')) unitSeconds += amount * 86400;
    else if (unit.startsWith('h')) unitSeconds += amount * 3600;
    else if (unit.startsWith('m')) unitSeconds += amount * 60;
    else unitSeconds += amount;
    found = true;
  }
  if (unitSeconds) seconds = unitSeconds;
  if (!found) {
    const bare = /(\d+(?:\.\d+)?)/.exec(text);
    if (bare) { seconds = Number(bare[1]); found = true; }
  }
  return found && Number.isFinite(seconds) && seconds > 0 ? seconds : null;
}

export function parseGcodeTime(text) {
  const source = String(text || '');
  const timeMatches = [...source.matchAll(/;\s*TIME\s*:\s*(\d+(?:\.\d+)?)/gi)];
  if (timeMatches.length) {
    const value = Number(timeMatches[timeMatches.length - 1][1]);
    if (Number.isFinite(value) && value > 0) {
      return { seconds: value, method: 'gcode-time', label: 'Slicer ;TIME: total seconds', source: timeMatches[timeMatches.length - 1][0] };
    }
  }
  const estimateLines = source.split(/\r?\n/).filter((line) => /estimated printing time/i.test(line));
  const preferred = estimateLines.find((line) => /normal mode/i.test(line)) || estimateLines[0];
  if (preferred) {
    const separator = Math.max(preferred.lastIndexOf('='), preferred.lastIndexOf(':'));
    const tail = separator >= 0 ? preferred.slice(separator + 1) : preferred;
    const seconds = findDurationSeconds(tail);
    if (seconds) return { seconds, method: 'gcode-estimate-line', label: 'Slicer “estimated printing time” line', source: preferred.trim().slice(0, 180) };
  }
  const rValues = [...source.matchAll(/\bM73\b[^\r\n]*?\bR(\d+(?:\.\d+)?)/gi)].map((match) => Number(match[1])).filter((value) => value > 0);
  if (rValues.length) {
    const minutes = Math.max(...rValues);
    return { seconds: minutes * 60, method: 'gcode-m73', label: 'Slicer M73 R remaining minutes', source: `M73 R${minutes}` };
  }
  return null;
}

function readTrianglesFromBinary(bytes) {
  if (bytes.length < 84) return [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint32(80, true);
  if (!count || count > 2000000) return [];
  const expected = 84 + count * 50;
  if (expected > bytes.length) return [];
  const triangles = [];
  for (let i = 0; i < count; i += 1) {
    const base = 84 + i * 50 + 12;
    const triangle = [];
    for (let vertex = 0; vertex < 3; vertex += 1) {
      const offset = base + vertex * 12;
      triangle.push([
        view.getFloat32(offset, true),
        view.getFloat32(offset + 4, true),
        view.getFloat32(offset + 8, true)
      ]);
    }
    triangles.push(triangle);
  }
  return triangles;
}

function readTrianglesFromAscii(text) {
  const triangles = [];
  let pending = [];
  const number = '[-+]?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][-+]?\\d+)?';
  const pattern = new RegExp(`\\bvertex\\s+(${number})\\s+(${number})\\s+(${number})`, 'gi');
  let match;
  while ((match = pattern.exec(text)) !== null && triangles.length < 1000000) {
    pending.push([Number(match[1]), Number(match[2]), Number(match[3])]);
    if (pending.length === 3) {
      triangles.push(pending);
      pending = [];
    }
  }
  return triangles;
}

function subtract(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function length(vector) {
  return Math.sqrt(dot(vector, vector));
}

export function meshMetrics(triangles) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  let signedVolume = 0;
  let surfaceArea = 0;
  for (const triangle of triangles) {
    const [a, b, c] = triangle;
    signedVolume += dot(a, cross(b, c)) / 6;
    surfaceArea += length(cross(subtract(b, a), subtract(c, a))) / 2;
    for (const vertex of triangle) {
      for (let axis = 0; axis < 3; axis += 1) {
        if (Number.isFinite(vertex[axis])) {
          min[axis] = Math.min(min[axis], vertex[axis]);
          max[axis] = Math.max(max[axis], vertex[axis]);
        }
      }
    }
  }
  const finiteMin = min.map((value) => (Number.isFinite(value) ? value : 0));
  const finiteMax = max.map((value) => (Number.isFinite(value) ? value : 0));
  return {
    triangles: triangles.length,
    volumeMm3: Math.abs(signedVolume),
    surfaceAreaMm2: surfaceArea,
    min: { x: finiteMin[0], y: finiteMin[1], z: finiteMin[2] },
    max: { x: finiteMax[0], y: finiteMax[1], z: finiteMax[2] },
    bbox: {
      x: Math.max(0, finiteMax[0] - finiteMin[0]),
      y: Math.max(0, finiteMax[1] - finiteMin[1]),
      z: Math.max(0, finiteMax[2] - finiteMin[2])
    }
  };
}

function buildVolumeWarning(bbox, buildVolume) {
  const limits = {
    x: clamp(buildVolume && buildVolume.x, 1, 2000, DEFAULT_BUILD_VOLUME.x),
    y: clamp(buildVolume && buildVolume.y, 1, 2000, DEFAULT_BUILD_VOLUME.y),
    z: clamp(buildVolume && buildVolume.z, 1, 2000, DEFAULT_BUILD_VOLUME.z)
  };
  const overflow = ['x', 'y', 'z'].filter((axis) => bbox[axis] > limits[axis]);
  if (!overflow.length) return null;
  return `Model bounding box ${bbox.x.toFixed(1)} × ${bbox.y.toFixed(1)} × ${bbox.z.toFixed(1)} mm exceeds the configured ${limits.x} × ${limits.y} × ${limits.z} mm build volume (${overflow.map((axis) => axis.toUpperCase()).join(', ')}).`;
}

function fileSizeEstimate(size, extension, note) {
  const sizeMB = Math.max(0, Number(size) || 0) / (1024 * 1024);
  const perCopyMinutes = Math.max(5, Math.ceil(10 + sizeMB * 6));
  return {
    method: 'file-size-estimate',
    label: note || `File-size estimate for .${extension || 'file'} — upload G-code or STL for a calculated value`,
    confidence: 'low',
    formula: '10 min setup + 6 min per MB, rounded up; multiplied by copies',
    details: { sizeMB: Number(sizeMB.toFixed(3)), setupMinutes: 10, minutesPerMB: 6 },
    perCopyMinutes,
    warning: null
  };
}

function estimateGcode(bytes, size, extension, copies) {
  const parsed = parseGcodeTime(asciiSample(bytes, 5000000));
  if (!parsed) {
    const fallback = fileSizeEstimate(size, extension, 'File-size estimate — G-code did not contain a slicer time value');
    return { ...fallback, warning: 'G-code had no ;TIME:, “estimated printing time”, or M73 R value; using a labelled file-size estimate.' };
  }
  const perCopyMinutes = Math.max(1, Math.ceil(parsed.seconds / 60));
  return {
    method: parsed.method,
    label: parsed.label,
    confidence: 'high',
    formula: 'Slicer-reported seconds ÷ 60, rounded up; multiplied by copies',
    details: { gcodeSeconds: Number(parsed.seconds.toFixed(2)), sourceLine: parsed.source },
    perCopyMinutes,
    warning: null
  };
}

function estimateStl(bytes, size, infill, copies, buildVolume) {
  let triangles = readTrianglesFromBinary(bytes);
  let meshSource = 'binary STL mesh';
  if (!triangles.length) {
    const text = asciiSample(bytes, 16000000);
    if (/^\s*solid/i.test(text) && /\bvertex\b/i.test(text)) {
      triangles = readTrianglesFromAscii(text);
      meshSource = 'ASCII STL mesh';
    }
  }
  if (!triangles.length) {
    const fallback = fileSizeEstimate(size, 'stl', 'File-size estimate — STL mesh could not be parsed');
    return { ...fallback, warning: 'The STL mesh could not be parsed; using a labelled file-size estimate.' };
  }
  const metrics = meshMetrics(triangles);
  const infillVolumeMm3 = metrics.volumeMm3 * (infill / 100);
  const shellVolumeMm3 = metrics.surfaceAreaMm2 * SHELL_THICKNESS_MM;
  const extrusionMinutes = (infillVolumeMm3 + shellVolumeMm3) / FLOW_RATE_MM3_PER_MIN;
  const perCopyMinutes = Math.max(5, Math.ceil(extrusionMinutes * TRAVEL_FACTOR + SETUP_MINUTES));
  const volumeWarning = buildVolumeWarning(metrics.bbox, buildVolume);
  const warnings = [];
  if (volumeWarning) warnings.push(volumeWarning);
  if (metrics.volumeMm3 < 1) warnings.push('Mesh volume is near zero; check that the STL is a closed, outward-facing solid.');
  return {
    method: 'stl-mesh',
    label: `Calculated from ${meshSource} (${metrics.triangles.toLocaleString ? metrics.triangles.toLocaleString() : metrics.triangles} triangles)`,
    confidence: 'high',
    formula: '(volume × infill ÷ 1,800 mm³/min) + (surface area × 0.8 mm shell) + 4 min setup, × 1.08 travel factor; multiplied by copies',
    details: {
      ...metrics,
      infillVolumeMm3,
      shellVolumeMm3,
      flowRateMm3PerMin: FLOW_RATE_MM3_PER_MIN,
      shellThicknessMm: SHELL_THICKNESS_MM,
      setupMinutes: SETUP_MINUTES,
      travelFactor: TRAVEL_FACTOR,
      extrusionMinutes
    },
    perCopyMinutes,
    warning: warnings.join(' ') || null
  };
}

/**
 * Pure estimator. It accepts already-read bytes and returns a plain object.
 * It has no DOM, storage, network, or clock access.
 */
export function estimateFromFile(input = {}) {
  const name = String(input.name || 'upload.bin');
  const extension = getExtension(name);
  const bytes = toBytes(input.bytes);
  const size = Math.max(0, Number(input.size) || bytes.length);
  const infill = clamp(input.infill, 0, 100, 20);
  const copies = Math.max(1, Math.floor(clamp(input.copies, 1, 99, 1)));
  const buildVolume = input.buildVolume && typeof input.buildVolume === 'object' ? input.buildVolume : DEFAULT_BUILD_VOLUME;
  let result;
  if (GCODE_EXTENSIONS.includes(extension)) result = estimateGcode(bytes, size, extension, copies);
  else if (extension === 'stl') result = estimateStl(bytes, size, infill, copies, buildVolume);
  else result = fileSizeEstimate(size, extension);
  const perCopyMinutes = Math.max(1, Math.ceil(Number(result.perCopyMinutes) || 1));
  return {
    ...result,
    fileName: name,
    fileSize: size,
    extension,
    infill,
    copies,
    buildVolume: {
      x: clamp(buildVolume.x, 1, 2000, DEFAULT_BUILD_VOLUME.x),
      y: clamp(buildVolume.y, 1, 2000, DEFAULT_BUILD_VOLUME.y),
      z: clamp(buildVolume.z, 1, 2000, DEFAULT_BUILD_VOLUME.z)
    },
    minutes: perCopyMinutes,
    perCopyMinutes,
    totalMinutes: perCopyMinutes * copies,
    generatedAt: Number.isFinite(Number(input.now)) ? Number(input.now) : 0
  };
}
