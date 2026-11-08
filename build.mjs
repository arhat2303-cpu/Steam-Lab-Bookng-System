import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url));
const sourceFiles = [
  'src/core.js',
  'src/scheduler.js',
  'src/estimate.js',
  'src/fflate.js',
  'src/xlsx.js',
  'src/db.js',
  'src/serials.js',
  'src/api.js',
  'src/selftest.js',
  'src/ui.js'
];

const importPattern = /^\s*import\s+\{([^}]+)\}\s+from\s+['"][^'"]+['"];\s*$/gm;
const exportPattern = /^\s*export\s+((?:async\s+)?(?:function|const|let|var|class)\s+([A-Za-z_$][\w$]*))/gm;
const namedExportPattern = /^\s*export\s*\{([^}]+)\};?\s*$/gm;

function importedNames(specifier) {
  return specifier
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => part.replace(/\s+as\s+/g, ': '));
}

function sourceNames(specifier) {
  return specifier
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => part.split(/\s+as\s+/)[0].trim());
}

function moduleBundle(code, filename, available) {
  const exportNames = [];
  const importLines = [];
  let withoutImports = code.replace(importPattern, (_match, specifier) => {
    const parts = importedNames(specifier);
    for (const name of sourceNames(specifier)) {
      if (!available.has(name)) throw new Error(`build.mjs: ${filename} imports ${name} before it is exported`);
    }
    importLines.push(`const { ${parts.join(', ')} } = __SL;`);
    return '';
  });
  withoutImports = withoutImports.replace(exportPattern, (_match, declaration, name) => {
    exportNames.push({ local: name, exported: name });
    return declaration;
  });
  withoutImports = withoutImports.replace(namedExportPattern, (_match, specifier) => {
    for (const part of specifier.split(',').map((entry) => entry.trim()).filter(Boolean)) {
      const match = part.match(/^([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/);
      if (!match) throw new Error(`build.mjs could not inline named export ${part} in ${filename}`);
      exportNames.push({ local: match[1], exported: match[2] || match[1] });
    }
    return '';
  });
  if (/^\s*import\s/m.test(withoutImports) || /^\s*export\s/m.test(withoutImports)) {
    throw new Error(`build.mjs could not inline module syntax in ${filename}`);
  }
  if (/<\/script/i.test(withoutImports)) {
    throw new Error(`build.mjs found an unsafe closing script tag in ${filename}`);
  }
  for (const entry of exportNames) available.add(entry.exported);
  const exportAssignments = exportNames.map((entry) => `__SL.${entry.exported} = ${entry.local};`).join('\n');
  return `/* ${filename} */\n(function () {\n'use strict';\n${importLines.join('\n')}\n${withoutImports.trim()}\n${exportAssignments}\n})();`;
}

const shell = await readFile(path.join(root, 'index.html'), 'utf8');
const css = await readFile(path.join(root, 'src/styles.css'), 'utf8');
const available = new Set();
const modules = [];
for (const filename of sourceFiles) {
  const code = await readFile(path.join(root, filename), 'utf8');
  modules.push(moduleBundle(code, filename, available));
}

const bundled = `(function () {\n'use strict';\nconst __SL = Object.create(null);\n\n${modules.join('\n\n')}\n})();`;
let output = shell;
output = output.replace(
  '<link rel="stylesheet" href="./src/styles.css">',
  `<style>\n${css.trim()}\n</style>`
);
output = output.replace(
  '<script type="module" src="./src/ui.js"></script>',
  `<script>\n${bundled}\n</script>`
);

if (output.includes('<link rel="stylesheet" href="./src/styles.css">') || output.includes('<script type="module" src="./src/ui.js"></script>')) {
  throw new Error('build.mjs did not replace all source references');
}
if (/<(?:script|link)[^>]+(?:src|href)=["']https?:/i.test(output)) {
  throw new Error('build.mjs detected a runtime external request');
}
if (output.includes('type="module"')) {
  throw new Error('build.mjs emitted a module script; dist must be a single classic script');
}

await mkdir(path.join(root, 'dist'), { recursive: true });
await writeFile(path.join(root, 'dist/index.html'), output, 'utf8');
console.log(`Built dist/index.html (${Buffer.byteLength(output, 'utf8')} bytes, ${sourceFiles.length} inlined modules).`);
