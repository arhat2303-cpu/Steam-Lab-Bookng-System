import { zipSync, unzipSync, strToU8, strFromU8 } from './fflate.js';
import { toBytes } from './core.js';

export const SERIAL_TEMPLATE_FILE = 'steam-lab-serials-template.xlsx';
export const SERIAL_TEMPLATE_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const MAIN_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PACKAGE_REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const CONTENT_NS = 'http://schemas.openxmlformats.org/package/2006/content-types';

const STUDENT_SHEET = 'Student Serials';
const TEACHER_SHEET = 'Teacher Serials';
const STUDENT_HEADERS = ['Full Name', 'Class', 'Serial Number', 'Username', 'Password'];
const TEACHER_HEADERS = ['Full Name', 'Serial Number (if applicable)', 'Username', 'Password'];

function xmlEscape(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function xmlUnescape(value) {
  return String(value ?? '')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
      try { return String.fromCodePoint(parseInt(hex, 16)); } catch (_) { return ''; }
    })
    .replace(/&#(\d+);/g, (_, decimal) => {
      try { return String.fromCodePoint(Number(decimal)); } catch (_) { return ''; }
    })
    .replace(/&amp;/gi, '&');
}

function columnName(index) {
  let value = index + 1;
  let name = '';
  while (value > 0) {
    const remainder = (value - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    value = Math.floor((value - 1) / 26);
  }
  return name;
}

function columnIndex(reference) {
  const match = String(reference || '').match(/^([A-Z]+)/i);
  if (!match) return 0;
  let value = 0;
  for (const char of match[1].toUpperCase()) value = value * 26 + (char.charCodeAt(0) - 64);
  return value - 1;
}

function worksheetXml(headers, widths) {
  const lastColumn = columnName(headers.length - 1);
  const headerCells = headers.map((header, index) => `<c r="${columnName(index)}1" s="1" t="inlineStr"><is><t>${xmlEscape(header)}</t></is></c>`).join('');
  const columns = widths.map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="${MAIN_NS}"><dimension ref="A1:${lastColumn}1"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/><cols>${columns}</cols><sheetData><row r="1" spans="1:${headers.length}">${headerCells}</row></sheetData><autoFilter ref="A1:${lastColumn}1"/><pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/></worksheet>`;
}

function workbookXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="${MAIN_NS}" xmlns:r="${REL_NS}"><sheets><sheet name="${xmlEscape(STUDENT_SHEET)}" sheetId="1" r:id="rId1"/><sheet name="${xmlEscape(TEACHER_SHEET)}" sheetId="2" r:id="rId2"/></sheets></workbook>`;
}

function workbookRelsXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${PACKAGE_REL_NS}"><Relationship Id="rId1" Type="${REL_NS}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${REL_NS}/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="${REL_NS}/styles" Target="styles.xml"/></Relationships>`;
}

function rootRelsXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${PACKAGE_REL_NS}"><Relationship Id="rId1" Type="${REL_NS}/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="${PACKAGE_REL_NS}/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="${REL_NS}/extended-properties" Target="docProps/app.xml"/></Relationships>`;
}

function contentTypesXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="${CONTENT_NS}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`;
}

function stylesXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="${MAIN_NS}"><fonts count="2"><font><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/><scheme val="minor"/></font><font><b/><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/><scheme val="minor"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
}

function coreXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>STEAM Lab serial import template</dc:title><dc:creator>STEAM Lab Booking System</dc:creator><cp:lastModifiedBy>STEAM Lab Booking System</cp:lastModifiedBy></cp:coreProperties>`;
}

function appXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>STEAM Lab Booking System</Application></Properties>`;
}

