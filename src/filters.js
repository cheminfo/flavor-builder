'use strict';

var config = require('./config');
var request = require('request');
var path = require('path');
var urlLib = require('url');
var fs = require('fs-extra');
var writeFile = require('./writeFile');
var utils = require('./utils');

function filters(config) {
    var versions = {};

    function concat(a, b) {
        if (b === undefined) return a;
        return a + b;
    }

    function processUrl(url, reldir) {
        var options = {};

        url = url.replace(/^\/\//, 'https://');
        var parsedUrl = urlLib.parse(url);

        // Add authentification if necessary
        utils.checkAuth(config, options, url);

        var p = path.join(config.libFolder, parsedUrl.hostname, parsedUrl.path);
        var loc = path.join(reldir, p);
        var writePath = path.join(config.dir, p);
        if (config.selfContained) {
            writeFile(url, writePath, options).catch(function (err) {
                console.error('error copying file', err.stack);
            });
            // We return the relative path;
            return loc;
        } else {
            // We return an external url
            return url;
        }
    }



    function copyVisualizer(version, reldir) {
        if (!config.selfContained) return;
        version = utils.checkVersion(version);
        let visualizerUrl = (config.cdn + '/visualizer').replace(/^\/\//, 'https://');
        let parsedUrl = urlLib.parse(visualizerUrl);

        return path.join(reldir, config.libFolder, parsedUrl.hostname, parsedUrl.path, version);
    }

    return {
        concat: concat,
        processUrl: processUrl,
        copyVisualizer: copyVisualizer
    };
}

exports = module.exports = filters;