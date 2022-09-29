#!/usr/bin/env node

'use strict';

let args = require('minimist')(process.argv.slice(2));

let flavorBuilder = require('../src/index');

let configs = args.config.split(',');
let prom = [];
for (let i = 0; i < configs.length; i++) {
  prom.push(flavorBuilder.build(configs[i]));
}

Promise.all(prom)
  .then(function () {
    console.log('done build');
  })
  .catch(function (e) {
    console.error('Error building with flavor-builder', e, e.stack);
    process.exit(1);
  });
