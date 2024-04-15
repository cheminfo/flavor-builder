'use strict';

const path = require('path');

const _ = require('lodash');
const minimist = require('minimist');

const args = minimist(process.argv.slice(2));
exports = module.exports = function buildConfig (configArg) {
  configArg = configArg || 'config.json';
  let config;
  if (typeof configArg === 'string') {
    let configFile = path.resolve(configArg);
    config = require(configFile);
  } else if (typeof configArg === 'object') {
    // Make sure we have another reference
    // To avoid the config being changed from
    // outside during a build
    config = _.cloneDeep(configArg);
  } else {
    throw new TypeError('Incorrect argument');
  }
  // Config given in the command line takes precendence
  for (let key in args) {
    config[key] = args[key];
  }

  // Check mandatory parameters
  let mandatory = [
    'dir',
    'cdn',
    'direct',
    'home',
    'couchurl',
    'couchLocalUrl',
    'flavorUsername',
    'couchDatabase',
    'layouts',
    'libFolder',
  ];
  for (let i = 0; i < mandatory.length; i++) {
    if (config[mandatory[i]] === undefined) {
      throw new Error(`${mandatory[i]} is mandatory`);
    }
  }

  if (process.env.COUCHDB_USER) {
    config.couchUsername = process.env.COUCHDB_USER;
    config.couchPassword = process.env.COUCHDB_PASSWORD;
  }

  if (!config.revisionByIdPath) {
    config.revisionByIdPath = path.resolve(__dirname, '../revisionById.json');
  }

  if (!config.md5Path) {
    config.md5Path = path.resolve(__dirname, '../md5.json');
  }

  config.couchReqOptions = config.couchPassword
    ? {
        auth: {
          user: config.couchUsername,
          pass: config.couchPassword,
          sendImmediately: true,
        },
      }
    : {};

  config.couchurl = config.couchurl.replace(/\/$/, '');
  if (config.rootUrl) {
    config.rootUrl = config.rootUrl.replace(/\/$/, '');
  }

  if (config.couchLocalUrl) {
    config.couchLocalUrl = config.couchLocalUrl.replace(/\/$/, '');
  }
  config.dir = path.resolve(config.dir);
  config.flavorLayouts = config.flavorLayouts || {};
  if (config.layouts) {
    for (let key in config.layouts) {
      config.layouts[key] = path.join(
        __dirname,
        '../layout',
        config.layouts[key],
      );
    }
  }

  config.isSelfContained = (flavor) => {
    if (!config.selfContained) return false;
    else if (config.selfContained === true) return true;
    else return config.selfContained[flavor];
  };

  config.rocLogin = config.rocLogin || {};

  config.designDoc = config.designDoc || 'customApp';

  return config;
};
