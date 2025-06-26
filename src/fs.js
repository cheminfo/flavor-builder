import fs from 'node:fs';
import fsAsync from 'node:fs/promises';
import { dirname } from 'node:path';

import log from './log.js';

export function writeJsonSync(filePath, data) {
  const jsonData = JSON.stringify(data, null, 2);
  fs.writeFileSync(filePath, jsonData, 'utf8');
}

export function readJsonSync(filePath) {
  const jsonData = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(jsonData);
}

export function createOrReadJson(path) {
  log.trace(`check that ${path} can be written`);
  try {
    let fid = fs.openSync(path, 'a+');
    fs.closeSync(fid);
    try {
      return readJsonSync(path);
    } catch {
      return {};
    }
  } catch (error) {
    if (error.code === 'ENOENT') {
      const dir = dirname(path);
      fs.mkdirSync(dir, { recursive: true });
      writeJsonSync(path, {});
      return {};
    } else {
      // propagate the error
      throw error;
    }
  }
}

export async function copyFiles(toCopy) {
  for (let i = 0; i < toCopy.length; i++) {
    log.trace(`copy ${toCopy[i].src} to ${toCopy[i].dest}`);
    await fsAsync.cp(toCopy[i].src, toCopy[i].dest, { recursive: true });
  }
}
