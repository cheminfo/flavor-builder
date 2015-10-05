'use strict';

var urlLib = require('url');

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