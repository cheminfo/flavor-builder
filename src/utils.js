import path from 'node:path';
import urlLib from 'node:url';

import request from 'request';

import { writeFile } from './writeFile.js';

export function checkAuth(config, options, url) {
  url = rewriteUrl(url);
  let parsedUrl = new URL(url);
  if (config.httpAuth && config.httpAuth[parsedUrl.hostname]) {
    options.auth = {
      user: config.httpAuth[parsedUrl.hostname].user,
      pass: config.httpAuth[parsedUrl.hostname].pass,
      sendImmediately: true,
    };
  }
  return options;
}

export function getAuthUrl(config, url) {
  let options = {};
  checkAuth(config, options, url);
  let parsedUrl = new URL(url);
  if (!parsedUrl.auth && options.auth) {
    parsedUrl.auth = `${options.auth.user}:${options.auth.pass}`;
  }
  return parsedUrl.format();
}

export function checkVersion(version) {
  if (
    version &&
    version[0] >= '0' &&
    version[0] <= '9' &&
    !version.startsWith('v')
  ) {
    version = `v${version}`;
  }
  return version;
}

export function cacheUrl(config, url, flavorName, addExtension) {
  let options = {
    encoding: null,
  };

  // Add authentification if necessary
  checkAuth(config, options, url);

  let writePath = getLocalUrl(config, url, config.dir, addExtension);
  url = rewriteUrl(url, addExtension);
  if (config.isSelfContained(flavorName)) {
    return writeFile(url, writePath, options)
      .then(null, () => {
        return writeFile(`${url}.js`, `${writePath}.js`, options);
      })
      .catch((error) => {
        console.error('error fetching file', url, error);
      });
  } else {
    return Promise.resolve();
  }
}

export function cacheDir(config, url, flavorName, addExtension) {
  return new Promise((resolve) => {
    let prom = [];
    let options = {};
    // Add authentification if necessary
    checkAuth(config, options, url);
    request.get(urlLib.resolve(url, 'files.txt'), options, (err, res) => {
      if (res && res.statusCode === 200) {
        let files = res.body.split('\n').filter(Boolean);
        prom = files.map((file) => {
          return cacheUrl(
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
}

export function getLocalUrl(config, url, reldir, addExtension) {
  url = url.replace(/^\/\//, 'https://');
  let parsedUrl = new URL(url);
  let parsedPath = path.parse(parsedUrl.path);

  let p = path.join(config.libFolder, parsedUrl.hostname, parsedUrl.path);
  if (addExtension) {
    p += parsedPath.ext ? '' : '.js';
  }
  return path.join(reldir, p);
}

export function fromVisuLocalUrl(config, url) {
  url = url.replace(/^\/\//, 'https://');
  let localUrl = getLocalUrl(config, url, '.', false);
  // Never put js extension when local url
  localUrl = localUrl.replace(/\.js$/, '');
  return path.join('../../../..', localUrl);
}

export function rewriteUrl(url, addExtension) {
  url = url.replace(/^\/\//, 'https://');
  if (!addExtension) {
    return url;
  }
  let parsedUrl = new URL(url);
  let parsedPath = path.parse(parsedUrl.path);
  return parsedPath.ext ? url : `${url}.js`;
}
