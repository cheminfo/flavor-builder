'use strict';

var urlLib = require('url');
var writeFile = require('./writeFile');
var path = require('path');
var request = require('request');

module.exports = {};

module.exports.checkAuth = function (config, options, url) {
    url = module.exports.rewriteUrl(url);
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

module.exports.getAuthUrl = function(config, url) {
    var options = {};
    module.exports.checkAuth(config, options, url);
    var parsedUrl = urlLib.parse(url);
    if(!parsedUrl.auth && options.auth) {
        parsedUrl.auth = `${options.auth.user}:${options.auth.pass}`
    }
    return parsedUrl.format();
};

module.exports.checkVersion = function (version) {
    if (version && version[0] >= '0' && version[0] <= '9' && !version.startsWith('v')) version = 'v' + version;
    return version;
};

module.exports.cacheUrl = function (config, url, addExtension) {
    var options = {};

    // Add authentification if necessary
    module.exports.checkAuth(config, options, url);

    var writePath = module.exports.getLocalUrl(config, url, config.dir, addExtension);
    url = module.exports.rewriteUrl(url, addExtension);
    if (config.selfContained) {
        return writeFile(url, writePath, options)
            .then(null, function () {
                return writeFile(url + '.js', writePath + '.js', options);
            })
            .catch(function (err) {
                console.error('error fetching file', url, err);
            });
    } else {
        return Promise.resolve();
    }
};

module.exports.cacheDir = function (config, url, addExtension) {
    return new Promise(function(resolve) {
        var prom = [];
        var options = {};
        // Add authentification if necessary
        module.exports.checkAuth(config, options, url);
        request.get(urlLib.resolve(url, 'files.txt'), options, function (err, res) {
            if (res && res.statusCode === 200) {
                let files = res.body.split('\n').filter(function (val) {
                    return val;
                });
                prom = files.map(function (file) {
                    return module.exports.cacheUrl(config, urlLib.resolve(url, file), addExtension);
                });
                return resolve(Promise.all(prom));
            } else {
                console.error(err);
                return resolve();
            }
        });
    });
};

module.exports.getLocalUrl = function (config, url, reldir, addExtension) {
    url = url.replace(/^\/\//, 'https://');
    console.log(url);
    var parsedUrl = urlLib.parse(url);
    var parsedPath = path.parse(parsedUrl.path);

    var p = path.join(config.libFolder, parsedUrl.hostname, parsedUrl.path);
    console.log(parsedUrl.path);
    if (addExtension) {
        p += parsedPath.ext ? '' : '.js';
    }
    return path.join(reldir, p);
};

module.exports.fromVisuLocalUrl = function (config, url) {
    url = url.replace(/^\/\//, 'https://');
    var localUrl = module.exports.getLocalUrl(config, url, '.', false);
    // Remove js extension
    localUrl = localUrl.replace(/\.js$/, '');
    return path.join('../../../..', localUrl);
};

module.exports.rewriteUrl = function (url, addExtension) {
    url = url.replace(/^\/\//, 'https://');
    if (!addExtension) {
        return url;
    }
    var parsedUrl = urlLib.parse(url);
    var parsedPath = path.parse(parsedUrl.path);
    return parsedPath.ext ? url : url + '.js';
};

