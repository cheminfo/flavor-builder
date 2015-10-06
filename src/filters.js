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
        var parsedUrl = urlLib.parse(url);

        var p = path.join(config.libFolder, parsedUrl.hostname, parsedUrl.path);
        var loc = path.join(reldir, p);
        utils.cacheUrl(config, url);
        return loc;
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
        processUrl: processUrl,
        visualizer: visualizer
    };
}

exports = module.exports = filters;