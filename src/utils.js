'use strict';

let path = require('path');
let urlLib = require('url');

let request = require('request');

let writeFile = require('./writeFile');

module.exports.checkAuth = function checkAuth (config, options, url) {
  url = module.exports.rewriteUrl(url);
  let parsedUrl = urlLib.parse(url);
  if (config.httpAuth && config.httpAuth[parsedUrl.hostname]) {
    options.auth = {
      user: config.httpAuth[parsedUrl.hostname].user,
      pass: config.httpAuth[parsedUrl.hostname].pass,
      sendImmediately: true,
    };
  }
  return options;
};

module.exports.getAuthUrl = function getAuthUrl(config, url) {
  let options = {};
  module.exports.checkAuth(config, options, url);
  let parsedUrl = urlLib.parse(url);
  if (!parsedUrl.auth && options.auth) {
    parsedUrl.auth = `${options.auth.user}:${options.auth.pass}`;
  }
  return parsedUrl.format();
};

module.exports.checkVersion = function checkVersion(version) {
  if (
    version &&
    version[0] >= '0' &&
    version[0] <= '9' &&
    !version.startsWith('v')
  ) {
    version = `v${version}`;
  }
  return version;
};

module.exports.cacheUrl = function cacheUrl(config, url, flavorName, addExtension) {
  let options = {
    encoding: null,
  };

  // Add authentification if necessary
  module.exports.checkAuth(config, options, url);

  let writePath = module.exports.getLocalUrl(
    config,
    url,
    config.dir,
    addExtension,
  );
  url = module.exports.rewriteUrl(url, addExtension);
  if (config.isSelfContained(flavorName)) {
    return writeFile(url, writePath, options)
      .then(null, ()=> {
        return writeFile(`${url}.js`, `${writePath}.js`, options);
      })
      .catch((err) => {
        console.error('error fetching file', url, err);
      });
  } else {
    return Promise.resolve();
  }
};

module.exports.cacheDir = function cacheDir(config, url, flavorName, addExtension) {
  return new Promise((resolve) => {
    let prom = [];
    let options = {};
    // Add authentification if necessary
    module.exports.checkAuth(config, options, url);
    request.get(urlLib.resolve(url, 'files.txt'), options, (err, res) => {
      if (res && res.statusCode === 200) {
        let files = res.body.split('\n').filter((val) => {
          return val;
        });
        prom = files.map((file) => {
          return module.exports.cacheUrl(
            config,
            urlLib.resolve(url, file),
            flavorName,
            addExtension,
          );
        });
        return resolve(Promise.all(prom));
      } else {
        console.error(err);
        return resolve();
      }
    });
  });
};

module.exports.getLocalUrl = function getLocalUrl(config, url, reldir, addExtension) {
  url = url.replace(/^\/\//, 'https://');
  let parsedUrl = urlLib.parse(url);
  let parsedPath = path.parse(parsedUrl.path);

  let p = path.join(config.libFolder, parsedUrl.hostname, parsedUrl.path);
  if (addExtension) {
    p += parsedPath.ext ? '' : '.js';
  }
  return path.join(reldir, p);
};

module.exports.fromVisuLocalUrl = function fromVisuLocalUrl(config, url) {
  url = url.replace(/^\/\//, 'https://');
  let localUrl = module.exports.getLocalUrl(config, url, '.', false);
  // Never put js extension when local url
  localUrl = localUrl.replace(/\.js$/, '');
  return path.join('../../../..', localUrl);
};

module.exports.rewriteUrl = function rewriteUrl(url, addExtension) {
  url = url.replace(/^\/\//, 'https://');
  if (!addExtension) {
    return url;
  }
  let parsedUrl = urlLib.parse(url);
  let parsedPath = path.parse(parsedUrl.path);
  return parsedPath.ext ? url : `${url}.js`;
};
