import { FlavorHelper } from './FlavorHelper.js';
import { createOrReadJson, writeJsonSync } from './fs.js';
import log from './log.js';

export class RevisionHelper {
  constructor(config) {
    this.config = config;
    this.revisionById = createOrReadJson(config.revisionByIdPath);
    this.flavorHelper = new FlavorHelper(config);
  }

  updateRevision(cb, flavorName) {
    return (el) => {
      log.logProcess('process view', el, flavorName);

      let prom = cb(el);
      if (!this.revisionById[flavorName]) this.revisionById[flavorName] = {};
      this.revisionById[flavorName][el.__id] = {
        rev: el.__rev,
        name: el.__name,
      };
      writeJsonSync(this.config.revisionByIdPath, this.revisionById);
      return prom;
    };
  }

  checkRevisionChanged(cb, flavorName) {
    return (el) => {
      log.trace(
        `evaluating if revision changed - flavor: ${flavorName}, id:${el.__id}`,
      );
      let prom = Promise.resolve();
      let id = el.__id;
      let rev = el.__rev;
      if (
        this.config.forceUpdate ||
        !this.revisionById[flavorName] ||
        !this.revisionById[flavorName][id] ||
        this.revisionById[flavorName][id].rev !== rev
      ) {
        log.logProcess('process view', el, flavorName);
        prom = cb(el);
        if (!this.revisionById[flavorName]) this.revisionById[flavorName] = {};
        this.revisionById[flavorName][el.__id] = {
          rev: el.__rev,
          name: el.__name,
        };
        writeJsonSync(this.config.revisionByIdPath, this.revisionById);
      }
      return prom;
    };
  }

  /**
   * Checks if the views have been updated in a way which needs to regenerate the menu.
   * The menu needs updating if there are new views, views which name has changed, or deleted views.
   * @param {object} tree - The tree of views to check for changes
   * @param {string} flavorName - The name of the flavor we are processing
   * @returns {Promise<boolean>} Returns true if there are changes impacting the menu.
   */
  async menuNeedsUpdate(tree, flavorName) {
    const flavorIds = new Set();
    let menuNeedsUpdate = false;

    await this.flavorHelper.utils.traverseTree(tree, (el) => {
      flavorIds.add(el.__id);
      if (
        !this.revisionById[flavorName] ||
        !this.revisionById[flavorName][el.__id]
      ) {
        // The view is new
        log.trace('view is new');
        menuNeedsUpdate = true;
      } else if (this.revisionById[flavorName][el.__id].name !== el.__name) {
        // The name has changed
        log.trace('view name has changed');
        menuNeedsUpdate = true;
      }
    });

    // Remove deleted views
    const savedIds = this.revisionById[flavorName]
      ? Object.keys(this.revisionById[flavorName])
      : [];
    for (let savedId of savedIds) {
      if (!flavorIds.has(savedId)) {
        log.trace('view was deleted');
        menuNeedsUpdate = true;
        delete this.revisionById[flavorName][savedId];
      }
    }

    writeJsonSync(this.config.revisionByIdPath, this.revisionById);

    return menuNeedsUpdate;
  }
}
