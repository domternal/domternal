#!/usr/bin/env node
/**
 * Generates coverage-index.html at repo root by reading coverage-summary.json
 * from each package's coverage/ folder. Produces a dashboard with fresh numbers
 * and links to each package's detailed HTML report.
 *
 * Usage: pnpm coverage:index (runs pnpm test:coverage first, then this script)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const packagesDir = path.join(rootDir, 'packages');

const packages = fs.readdirSync(packagesDir)
  .map((name) => path.join(packagesDir, name))
  .filter((dir) => fs.statSync(dir).isDirectory())
  .map((dir) => {
    const summaryPath = path.join(dir, 'coverage', 'coverage-summary.json');
    if (!fs.existsSync(summaryPath)) return null;
    const pkgJson = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf-8'));
    const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf-8')).total;
    return {
      name: pkgJson.name,
      path: path.relative(rootDir, path.join(dir, 'coverage', 'index.html')),
      stmts: summary.statements.pct,
      branch: summary.branches.pct,
      funcs: summary.functions.pct,
      lines: summary.lines.pct,
    };
  })
  .filter(Boolean)
  .sort((a, b) => a.name.localeCompare(b.name));

if (packages.length === 0) {
  console.error('No coverage-summary.json files found. Run `pnpm test:coverage` first.');
  process.exit(1);
}

const generatedAt = new Date().toLocaleString('en-GB', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Domternal — Coverage Reports</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 900px; margin: 2rem auto; padding: 0 1rem; background: #fafafa; color: #222; }
    h1 { border-bottom: 2px solid #333; padding-bottom: 0.5rem; margin-bottom: 0.25rem; }
    .meta { color: #666; font-size: 0.85rem; margin-bottom: 1.5rem; }
    table { width: 100%; border-collapse: collapse; background: white; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
    th, td { padding: 0.75rem 1rem; text-align: left; border-bottom: 1px solid #eee; }
    th { background: #333; color: white; font-weight: 600; }
    td.num { text-align: right; font-family: ui-monospace, monospace; }
    a { color: #2563eb; text-decoration: none; font-weight: 500; }
    a:hover { text-decoration: underline; }
    .bar { display: inline-block; width: 60px; height: 8px; background: #eee; border-radius: 4px; overflow: hidden; margin-right: 0.5rem; vertical-align: middle; }
    .bar-fill { height: 100%; }
    .high { background: #10b981; }
    .mid { background: #f59e0b; }
    .low { background: #ef4444; }
    tr:hover { background: #f9f9f9; }
  </style>
</head>
<body>
  <h1>Domternal — Coverage Reports</h1>
  <div class="meta">Generated: ${generatedAt} · Click package name for detailed HTML report</div>
  <table>
    <thead>
      <tr>
        <th>Package</th>
        <th>Statements</th>
        <th>Branches</th>
        <th>Functions</th>
        <th>Lines</th>
      </tr>
    </thead>
    <tbody>
${packages.map((p) => {
  const cell = (pct) => {
    const cls = pct >= 80 ? 'high' : pct >= 60 ? 'mid' : 'low';
    return `<td class="num"><span class="bar"><span class="bar-fill ${cls}" style="width:${pct}%"></span></span>${pct.toFixed(1)}%</td>`;
  };
  return `      <tr><td><a href="${p.path}">${p.name}</a></td>${cell(p.stmts)}${cell(p.branch)}${cell(p.funcs)}${cell(p.lines)}</tr>`;
}).join('\n')}
    </tbody>
  </table>
</body>
</html>
`;

const outputPath = path.join(rootDir, 'coverage-index.html');
fs.writeFileSync(outputPath, html);
console.log(`Coverage index generated: ${outputPath}`);
console.log(`${packages.length} packages listed`);
