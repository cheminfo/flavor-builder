'use strict';

var fs = require('fs-extra');
var request = require('request');
var path = require('path');

var filesWriting = {};

exports = module.exports = function (url, p, options) {
    options = options || {};
    return new Promise(function (resolve, reject) {
        if(filesWriting[p]) {
            return resolve(true);
        }
        filesWriting[p] = true;

        if (fs.existsSync(p)) {
            return resolve();
        }
        fs.mkdirpSync(path.parse(p).dir);
        var read = request.get(url, options);


        read.on('response', function (res) {
            if (res.statusCode !== 200) {
                console.log(res.statusCode, url);
                return reject(new Error('Got an error code !== 200'))
            }

            console.log('pipe', url);
            var write = fs.createWriteStream(p);
            write.on('error', function (e) {
                reject(e);
            });

            write.on('finish', function () {
                resolve();
            });
            read.pipe(write);
        });

        read.on('error', function (e) {
            reject(e);
        });


    })
};