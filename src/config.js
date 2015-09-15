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

// Config given in the command line takes precendence
for (var key in args) {
    config[key] = args[key];
}

// Check mandatory parameters
var mandatory = ['dir', 'readConfig', 'cdn', 'direct', 'home', 'couchurl', 'couchLocalUrl', 'flavorUsername', 'couchDatabase'];
for (var i = 0; i < mandatory.length; i++) {
    if(config[mandatory[i]] === undefined) {
        throw new Error(mandatory[i] + ' is mandatory');
    }
}

config.couchurl = config.couchurl.replace(/\/$/, '');
if (config.couchLocalUrl) config.couchLocalUrl = config.couchLocalUrl.replace(/\/$/, '');
config.requrl = config.couchLocalUrl || config.couchurl;
config.readConfig = path.resolve(config.readConfig || 'static/readConfig.json');
config.dir = path.resolve(config.dir);
config.flavorLayouts = config.flavorLayouts || {};

exports = module.exports = config;

