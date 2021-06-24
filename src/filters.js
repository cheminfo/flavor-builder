'use strict';

let path = require('path');
let urlLib = require('url');

let utils = require('./utils');

function filters(config) {
  let plist = [];

  function concat(a, b) {
    if (b === undefined) return a;
    return a + b;
  }

  function processUrl(url, reldir, flavorName) {
    if (!config.isSelfContained(flavorName)) {
      // We return the original url
      return url;
    }

    url = utils.rewriteUrl(url);
    plist.push(utils.cacheUrl(config, url, flavorName));
    return utils.getLocalUrl(config, url, reldir);
  }

  function visualizer(version, reldir, flavorName) {
    if (!config.isSelfContained(flavorName)) return null;
    version = utils.checkVersion(version);
    let visualizerUrl = `${config.cdn}/visualizer`.replace(/^\/\//, 'https://');
    let parsedUrl = urlLib.parse(visualizerUrl);

    return path.join(
      reldir,
      config.libFolder,
      parsedUrl.hostname,
      parsedUrl.path,
      version,
    );
  }

  let r = {
    concat: concat,
    processUrl: processUrl,
    visualizer: visualizer,
  };

  Object.defineProperty(r, 'plist', {
    enumerable: false,
    value: plist,
  });
  return r;
}

exports = module.exports = filters;