/** Returns the bytes of a real two-sheet .xlsx workbook with formatted header rows. */
export function buildSerialsTemplate() {
  const files = {
    '[Content_Types].xml': strToU8(contentTypesXml()),
    '_rels/.rels': strToU8(rootRelsXml()),
    'docProps/core.xml': strToU8(coreXml()),
    'docProps/app.xml': strToU8(appXml()),
    'xl/workbook.xml': strToU8(workbookXml()),
    'xl/_rels/workbook.xml.rels': strToU8(workbookRelsXml()),
    'xl/styles.xml': strToU8(stylesXml()),
    'xl/worksheets/sheet1.xml': strToU8(worksheetXml(STUDENT_HEADERS, [28, 18, 22, 24, 22])),
    'xl/worksheets/sheet2.xml': strToU8(worksheetXml(TEACHER_HEADERS, [28, 30, 24, 22]))
  };
  return zipSync(files, { level: 0 });
}

function parseAttrs(tag) {
  const result = {};
  const pattern = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let match;
  while ((match = pattern.exec(tag)) !== null) result[match[1]] = xmlUnescape(match[2] !== undefined ? match[2] : match[3]);
  return result;
}

function attr(tag, name) {
  return parseAttrs(tag)[name] || '';
}

function entryText(entries, name) {
  const entry = entries[name];
  return entry ? strFromU8(entry) : '';
}

function resolveTarget(target) {
  let cleaned = String(target || '').replace(/^\/+/, '');
  if (!cleaned) return '';
  const prefix = cleaned.startsWith('xl/') || cleaned.startsWith('docProps/') ? [] : ['xl'];
  const output = [];
  for (const part of [...prefix, ...cleaned.split('/')]) {
    if (!part || part === '.') continue;
    if (part === '..') output.pop();
    else output.push(part);
  }
  return output.join('/');
}

function parseSharedStrings(xml) {
  if (!xml) return [];
  const items = xml.match(/<si\b[^>]*>[\s\S]*?<\/si>/gi) || [];
  return items.map((item) => {
    const texts = item.match(/<t\b[^>]*>[\s\S]*?<\/t>/gi) || [];
    return texts.map((text) => xmlUnescape((text.match(/<t\b[^>]*>([\s\S]*?)<\/t>/i) || [])[1] || '')).join('');
  });
}

function cellValue(attrsText, inner, sharedStrings) {
  const attributes = parseAttrs(attrsText);
  const type = String(attributes.t || '').toLowerCase();
  if (type === 'inlinestr') {
    const text = (inner.match(/<t\b[^>]*>([\s\S]*?)<\/t>/i) || [])[1];
    return xmlUnescape(text || '');
  }
  const raw = (inner.match(/<v\b[^>]*>([\s\S]*?)<\/v>/i) || [])[1];
  let value = xmlUnescape(raw || '');
  if (type === 's') {
    const index = Number(value);
    value = Number.isInteger(index) && sharedStrings[index] !== undefined ? sharedStrings[index] : '';
  } else if (type === 'b') {
    value = value === '1' ? 'TRUE' : 'FALSE';
  } else if (type === 'e') {
    value = '';
  }
  return value;
}

function worksheetRows(xml, sharedStrings) {
  const body = (xml.match(/<sheetData\b[^>]*>([\s\S]*?)<\/sheetData>/i) || [])[1] || '';
  const rows = [];
  const rowPattern = /<row\b([^>]*)>([\s\S]*?)<\/row>/gi;
  let rowMatch;
  while ((rowMatch = rowPattern.exec(body)) !== null) {
    const rowNumber = Number(attr(rowMatch[1], 'r')) || rows.length + 1;
    const cells = [];
    let automaticIndex = 0;
    const cellPattern = /<c\b([^>]*?)(?:\s*\/>|>([\s\S]*?)<\/c>)/gi;
    let cellMatch;
    while ((cellMatch = cellPattern.exec(rowMatch[2])) !== null) {
      const reference = attr(cellMatch[1], 'r');
      const index = reference ? columnIndex(reference) : automaticIndex;
      while (cells.length < index) cells.push('');
      cells[index] = cellValue(cellMatch[1], cellMatch[2] || '', sharedStrings);
      automaticIndex = index + 1;
    }
    rows.push({ rowNumber, cells });
  }
  return rows;
}

function headerKey(value) {
  const key = String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (key.includes('full name')) return 'name';
  if (key === 'class' || key === 'class name') return 'className';
  if (key.startsWith('serial number')) return 'serial';
  if (key === 'username' || key === 'login name' || key === 'user name') return 'username';
  if (key === 'password') return 'password';
  return '';
}

