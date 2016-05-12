'use strict';

var config = require('./config');
var request = require('request');
var path = require('path');
var urlLib = require('url');
var fs = require('fs-extra');
var writeFile = require('./writeFile');
var utils = require('./utils');



function filters(config) {
    var plist = [];

    function concat(a, b) {
        if (b === undefined) return a;
        return a + b;
    }

    function processUrl(url, reldir, flavorName) {
       if(!config.isSelfContained(flavorName)) {
           // We return the original url
           return url;
        }

        url = utils.rewriteUrl(url);
        plist.push(utils.cacheUrl(config, url, flavorName));
        return utils.getLocalUrl(config, url, reldir);
    }





    function visualizer(version, reldir, flavorName) {
        console.log('visualizer', flavorName);
        if (!config.isSelfContained(flavorName)) return;
        version = utils.checkVersion(version);
        let visualizerUrl = (config.cdn + '/visualizer').replace(/^\/\//, 'https://');
        let parsedUrl = urlLib.parse(visualizerUrl);

        return path.join(reldir, config.libFolder, parsedUrl.hostname, parsedUrl.path, version);
    }

    var r = {
        concat: concat,
        processUrl: processUrl,
        visualizer: visualizer
    };

    Object.defineProperty(r, 'plist',{
        enumerable: false,
        value: plist
    });
    return r;
}

exports = module.exports = filters;