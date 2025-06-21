import Buffer from 'node:buffer';
import path from 'node:path';
import urlLib from 'node:url';

import { writeFile } from './writeFile.js';

export function checkAuth(config, options, url) {
  url = rewriteUrl(url);
  let parsedUrl = new URL(url);
  if (config.httpAuth && config.httpAuth[parsedUrl.hostname]) {
    options.headers = {
      ...getAuthorizationHeader(
        config.httpAuth[parsedUrl.hostname].user,
        config.httpAuth[parsedUrl.hostname].pass,
      ),
    };
  }
  return options;
}

export function getAuthorizationHeader(username, password) {
  return {
    Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString(
      'base64',
    )}`,
  };
}

export function getAuthUrl(config, url) {
  let options = {};
  checkAuth(config, options, url);
  let parsedUrl = new URL(url);
  if (!parsedUrl.password && options.auth) {
    parsedUrl.username = options.auth.user;
    parsedUrl.password = options.auth.pass;
  }
  return parsedUrl.toString();
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
  const options = {};

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

export async function cacheDir(config, url, flavorName, addExtension) {
  let prom = [];
  let options = {};
  // Add authentification if necessary
  checkAuth(config, options, url);
  try {
    const response = await fetch(urlLib.resolve(url, 'files.txt'), options);
    if (response.status !== 200) {
      console.error(
        'cacheDir: Failed to fetch files.txt from',
        url,
        'with status',
        response.statusText,
      );
      return;
    }
    const txtResponse = await response.text();
    const files = txtResponse.split('\n').filter(Boolean);
    prom = files.map((file) => {
      return cacheUrl(
        config,
        urlLib.resolve(url, file),
        flavorName,
        addExtension,
      );
    });
    return Promise.all(prom);
  } catch (error) {
    console.error(error);
  }
}

export function getLocalUrl(config, url, reldir, addExtension) {
  url = url.replace(/^\/\//, 'https://');
  let parsedUrl = new URL(url);
  let parsedPath = path.parse(parsedUrl.pathname);

  let p = path.join(config.libFolder, parsedUrl.hostname, parsedUrl.pathname);
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
  let parsedPath = path.parse(parsedUrl.pathname);
  return parsedPath.ext ? url : `${url}.js`;
}
