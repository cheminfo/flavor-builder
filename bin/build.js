#!/usr/bin/env node

'use strict';
var args = require('minimist')(process.argv.slice(2));

console.log(args);
var flavorBuilder = require('../src/index');
var configs = args.config.split(',');
var prom = [];
for (var i = 0; i < configs.length; i++) {
    prom.push(flavorBuilder.build(configs[i]));
}

Promise.all(prom).then(function() {
    console.log('done build');
}).catch(function(e) {
    console.error('Error building with flavor-builder', e);
    process.exit(1);
});