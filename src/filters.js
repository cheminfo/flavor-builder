'use strict';

var config = require('./config');
var request = require('request');
var path = require('path');
var urlLib = require('url');
var fs = require('fs-extra');
var writeFile = require('./writeFile');
var targz = require('tar.gz');

var versions = {};

function concat(a, b) {
    if(b === undefined) return a;
    return a + b;
}

function processUrl(url, reldir) {
    url = url.replace(/^\/\//, 'https://');
    var parsedUrl = urlLib.parse(url);
    var p = path.join('lib', parsedUrl.hostname, parsedUrl.path);
    var loc = path.join(reldir, p);
    var writePath = path.join(config.dir, p);
    if (config.selfContained) {
        writeFile(url, writePath).catch(function(err) {
            console.error('error copying file', err.stack);
        });
        // We return the relative path;
        return loc;
    } else {
        // We return an external url
        return url;
    }
}

function cdnVisualizer(version, reldir) {
    if (version && version[0] >= '0' && version[0] <= '9' && !version.startsWith('v')) version = 'v' + version;
    var loc = path.join(reldir, 'visualizer', version);
    var prefix = path.join(config.dir, 'visualizer');
    var versionDir = path.join(config.dir, 'visualizer', version);
    if(!versions[version]) {
        try {
            fs.lstatSync(versionDir);
        } catch(e) {
            fs.mkdirpSync(versionDir);
            console.log('copying visualizer', version);
            versions[version] = true;
            var url = config.cdn + '/visualizer/' + version + '.tar.gz';


            var read = request.get(url);
            var parse = targz().createParseStream();


            parse.on('entry', function (entry) {
                //console.log(Object.keys(entry));
                //console.log(entry.path);

                var p = path.join(prefix, entry.path);
                if (p.endsWith('/')) {
                    fs.mkdirpSync(p);
                } else {
                    var write = fs.createWriteStream(p);
                    entry.pipe(write);
                }
            });

            parse.on('error', function (err) {
                console.warn('visualizer ' + version + ' failed to be downloaded');
                //console.log(err);
            });
            read.pipe(parse);
        }
    }


    return loc;
}

exports = module.exports = {
    concat: concat,
    processUrl: processUrl,
    cdnVisualizer: cdnVisualizer
};