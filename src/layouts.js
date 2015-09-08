'use strict';

var args = require('minimist')(process.argv.slice(2));

try {
    var layouts = args.layouts ? require(args.config) : require('./../layouts.json');
} catch(e) {
    console.error(e);
    console.error('Error reading the layouts file. Exit.');
    process.exit(1);
}

exports = module.exports = layouts;