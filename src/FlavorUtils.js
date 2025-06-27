import { getAuthorizationHeader } from './auth.js';

/**
 * General options object
 * @typedef {object} options
 * @property {string} flavorUsername - The target username to which to clone the flavor
 * @property {string} designDoc - The design doc to use for views and list queries - Defaults to 'flavor'
 * @property {string} flavor - The name of the flavor in the target
 * @property {string} couchLocalUrl - Couchdb root url of the target. It can contain username + password if but will be overriden if couchUsername and couchPassword are defined
 * @property {string} couchDatabase - the name of the target couchdb database
 * @property {string} couchUsername - the username with which to connect to the couchdb database
 * @property {string} couchPassword - the password with which to connect to the couchdb database
 */

/**
 * This is a description of the MyClass constructor function.
 * @class
 * @classdesc FlavorUtils class
 */
export class FlavorUtils {
  /**
   * Constructor
   * @param {options} options - Default options
   */
  constructor(options) {
    this.options = structuredClone(options);
    if (this.options.couchLocalUrl && this.options.couchDatabase) {
      this.options.databaseUrl = `${this.options.couchLocalUrl}/${this.options.couchDatabase}`;
    }
  }

  getFlavors() {
    return getView(this.options, `app/list`, this.options.flavorUsername);
  }

  /**
   * Get meta info about documents in a flavor
   * @param {string} flavorName - The name of the flavor for which to get the list of views for.
   * @param {boolean} sorted - Set to true if documents should be sorted by flavors
   * @returns {Promise<any>} - A list of documents in the flavor.
   */
  getFlavor(flavorName, sorted) {
    sorted = sorted === undefined ? true : sorted;
    let key = [flavorName, this.options.flavorUsername];
    if (sorted) {
      return getList(this.options, `app/sort`, 'docs', key);
    }
    return getView(this.options, `app/docs`, key);
  }

  /**
   * Get document tree hierarchy for a flavor
   * @param {any[]} rows - Result from `getFlavor`
   * @returns {Promise<any>} - A tree structure representing the hierarchy of documents in the flavor.
   */
  getTree(rows) {
    let row;
    let structure = {};
    Object.defineProperty(structure, '__root', {
      enumerable: false,
      writable: true,
      value: true,
    });
    for (let i = 0; i < rows.length; i++) {
      row = rows[i];
      let flavors = row.value.flavors;
      doElement(flavors, structure, row.value);
    }
    return structure;
  }

  /**
   * Traverse a tree
   * @param {object} tree - A tree such as returned by getTree
   * @param {Function} viewCb - A callback called on each view
   * @param {Function} dirCb - A callback called on each 'directory'
   * @returns {Promise<void>} -
   */
  async traverseTree(tree, viewCb, dirCb) {
    for (let key in tree) {
      if (key.startsWith('__')) continue;
      let el = tree[key];
      if (el.__id) {
        // Element is a view
        if (viewCb) {
          await viewCb(el);
        }
      } else if (key !== '__root') {
        // Element is a directory
        if (dirCb) {
          await dirCb(el);
        }

        await this.traverseTree(el, viewCb, dirCb);
      }
    }
  }
}

function getView(opts, view, key) {
  let x = view.split('/');
  let designDoc = `_design/${x[0]}`;
  let viewName = x[1];

  return getJSON(
    `${opts.databaseUrl}/${designDoc}/_view/${viewName}?key=${encodeURIComponent(JSON.stringify(key))}`,
    opts,
  );
}

function getList(opts, list, view, key) {
  let x = list.split('/');
  let designDoc = `_design/${x[0]}`;
  let listName = x[1];

  return getJSON(
    `${opts.databaseUrl}/${designDoc}/_list/${listName}/${view}?key=${encodeURIComponent(JSON.stringify(key))}`,
    opts,
  );
}

async function getJSON(url, config) {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      ...getAuthorizationHeader(config),
    },
  });
  return response.json();
}

function doElement(flavors, current, row) {
  if (flavors.length === 0) {
    current.__data = row.data;
    current.__view = row.view;
    current.__id = row._id;
    current.__rev = row._rev;
    current.__version = row.version;
    current.__keywords = row.keywords;
    current.__meta = row.meta;
    current.__title = row.title;
    return;
  }

  let flavor = flavors.shift();
  if (!current[flavor]) {
    current[flavor] = {
      __name: flavor,
      __parents: current.__parents ? current.__parents.slice() : [],
      __parent: current,
    };
    if (current.__name) current[flavor].__parents.push(current.__name);
  }

  return doElement(flavors, current[flavor], row);
}
