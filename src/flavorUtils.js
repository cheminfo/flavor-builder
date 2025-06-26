import crypto from 'node:crypto';

import FlavorUtils from 'flavor-utils';

import log from './log.js';

export class FlavorHelper {
  constructor(config) {
    this.utils = new FlavorUtils({
      username: config.flavorUsername,
      couchUrl: config.couchLocalUrl,
      couchDatabase: config.couchDatabase,
      couchUsername: config.couchUsername,
      couchPassword: config.couchPassword,
      designDoc: config.designDoc,
    });
  }

  getFlavor(flavor) {
    // Returns list of documents in a given flavor
    return this.utils.getFlavor({ flavor }, true);
  }

  async hasFlavor(flavor) {
    let flavors = await this.getFlavors();
    if (!flavors) {
      return false;
    }
    let flavorIdx = flavors.indexOf(flavor);
    return flavorIdx !== -1;
  }

  getFlavorMD5(flavors) {
    if (Array.isArray(flavors)) {
      let prom = [];
      for (let i = 0; i < flavors.length; i++) {
        prom.push(this.getFlavorMD5(flavors[i]));
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
