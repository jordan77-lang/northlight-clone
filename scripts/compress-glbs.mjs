/**
 * Batch-compress building GLBs with Draco + WebP.
 * Skips Northlight.glb (geometry-only shell, already ~40 KB).
 * Keeps a one-time .original.glb backup before overwriting.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const buildingDir = path.join(root, 'docs', 'building');
const showsDir = path.join(root, 'docs', 'shows');
const skipNames = new Set(['Northlight.glb']);

const textureSizeByDir = [
  { match: (p) => p.includes(`${path.sep}shows${path.sep}`), size: 2048 },
  { match: () => true, size: 2048 },
];

function formatMb(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function collectGlbs(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  const walk = (current) => {
    for (const name of fs.readdirSync(current)) {
      const full = path.join(current, name);
      const stat = fs.statSync(full);
      if (stat.isDirectory()) walk(full);
      else if (name.toLowerCase().endsWith('.glb')) out.push(full);
    }
  };
  walk(dir);
  return out;
}

function textureSizeFor(filePath) {
  return textureSizeByDir.find((rule) => rule.match(filePath))?.size ?? 2048;
}

function runOptimize(input, output, textureSize) {
  const cli = path.join(root, 'node_modules', '@gltf-transform', 'cli', 'bin', 'cli.js');
  execFileSync(
    process.execPath,
    [
      cli,
      'optimize',
      input,
      output,
      '--compress',
      'draco',
      '--texture-compress',
      'webp',
      '--texture-size',
      String(textureSize),
    ],
    { stdio: 'inherit', cwd: root },
  );
}

const targets = [
  ...collectGlbs(buildingDir),
  ...collectGlbs(showsDir),
].filter((file) => !skipNames.has(path.basename(file)));

if (targets.length === 0) {
  console.log('No GLB files found to compress.');
  process.exit(0);
}

console.log(`Compressing ${targets.length} GLB(s) (skipping ${[...skipNames].join(', ')})…\n`);

let savedTotal = 0;

for (const file of targets.sort()) {
  const rel = path.relative(root, file);
  const backup = file.replace(/\.glb$/i, '.original.glb');
  const temp = file.replace(/\.glb$/i, '.compressed.glb');
  const before = fs.statSync(file).size;

  if (process.env.COMPRESS_GLB_KEEP_ORIGINAL === '1' && !fs.existsSync(backup)) {
    fs.copyFileSync(file, backup);
    console.log(`  backup  ${path.relative(root, backup)}`);
  }

  try {
    runOptimize(file, temp, textureSizeFor(file));
  } catch (err) {
    console.error(`  FAILED  ${rel}:`, err.message ?? err);
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
    continue;
  }

  const after = fs.statSync(temp).size;
  if (after >= before) {
    console.log(`  skip    ${rel} — compressed (${formatMb(after)}) not smaller than original (${formatMb(before)})`);
    fs.unlinkSync(temp);
    continue;
  }

  fs.renameSync(temp, file);
  const saved = before - after;
  savedTotal += saved;
  const pct = ((saved / before) * 100).toFixed(1);
  console.log(`  ok      ${rel}: ${formatMb(before)} → ${formatMb(after)} (−${pct}%)`);
}

console.log(`\nDone. Total saved: ${formatMb(savedTotal)}`);
console.log('Originals are not kept by default. Set COMPRESS_GLB_KEEP_ORIGINAL=1 to backup as *.original.glb.');
