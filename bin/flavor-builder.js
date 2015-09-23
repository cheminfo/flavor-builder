#!/usr/bin/env node

'use strict';

var program = require('commander');

var pkg = require('../package.json');
program.version(pkg.version);

program
    .command('build', 'Build a website based on flavors in couchdb');

program.parse(process.argv);

