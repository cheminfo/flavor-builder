#!/usr/bin/env node

'use strict';
var args = require('minimist')(process.argv.slice(2));

var flavorBuilder = require('../src/index');

try {
    flavorBuilder.build(args.config);
} catch(e) {
    console.error('Error building with flavor-builder', e);
    process.exit(1);
}

