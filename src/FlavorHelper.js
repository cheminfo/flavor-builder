import crypto from 'node:crypto';

import FlavorUtils from 'flavor-utils';

import { createOrReadJson, writeJsonSync } from './fs.js';
import log from './log.js';

export class FlavorHelper {
  constructor(config) {
    this.config = config;
    this.utils = new FlavorUtils({
      username: config.flavorUsername,
      couchUrl: config.couchLocalUrl,
      couchDatabase: config.couchDatabase,
      couchUsername: config.couchUsername,
      couchPassword: config.couchPassword,
      designDoc: config.designDoc,
    });
    this.md5 = createOrReadJson(config.md5Path);
  }

  getFlavor(flavor) {
    // Returns list of documents in a given flavor
    return this.utils.getFlavor({ flavor }, true);
  }

  // Get which flavors have changed since the last time we checked, based on hashes.
  async getChangedFlavors() {
    log.info('getting changed flavors');
    let flavors = await this.getFlavors();

    return this.#getFlavorMD5(flavors).then((result) => {
      if (this.config.forceUpdate) {
        log.info('force update, no flavor filtering');
        return Object.keys(result);
      }
      if (JSON.stringify(this.md5) === '{}') {
        writeJsonSync(this.config.md5Path, result);
        return Object.keys(result);
      }
      let keys = [];
      const newMd5 = structuredClone(this.md5);
      for (let key in result) {
        if (result[key] !== this.md5[key]) {
          log.trace(`flavor ${key} has changed, add to the list`);
          newMd5[key] = result[key];
          keys.push(key);
        } else {
          log.trace(`flavor ${key} has not changed, ignoring it`);
        }
      }
      writeJsonSync(this.config.md5Path, newMd5);
      return keys;
    });
  }

  async hasFlavor(flavor) {
    let flavors = await this.getFlavors();
    if (!flavors) {
      return false;
    }
    let flavorIdx = flavors.indexOf(flavor);
    return flavorIdx !== -1;
  }

  #getFlavorMD5(flavors) {
    if (Array.isArray(flavors)) {
      let prom = [];
      for (let i = 0; i < flavors.length; i++) {
        prom.push(this.#getFlavorMD5(flavors[i]));
      }
      return Promise.all(prom).then((md5s) => {
        let result = {};
        for (let j = 0; j < md5s.length; j++) {
          result[flavors[j]] = md5s[j];
        }
        return result;
      });
    } else {
      return this.utils.getFlavor({ flavor: flavors }, false).then(
        (result) => {
          return crypto
            .createHash('md5')
            .update(JSON.stringify(result.rows))
            .digest('hex');
        },
        (error) => {
          throw error;
        },
      );
    }
  }

  getFlavors() {
    log.trace('get list of flavors');
    return this.utils.getFlavors().then((flavors) => {
      return processFlavors(flavors);
    });
  }
}

function processFlavors(data) {
  let result;
  if (data && Array.isArray(data.rows)) {
    result = data.rows.flat();
    result = result.flatMap((r) => r.value);
  }
  return result;
}
