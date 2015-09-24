'use strict';

var args = require('minimist')(process.argv.slice(2));
var path = require('path');

exports = module.exports = function (configArg) {
    configArg = configArg || 'config.json';
    if (typeof configArg === 'string') {
        var configFile = path.resolve(configArg);
        var config = require(configFile);
    } else if (typeof configArg === 'object') {
        config = configArg;
    } else {
        throw new TypeError('Incorrect argument');
    }
// Config given in the command line takes precendence
    for (var key in args) {
        config[key] = args[key];
    }

// Check mandatory parameters
    var mandatory = ['dir', 'readConfig', 'cdn', 'direct', 'home', 'couchurl', 'couchLocalUrl', 'flavorUsername', 'couchDatabase', 'layouts'];
    for (var i = 0; i < mandatory.length; i++) {
        if (config[mandatory[i]] === undefined) {
            throw new Error(mandatory[i] + ' is mandatory');
        }
    }

    config.couchReqOptions = config.couchPassword ? {
        auth: {
            user: config.couchUsername,
            pass: config.couchPassword,
            sendImmediately: true
        }
    } : {};

    config.couchurl = config.couchurl.replace(/\/$/, '');
    if (config.couchLocalUrl) config.couchLocalUrl = config.couchLocalUrl.replace(/\/$/, '');
    config.dir = path.resolve(config.dir);
    config.flavorLayouts = config.flavorLayouts || {};
    if(config.layouts) {
        for(var key in config.layouts) {
            config.layouts[key] = path.join(__dirname, '../layout', config.layouts[key]);
        }
    }

    return config;
};

