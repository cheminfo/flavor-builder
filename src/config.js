'use strict';

var args = require('minimist')(process.argv.slice(2));
var path = require('path');

try {
    var configFile = path.resolve(args.config || 'config.json');
    var config = require(configFile);
} catch(e) {
    console.error(e);
    console.error('Error reading the configuration file. Exit.');
    process.exit(1);
}


config.couchurl = config.couchurl.replace(/\/$/, '');
if (config.couchLocalUrl) config.couchLocalUrl = config.couchLocalUrl.replace(/\/$/, '');

config.requrl = config.couchLocalUrl || config.couchurl;

// Config given in the command line takes precendence
for (var key in args) {
    config[key] = args[key];
}

config.flavorLayouts = config.flavorLayouts || {};

exports = module.exports = config;

