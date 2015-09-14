'use strict';

var args = require('minimist')(process.argv.slice(2));
var path = require('path');

try {
    var layoutFile = path.resolve(args.layouts || 'layouts.json');
    var layouts = require(layoutFile);
} catch(e) {
    console.error(e);
    console.error('Error reading the layouts file. Exit.');
    process.exit(1);
}

exports = module.exports = layouts;