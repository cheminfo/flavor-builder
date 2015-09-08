'use strict';

var fs = require('fs-extra');
var prom = Promise.resolve();
var request = require('request');
var path = require('path');

exports = module.exports = function (url, p) {
    prom = prom.then(function () {
        return new Promise(function (resolve, reject) {
            if (fs.existsSync(p)) {
                return resolve();
            }
            fs.mkdirpSync(path.parse(p).dir);
            var read = request.get(url);
            var write = fs.createWriteStream(p);

            read.pipe(write);

            read.on('error', function() {
                reject();
            });

            write.on('error', function() {
                reject();
            });

            write.on('finish', function() {
                resolve();
            });
        });
    });
    return prom;
};