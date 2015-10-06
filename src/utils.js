'use strict';

var urlLib = require('url');
var writeFile = require('./writeFile');
var path = require('path');

module.exports = {};

module.exports.checkAuth = function (config, options, url) {
    var parsedUrl = urlLib.parse(url);
    if (config.httpAuth && config.httpAuth[parsedUrl.hostname]) {
        options.auth = {
            user: config.httpAuth[parsedUrl.hostname].user,
            pass: config.httpAuth[parsedUrl.hostname].pass,
            sendImmediately: true
        }
    }
    return options;
};

module.exports.checkVersion = function(version) {
    if (version && version[0] >= '0' && version[0] <= '9' && !version.startsWith('v')) version = 'v' + version;
    return version;
};

module.exports.cacheUrl = function (config, url) {
    var options = {};

    url = url.replace(/^\/\//, 'https://');
    var parsedUrl = urlLib.parse(url);

    // Add authentification if necessary
    module.exports.checkAuth(config, options, url);

    var p = path.join(config.libFolder, parsedUrl.hostname, parsedUrl.path);
    var writePath = path.join(config.dir, p);
    if (config.selfContained) {
        return writeFile(url, writePath, options).catch(function (err) {
            console.error('error copying file', err.stack);
        });
    } else {
        return Promise.resolve();
    }
};