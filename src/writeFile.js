import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';

let filesWriting = {};

export async function writeFile(url, p, options) {
  options = options || {};
  if (filesWriting[p]) {
    return true;
  }
  filesWriting[p] = true;
  if (fs.existsSync(p)) {
    return;
  }
  const response = await fetch(url, options);
  assert.ok(
    response.status === 200,
    `Failed to fetch data for ${url}: ${response.statusText}`,
  );
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const fileStream = fs.createWriteStream(p);
  await pipeline(response.body, fileStream);
}
