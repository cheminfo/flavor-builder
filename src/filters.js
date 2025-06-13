import path from 'node:path';

import { cacheUrl, checkVersion, getLocalUrl, rewriteUrl } from './utils.js';

function concat(a, b) {
  if (b === undefined) return a;
  return a + b;
}

export function getFilters(config) {
  let plist = [];

  function processUrl(url, reldir, flavorName) {
    if (!config.isSelfContained(flavorName)) {
      // We return the original url
      return url;
    }

    url = rewriteUrl(url);
    plist.push(cacheUrl(config, url, flavorName));
    return getLocalUrl(config, url, reldir);
  }

  function visualizer(version, reldir, flavorName) {
    if (!config.isSelfContained(flavorName)) return null;
    version = checkVersion(version);
    let visualizerUrl = `${config.cdn}/visualizer`.replace(/^\/\//, 'https://');
    const parsedUrl = new URL(visualizerUrl);

    return path.join(
      reldir,
      config.libFolder,
      parsedUrl.hostname,
      parsedUrl.path,
      version,
    );
  }

  let r = {
    concat,
    processUrl,
    visualizer,
  };

  Object.defineProperty(r, 'plist', {
    enumerable: false,
    value: plist,
  });
  return r;
}
