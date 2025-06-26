#!/usr/bin/env node

import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';

import minimist from 'minimist';

import { build, buildConfig } from '../src/index.js';
import { isLocked } from '../src/isLocked.js';
import log from '../src/log.js';

let args = minimist(process.argv.slice(2));
let configFiles = [];
if (typeof args.config === 'string') {
  configFiles = args.config.split(',');
} else {
  configFiles = args.config;
}

const pidFile = path.join(tmpdir(), 'flavor-builder.pid');
let isProcessLocked = isLocked(
  path.resolve(path.join(import.meta.dirname, '..'), pidFile),
);
if (isProcessLocked) {
  throw new Error('flavor-builder already running');
}

for (let i = 0; i < configFiles.length; i++) {
  const config = await buildConfig(configFiles[i]);
  await build(config);
}

log.info('done build');