function sheetRole(name) {
  const key = String(name || '').toLowerCase().replace(/[^a-z]/g, '');
  if (key.includes('student')) return 'student';
  if (key.includes('teacher')) return 'teacher';
  return null;
}

function fieldLabel(key) {
  return key === 'name' ? 'Full Name'
    : key === 'className' ? 'Class'
      : key === 'serial' ? 'Serial Number'
        : key === 'username' ? 'Username'
          : 'Password';
}

/**
 * Reads .xlsx bytes and returns normalised raw rows. Duplicate/DB validation is
 * performed in serials.js so the same rules apply to forms, bulk entry, and Excel.
 */
export function parseSerialsWorkbook(bytes) {
  let entries;
  try {
    entries = unzipSync(toBytes(bytes));
  } catch (_) {
    throw new Error('That file is not a valid Excel .xlsx workbook.');
  }
  const workbookXmlText = entryText(entries, 'xl/workbook.xml');
  if (!workbookXmlText) throw new Error('The Excel workbook is missing its workbook definition.');
  const relationships = new Map();
  const relationshipXml = entryText(entries, 'xl/_rels/workbook.xml.rels');
  const relationshipPattern = /<Relationship\b([^>]*?)\/>/gi;
  let relationshipMatch;
  while ((relationshipMatch = relationshipPattern.exec(relationshipXml)) !== null) {
    const id = attr(relationshipMatch[1], 'Id');
    if (id) relationships.set(id, attr(relationshipMatch[1], 'Target'));
  }
  const sharedStrings = parseSharedStrings(entryText(entries, 'xl/sharedStrings.xml'));
  const rows = [];
  const sheets = [];
  const sheetPattern = /<sheet\b([^>]*?)\/>/gi;
  let sheetMatch;
  while ((sheetMatch = sheetPattern.exec(workbookXmlText)) !== null) {
    const sheetName = attr(sheetMatch[1], 'name');
    const role = sheetRole(sheetName);
    if (!role) continue;
    const relationshipId = attr(sheetMatch[1], 'r:id') || attr(sheetMatch[1], 'id');
    const path = resolveTarget(relationships.get(relationshipId));
    const xml = entryText(entries, path);
    if (!xml) throw new Error(`The ${sheetName} worksheet could not be read.`);
    const sourceRows = worksheetRows(xml, sharedStrings);
    const headerIndex = sourceRows.findIndex((row) => row.cells.some((cell) => String(cell).trim()));
    if (headerIndex < 0) throw new Error(`The ${sheetName} worksheet has no header row.`);
    const headerMap = {};
    sourceRows[headerIndex].cells.forEach((cell, index) => {
      const key = headerKey(cell);
      if (key && headerMap[key] === undefined) headerMap[key] = index;
    });
    const required = role === 'student'
      ? ['name', 'className', 'serial', 'username', 'password']
      : ['name', 'username', 'password'];
    const missing = required.filter((key) => headerMap[key] === undefined);
    if (missing.length) throw new Error(`The ${sheetName} worksheet is missing: ${missing.map(fieldLabel).join(', ')}.`);
    let dataRows = 0;
    for (const row of sourceRows.slice(headerIndex + 1)) {
      const values = row.cells.map((cell) => String(cell || '').trim());
      if (!values.some(Boolean)) continue;
      const value = (key) => headerMap[key] === undefined ? '' : (values[headerMap[key]] || '');
      rows.push({
        role,
        sheet: sheetName,
        rowNumber: row.rowNumber,
        source: `${sheetName}!${row.rowNumber}`,
        name: value('name'),
        className: role === 'student' ? value('className') : '',
        serial: value('serial'),
        username: value('username'),
        password: value('password'),
        active: true,
        autoApprove: false
      });
      dataRows += 1;
    }
    sheets.push({ role, name: sheetName, headerRow: sourceRows[headerIndex].rowNumber, dataRows });
  }
  if (!sheets.length) throw new Error('No Student Serials or Teacher Serials worksheets were found.');
  return { rows, sheets };
}
