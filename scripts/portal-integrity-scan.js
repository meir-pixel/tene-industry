'use strict';

const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const outputDir = path.join(rootDir, 'test-results', 'portal-integrity');
const sources = [
  'public/customer.html',
  'public/portal.html',
  'routes/portal.js',
  'routes/portalAdmin.js',
  'services/portalAccess.js',
  'services/customerPortalProjection.js',
  'services/customerPortalShapeDraft.js',
  'services/customerPortalStatus.js',
].filter(relativePath => fs.existsSync(path.join(rootDir, relativePath)));

function lineNumber(source, index) {
  return source.slice(0, index).split(/\r?\n/).length;
}

function add(findings, finding) {
  const key = `${finding.rule}:${finding.file}:${finding.line}:${finding.message}`;
  if (!findings.some(row => row.key === key)) findings.push({ key, ...finding });
}

function visibleText(html) {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--([\s\S]*?)-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z0-9#]+;/gi, ' ');
}

function scanHtml(relativePath, source, findings) {
  const text = visibleText(source);
  for (const match of text.matchAll(/\b(TODO|FUTURE|PLACEHOLDER|DEMO)\b/gi)) {
    add(findings, {
      severity: 'warning', rule: 'visible-placeholder-language', file: relativePath,
      line: null, message: `Visible ${match[1]} language remains in the portal`, evidence: match[0],
    });
  }

  for (const match of source.matchAll(/href\s*=\s*["']#["']/gi)) {
    add(findings, {
      severity: 'warning', rule: 'dead-href', file: relativePath, line: lineNumber(source, match.index),
      message: 'Obvious dead href="#"', evidence: match[0],
    });
  }

  const defined = new Set();
  for (const match of source.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g)) defined.add(match[1]);
  for (const match of source.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function\b|\([^)]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>)/g)) defined.add(match[1]);
  const languageKeywords = new Set(['if', 'for', 'while', 'switch', 'catch']);
  for (const attribute of source.matchAll(/onclick\s*=\s*(["'])([\s\S]*?)\1/gi)) {
    for (const call of attribute[2].matchAll(/(?<!\.)\b([A-Za-z_$][\w$]*)\s*\(/g)) {
      const name = call[1];
      if (languageKeywords.has(name) || defined.has(name)) continue;
      add(findings, {
        severity: 'warning', rule: 'missing-onclick-function', file: relativePath, line: lineNumber(source, attribute.index),
        message: `onclick references a function that is not defined in the file: ${name}()`, evidence: attribute[0],
      });
    }
  }
}

function scanSource(relativePath, source, findings) {
  for (const match of source.matchAll(/\bDEMO_[A-Z0-9_]+\b/g)) {
    add(findings, {
      severity: 'error', rule: 'demo-data', file: relativePath, line: lineNumber(source, match.index),
      message: `Demo data identifier remains: ${match[0]}`, evidence: match[0],
    });
  }

  const hebrewComparison = /(?:===|!==|==|!=|\.includes\()\s*["'][^"'\r\n]*[\u0590-\u05ff][^"'\r\n]*["']/g;
  for (const match of source.matchAll(hebrewComparison)) {
    add(findings, {
      severity: 'warning', rule: 'hebrew-business-comparison', file: relativePath, line: lineNumber(source, match.index),
      message: 'Business/UI state is compared with a Hebrew display label', evidence: match[0],
    });
  }
}

const findings = [];
for (const relativePath of sources) {
  const source = fs.readFileSync(path.join(rootDir, relativePath), 'utf8');
  scanSource(relativePath, source, findings);
  if (relativePath.endsWith('.html')) scanHtml(relativePath, source, findings);
}

if (fs.existsSync(path.join(rootDir, 'public', 'portal.html'))) {
  add(findings, {
    severity: 'error', rule: 'deprecated-public-portal', file: 'public/portal.html', line: 1,
    message: 'Deprecated public order lookup artifact is still shipped alongside customer.html',
    evidence: 'public/portal.html',
  });
}

const customerHtml = fs.readFileSync(path.join(rootDir, 'public', 'customer.html'), 'utf8');
const filenameOnlyIndex = customerHtml.indexOf("portalSourceFiles.map(f => f.name).join(', ')");
const sourceUploadIndex = customerHtml.indexOf('id="portalSourceFiles"');
if (sourceUploadIndex >= 0 && filenameOnlyIndex >= 0) {
  add(findings, {
    severity: 'error', rule: 'filename-only-upload', file: 'public/customer.html', line: lineNumber(customerHtml, filenameOnlyIndex),
    message: 'Source-document control keeps only filename metadata and appends names to order notes; file bytes are not uploaded',
    evidence: "portalSourceFiles.map(f => f.name).join(', ')",
  });
}

findings.sort((a, b) => a.file.localeCompare(b.file) || (a.line || 0) - (b.line || 0) || a.rule.localeCompare(b.rule));
const report = {
  scanner: 'PORTAL-R0 UI integrity scanner',
  generatedAt: new Date().toISOString(),
  sources,
  summary: {
    total: findings.length,
    errors: findings.filter(row => row.severity === 'error').length,
    warnings: findings.filter(row => row.severity === 'warning').length,
  },
  findings: findings.map(({ key, ...finding }) => finding),
};

fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(path.join(outputDir, 'findings.json'), JSON.stringify(report, null, 2));
const markdown = [
  '# PORTAL-R0 UI integrity scan',
  '',
  `Generated: ${report.generatedAt}`,
  '',
  `Findings: ${report.summary.total} (${report.summary.errors} errors, ${report.summary.warnings} warnings)`,
  '',
  '| Severity | Rule | Location | Finding |',
  '| --- | --- | --- | --- |',
  ...report.findings.map(row => `| ${row.severity} | ${row.rule} | \`${row.file}${row.line ? `:${row.line}` : ''}\` | ${row.message.replaceAll('|', '\\|')} |`),
  '',
  '> Scanner findings are evidence only and are intentionally reported separately from Playwright pass/fail results.',
  '',
].join('\n');
fs.writeFileSync(path.join(outputDir, 'findings.md'), markdown);

console.log(`Portal integrity scan: ${report.summary.total} findings (${report.summary.errors} errors, ${report.summary.warnings} warnings)`);
for (const row of report.findings) console.log(`[${row.severity.toUpperCase()}] ${row.rule} ${row.file}${row.line ? `:${row.line}` : ''} - ${row.message}`);
console.log(`Reports: ${path.relative(rootDir, outputDir)}`);
