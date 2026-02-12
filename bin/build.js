#!/usr/bin/env node

import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';

import { build } from '../src/index.js';
import { acquireLock, releaseLock } from '../src/lock.js';
import log from '../src/log.js';

const parsedResults = parseArgs({
  options: {
    config: { type: 'string', multiple: true, short: 'c', default: [] },
  },
  strict: false,
});

const configFiles = parsedResults.values.config.flatMap((v) => v.split(','));

const pidFile = path.join(tmpdir(), 'flavor-builder.pid');
let isProcessLocked = acquireLock(pidFile);
if (isProcessLocked) {
  throw new Error('flavor-builder already running');
}

if (configFiles.length === 0) {
  log.info('No config file specified, nothing to do');
}

for (let i = 0; i < configFiles.length; i++) {
  await build(configFiles[i]);
}

await releaseLock(pidFile);

log.info('done build');
