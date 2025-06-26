import fs from 'node:fs';
import path from 'node:path';

import { DEFAULT_FLAVOR } from './constants.js';

export function pathFromDir(config, flavorName, elementPath) {
  let basicPath = path.relative(config.dir, elementPath);
  if (flavorName === DEFAULT_FLAVOR) {
    return basicPath;
  } else {
    return path.join('flavor', flavorName, basicPath);
  }
}

export function getFlavorDir(config, flavorName, create) {
  let flavorDir;
  if (flavorName === DEFAULT_FLAVOR || flavorName === config.flavor) {
    flavorDir = config.dir;
  } else {
    flavorDir = path.join(config.dir, 'flavor', flavorName);
  }
  if (create) {
    fs.mkdirSync(flavorDir, { recursive: true });
  }
  return flavorDir;
}
