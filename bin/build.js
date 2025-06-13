#!/usr/bin/env node

import process from 'node:process';

import minimist from 'minimist';

import flavorBuilder from '../src/index.js';
import log from '../src/log.js';

let args = minimist(process.argv.slice(2));

let configs = args.config.split(',');
let prom = [];
for (let i = 0; i < configs.length; i++) {
  prom.push(flavorBuilder.build(configs[i]));
}

await Promise.all(prom);
log.info('done build');
