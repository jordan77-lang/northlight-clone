/**
 * Downscale 4K building textures to 2K using ImageMagick.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const docs = path.join(root, 'docs', 'building');

function formatMb(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function magickResize(input, output, extraArgs = []) {
  execFileSync(
    'magick',
    [input, '-filter', 'Lanczos', '-resize', '2048x2048>', ...extraArgs, output],
    { stdio: 'inherit' },
  );
}

const jobs = [
  {
    input: path.join(docs, 'Brick wall', 'factory_brick_diff_4k.jpg'),
    output: path.join(docs, 'Brick wall', 'factory_brick_diff_2k.jpg'),
    args: ['-quality', '88'],
  },
  {
    input: path.join(docs, 'Brick wall', 'factory_brick_arm_4k.jpg'),
    output: path.join(docs, 'Brick wall', 'factory_brick_arm_2k.jpg'),
    args: ['-quality', '88'],
  },
  {
    input: path.join(docs, 'Brick wall', 'factory_brick_disp_4k.png'),
    output: path.join(docs, 'Brick wall', 'factory_brick_disp_2k.png'),
    args: [],
  },
  {
    input: path.join(docs, 'Brick wall', 'factory_brick_nor_gl_4k.exr'),
    output: path.join(docs, 'Brick wall', 'factory_brick_nor_gl_2k.exr'),
    args: [],
  },
  {
    input: path.join(docs, 'HDRI', 'christmas_photo_studio_04_4k (1).exr'),
    output: path.join(docs, 'HDRI', 'christmas_photo_studio_02_2k.exr'),
    args: [],
  },
];

console.log('Downscaling 4K textures to 2K with ImageMagick…\n');

let saved = 0;
for (const job of jobs) {
  if (!fs.existsSync(job.input)) {
    console.warn(`skip missing: ${path.relative(root, job.input)}`);
    continue;
  }
  const before = fs.statSync(job.input).size;
  magickResize(job.input, job.output, job.args);
  const after = fs.statSync(job.output).size;
  saved += Math.max(0, before - after);
  console.log(
    `${path.relative(root, job.output)}  ${formatMb(before)} → ${formatMb(after)}`,
  );
}

console.log(`\nDone. Approx. saved: ${formatMb(saved)}`);
