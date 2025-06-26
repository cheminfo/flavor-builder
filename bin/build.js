#!/usr/bin/env node

import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';

import minimist from 'minimist';

import { build, buildConfig } from '../src/index.js';
import log from '../src/log.js';
import { acquireLock, releaseLock } from '../src/processLock.js';

let args = minimist(process.argv.slice(2));
const configFiles =
  typeof args.config === 'string' ? args.config.split(',') : args.config;

const pidFile = path.join(tmpdir(), 'flavor-builder.pid');
let isProcessLocked = acquireLock(pidFile);
if (isProcessLocked) {
  throw new Error('flavor-builder already running');
}

for (let i = 0; i < configFiles.length; i++) {
  const config = await buildConfig(configFiles[i]);
  await build(config);
}

await releaseLock(pidFile);

log.info('done build');
