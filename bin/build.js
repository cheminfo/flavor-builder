#!/usr/bin/env node

'use strict';

let args = require('minimist')(process.argv.slice(2));
const log = require('../src/log');
let flavorBuilder = require('../src/index');

let configs = args.config.split(',');
let prom = [];
for (let i = 0; i < configs.length; i++) {
  prom.push(flavorBuilder.build(configs[i]));
}

Promise.all(prom)
  .then(() => {
    log.info('done build');
  })
  .catch((e) => {
    console.error('Error building with flavor-builder', e, e.stack);
    process.exit(1);
  });
