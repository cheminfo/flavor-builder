'use strict';

var fs = require('fs-extra');
var prom = Promise.resolve();
var request = require('request');
var path = require('path');

exports = module.exports = function (url, p, options) {
    options = options || {};
    prom = prom.then(function () {
        return new Promise(function (resolve, reject) {
            if (fs.existsSync(p)) {
                return resolve();
            }
            fs.mkdirpSync(path.parse(p).dir);
            var read = request.get(url, options);
            var write = fs.createWriteStream(p);

            read.pipe(write);

            read.on('error', function(e) {
                reject(e);
            });

            write.on('error', function(e) {
                reject(e);
            });

            write.on('finish', function() {
                resolve();
            });
        });
    });
    return prom;
};