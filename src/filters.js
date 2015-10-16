'use strict';

var config = require('./config');
var request = require('request');
var path = require('path');
var urlLib = require('url');
var fs = require('fs-extra');
var writeFile = require('./writeFile');
var utils = require('./utils');

function filters(config) {

    function concat(a, b) {
        if (b === undefined) return a;
        return a + b;
    }

    function processUrl(url, reldir) {
       if(!config.selfContained) {
           // We return the original url
           return url;
        }

        url = url.replace(/^\/\//, 'https://');
        utils.cacheUrl(config, url);
        return getLocalUrl(url, reldir);
    }

    function getLocalUrl(url, reldir) {
        url = url.replace(/^\/\//, 'https://');
        var parsedUrl = urlLib.parse(url);

        var p = path.join(config.libFolder, parsedUrl.hostname, parsedUrl.path);
        return path.join(reldir, p);
    }



    function visualizer(version, reldir) {
        if (!config.selfContained) return;
        version = utils.checkVersion(version);
        let visualizerUrl = (config.cdn + '/visualizer').replace(/^\/\//, 'https://');
        let parsedUrl = urlLib.parse(visualizerUrl);

        return path.join(reldir, config.libFolder, parsedUrl.hostname, parsedUrl.path, version);
    }

    return {
        concat: concat,
        getLocalUrl: getLocalUrl,
        processUrl: processUrl,
        visualizer: visualizer
    };
}

exports = module.exports = filters;