#!/usr/bin/env node

import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';

import minimist from 'minimist';

import { build } from '../src/index.js';
import { acquireLock, releaseLock } from '../src/lock.js';
import log from '../src/log.js';

let args = minimist(process.argv.slice(2));
const configFiles =
  typeof args.config === 'string' ? args.config.split(',') : args.config;

const pidFile = path.join(tmpdir(), 'flavor-builder.pid');
let isProcessLocked = acquireLock(pidFile);
if (isProcessLocked) {
  throw new Error('flavor-builder already running');
}

for (let i = 0; i < configFiles.length; i++) {
  await build(configFiles[i]);
}

await releaseLock(pidFile);

log.info('done build');
