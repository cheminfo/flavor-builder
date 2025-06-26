import path from 'node:path';
import process from 'node:process';

import minimist from 'minimist';

import { getAuthorizationHeader } from './auth.js';

const args = minimist(process.argv.slice(2));

/**
 * Build the final configuration object.
 * @param  {string|object} configArg - The path to the config file or the config object itself.
 * @returns {*} The final configuration object.
 */
export async function buildConfig(configArg = 'config.json') {
  let config;
  if (typeof configArg === 'string') {
    let configFile = path.resolve(configArg);

    const { default: jsonConfig } = await import(configFile, {
      with: { type: 'json' },
    });
    config = jsonConfig;
  } else if (typeof configArg === 'object') {
    // Make sure we have another reference
    // To avoid the config being changed from
    // outside during a build
    config = structuredClone(configArg);
  } else {
    throw new TypeError('Incorrect argument');
  }
  // Config given in the command line takes precedence
  for (let key in args) {
    config[key] = args[key];
  }

  checkConfig(config);

  if (process.env.COUCHDB_USER) {
    config.couchUsername = process.env.COUCHDB_USER;
    config.couchPassword = process.env.COUCHDB_PASSWORD;
  }

  if (!config.revisionByIdPath) {
    config.revisionByIdPath = path.resolve(
      import.meta.dirname,
      '../revisionById.json',
    );
  }

  if (!config.md5Path) {
    config.md5Path = path.resolve(import.meta.dirname, '../md5.json');
  }

  config.fetchReqOptions = config.couchPassword
    ? {
        headers: {
          ...getAuthorizationHeader(config.couchUsername, config.couchPassword),
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
      config.layouts[key] = path.resolve(
        import.meta.dirname,
        '../layout',
        config.layouts[key],
      );
    }
  }

  config.rocLogin = config.rocLogin || {};

  config.designDoc = config.designDoc || 'customApp';

  return config;
}

function checkConfig(config) {
  if (typeof config !== 'object') {
    throw new TypeError('Config must be an object');
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
}
