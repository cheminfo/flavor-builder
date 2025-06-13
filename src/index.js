import { exec } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsAsync from 'node:fs/promises';
import path from 'node:path';
import { URL } from 'node:url';

import FlavorUtils from 'flavor-utils';
import { isUndefined, uniq } from 'lodash-es';
import request from 'request';
import swig from 'swig';
import visualizerOnTabs from 'visualizer-on-tabs';

import { getFilters } from './filters.js';
import { readJsonSync, writeJsonSync } from './fs.js';
import { isLocked } from './isLocked.js';
import log from './log.js';
import {
  cacheDir,
  cacheUrl,
  checkVersion,
  fromVisuLocalUrl,
  getAuthUrl,
} from './utils.js';

const DEFAULT_FLAVOR = 'default';
const READ_CONFIG = './static/readConfig.json';

const pathCharactersRegExp = /[^A-Za-z0-9.-]/g;

function call(configArg) {
  let config,
    layouts,
    toCopy,
    toSwig,
    filters,
    flavorUtils,
    sitemaps,
    revisionById,
    md5;

  async function init(configArg) {
    const { buildConfig } = await import('./config.js');
    config = await buildConfig(configArg);
    if (config.pidFile) {
      let isProcessLocked = isLocked(
        path.resolve(path.join(import.meta.dirname, '..'), config.pidFile),
      );
      if (isProcessLocked) {
        throw new Error('flavor-builder already running');
      }
    }

    filters = getFilters(config);
    layouts = config.layouts;
    flavorUtils = new FlavorUtils({
      username: config.flavorUsername,
      couchUrl: config.couchLocalUrl,
      couchDatabase: config.couchDatabase,
      couchUsername: config.couchUsername,
      couchPassword: config.couchPassword,
      designDoc: config.designDoc,
    });
  }

  return {
    async build() {
      await init(configArg);
      return build();
    },
    async getFlavors() {
      await init(configArg);
      return getFlavors();
    },
  };

  async function build() {
    log.info('start build');
    revisionById = checkFile(config.revisionByIdPath);
    md5 = checkFile(config.md5Path);

    toCopy = [
      {
        src: path.join(import.meta.dirname, '../lib'),
        dest: path.join(config.dir, './lib'),
      },
      {
        src: path.join(import.meta.dirname, '../themes'),
        dest: path.join(config.dir, './themes'),
      },
      {
        src: path.join(import.meta.dirname, '../static'),
        dest: path.join(config.dir, './static'),
      },
    ];

    toSwig = [];

    for (let key in filters) {
      swig.setFilter(key, filters[key]);
    }

    try {
      sitemaps = readSiteMaps();
      log.trace('get versions');
      if (config.flavor) {
        // Build single flavor
        let exists = await hasFlavor(config.flavor);
        if (!exists) {
          log.info(`Flavor ${config.flavor} not found`);
          return;
        }
        log.trace('get flavor');
        if (config.flavorLayouts[config.flavor] === 'visualizer-on-tabs') {
          await handleVisualizerOnTabs(config.flavor);
        } else {
          await handleFlavor(config.flavor);
        }
        await Promise.all(filters.plist);
      } else {
        // Build all flavors
        // Get a list of all available flavors
        let flavors = await getFlavors();
        // Filter flavors to get only those that have changed
        flavors = await filterFlavorsByMd5(flavors);
        log.info(`Processing ${flavors.length} flavors: ${flavors}`);
        for (let i = 0; i < flavors.length; i++) {
          if (config.flavorLayouts[flavors[i]] === 'visualizer-on-tabs') {
            await handleVisualizerOnTabs(flavors[i]);
          } else {
            await handleFlavor(flavors[i]);
          }
          // Some swig filter are asynchronous, wait for them to finish
          await Promise.all(filters.plist);
        }
      }
      writeSiteMaps();
    } catch (error) {
      log.info('error occured', error);
    }
  }

  function readSiteMaps() {
    log.trace('write site maps');
    try {
      let r = {};
      let content = fs.readFileSync(
        path.join(config.dir, 'sitemap.txt'),
        'utf8',
      );
      for (let el of content.split('\n')) {
        el = el.replace(config.rootUrl, '');
        el = el.replace(/^\//, '');
        r[el] = true;
      }
      return r;
    } catch {
      return {};
    }
  }

  function writeSiteMaps() {
    if (!config.rootUrl) {
      log.info('No root url specified, not creating sitemap.txt');
      return;
    }
    log.trace('write site maps');
    fs.writeFileSync(
      path.join(config.dir, 'sitemap.txt'),
      Object.keys(sitemaps)
        .map((el) => `${config.rootUrl}/${el}`)
        .join('\n'),
    );
  }

  function pathFromDir(flavorName, p) {
    let basicPath = path.relative(config.dir, p);
    if (flavorName === DEFAULT_FLAVOR) {
      return basicPath;
    } else {
      return path.join('flavor', flavorName, basicPath);
    }
  }

  function getFlavorDir(flavorName, create) {
    let flavorDir;
    if (flavorName === DEFAULT_FLAVOR || flavorName === config.flavor) {
      flavorDir = config.dir;
    } else {
      flavorDir = path.join(config.dir, 'flavor', flavorName);
    }
    if (create) {
      fs.mkdirSync(flavorDir, { recursive: true });
    }
    return flavorDir;
  }

  async function handleVisualizerOnTabs(flavorName) {
    let viewsList = await getFlavor(flavorName);
    let viewTree = await flavorUtils.getTree(viewsList);
    const flavorDir = getFlavorDir(flavorName, true);

    const homePages = [];
    let tabsConfig =
      config.visualizerOnTabs && config.visualizerOnTabs[flavorName];
    if (!tabsConfig) tabsConfig = config.visualizerOnTabs._default;
    if (!tabsConfig) {
      throw new Error('No visualizer on tabs configuration found');
    }

    await flavorUtils.traverseTree(viewTree, (el) => {
      if (el.__name === config.home) {
        const outDir = path.join(flavorDir, el.__parents.join('/'));
        const indexPage = path.relative(
          config.dir,
          path.join(outDir, 'index.html'),
        );

        let customConfig = {
          possibleViews: {},
        };
        sitemaps[indexPage] = true;

        customConfig.possibleViews[el.__name] = {
          url: getViewUrl(el, 'public'),
          closable: false,
        };

        customConfig.possibleViews = Object.assign(
          customConfig.possibleViews,
          tabsConfig ? tabsConfig.possibleViews : {},
        );
        homePages.push({
          outDir,
          config: { ...tabsConfig, ...customConfig },
        });
      }
    });

    for (let i = 0; i < homePages.length; i++) {
      await visualizerOnTabs(homePages[i]);
    }
  }

  // returns an array of flavors for which the md5 has changed
  function filterFlavorsByMd5(flavors) {
    log.trace('filter flavors by md5');
    return getFlavorMD5(flavors).then((result) => {
      if (config.forceUpdate) {
        log.info('force update, no flavor filtering');
        return Object.keys(result);
      }
      if (JSON.stringify(md5) === '{}') {
        writeJsonSync(config.md5Path, result);
        return Object.keys(result);
      }
      let keys = [];
      for (let key in result) {
        if (result[key] !== md5[key]) {
          log.trace(`flavor ${key} has changed, add to the list`);
          md5[key] = result[key];
          keys.push(key);
        } else {
          log.trace(`flavor ${key} has not changed, ignoring it`);
        }
      }
      writeJsonSync(config.md5Path, md5);
      return keys;
    });
  }

  function getFlavors() {
    log.trace('get list of flavors');
    return flavorUtils.getFlavors().then((flavors) => {
      return processFlavors(flavors);
    });
  }

  function getFlavorMD5(flavors) {
    if (Array.isArray(flavors)) {
      let prom = [];
      for (let i = 0; i < flavors.length; i++) {
        prom.push(getFlavorMD5(flavors[i]));
      }
      return Promise.all(prom).then((md5s) => {
        let result = {};
        for (let j = 0; j < md5s.length; j++) {
          result[flavors[j]] = md5s[j];
        }
        return result;
      });
    } else {
      return flavorUtils.getFlavor({ flavor: flavors }, false).then(
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

  function getFlavor(flavor) {
    // Returns sorted flavor views
    return flavorUtils.getFlavor({ flavor }, true);
  }

  function getViewUrl(el, type) {
    return el.__view
      ? `${getCouchUrlByType(type)}/${config.couchDatabase}/${
          el.__id
        }/view.json?rev=${el.__rev}`
      : undefined;
  }

  function getDataUrl(el, type) {
    return el.__data
      ? `${getCouchUrlByType(type)}/${config.couchDatabase}/${
          el.__id
        }/data.json?rev=${el.__rev}`
      : undefined;
  }

  function getCouchUrlByType(type) {
    if (type === 'local') {
      return config.couchLocalUrl;
    } else if (type === 'public') {
      return config.couchurl;
    }
    throw new Error('getCouchUrlByType: type must be "local" or "public"');
  }

  async function hasFlavor() {
    let flavors = await getFlavors();
    if (!flavors) {
      return false;
    }
    let flavorIdx = flavors.indexOf(config.flavor);
    return flavorIdx !== -1;
  }

  // dir: The directory where this flavor should be copied to
  // data: the
  async function handleFlavor(flavorName) {
    let viewsList = await getFlavor(flavorName);
    log.info(`build flavor ${flavorName}`);
    const flavorDir = getFlavorDir(flavorName, true);

    // Transforms the array-representation of a flavor's views as returned by couchdb
    // into a tree representation that reflects the views' hierarchy in a flavor
    log.trace('get tree');
    let viewTree = await flavorUtils.getTree(viewsList);
    // Set the path of each view to end up to
    log.trace('do path on tree');
    await flavorUtils.traverseTree(viewTree, doPath(flavorDir));
    // For each view fix version number
    log.trace('fix version on tree');
    await flavorUtils.traverseTree(viewTree, fixVersion);
    // For each view generate the html in the appropriate directory
    log.trace('generate html on tree');

    let hasNew = false;
    let nameChanged = false;
    let hasDeleted = false;
    const flavorIds = {};

    await flavorUtils.traverseTree(viewTree, (el) => {
      flavorIds[el.__id] = 1;
      if (!revisionById[flavorName] || !revisionById[flavorName][el.__id]) {
        hasNew = true;
      } else if (revisionById[flavorName][el.__id].name !== el.__name) {
        nameChanged = true;
      }
    });

    // Remove deleted views
    const savedIds = revisionById[flavorName]
      ? Object.keys(revisionById[flavorName])
      : [];
    for (let i = 0; i < savedIds.length; i++) {
      if (!flavorIds[savedIds[i]]) {
        hasDeleted = true;
        delete revisionById[flavorName][savedIds[i]];
      }
    }

    writeJsonSync(config.revisionByIdPath, revisionById);

    if (!hasNew && !nameChanged && !hasDeleted) {
      // Generate only for views that changed
      await flavorUtils.traverseTree(
        viewTree,
        checkRevisionChanged(generateHtml(flavorName, viewTree), flavorName),
      );
    } else {
      // Generate for all views (because menu needs to be updated)
      await flavorUtils.traverseTree(
        viewTree,
        updateRevision(generateHtml(flavorName, viewTree), flavorName),
      );
    }
    // Copy visualizer from cdn
    if (config.isSelfContained(flavorName)) {
      let versions = await getVersionsFromTree(viewTree);
      for (let i = 0; i < versions.length; i++) {
        await copyVisualizer(versions[i]);
      }
    }
    // Copy static files
    await copyFiles();
    // Process non view-specific swig
    swigFiles();
  }

  function updateRevision(cb, flavorName) {
    return (el) => {
      logProcessView(el, flavorName);
      let prom = cb(el);
      if (!revisionById[flavorName]) revisionById[flavorName] = {};
      revisionById[flavorName][el.__id] = {
        rev: el.__rev,
        name: el.__name,
      };
      writeJsonSync(config.revisionByIdPath, revisionById);
      return prom;
    };
  }

  function checkRevisionChanged(cb, flavorName) {
    return function checkFlavorRevisionChanged(el) {
      let prom = Promise.resolve();
      let id = el.__id;
      let rev = el.__rev;
      if (
        config.forceUpdate ||
        !revisionById[flavorName] ||
        !revisionById[flavorName][id] ||
        revisionById[flavorName][id].rev !== rev
      ) {
        logProcessView(el, flavorName);
        prom = cb(el);
        if (!revisionById[flavorName]) revisionById[flavorName] = {};
        revisionById[flavorName][el.__id] = {
          rev: el.__rev,
          name: el.__name,
        };
        writeJsonSync(config.revisionByIdPath, revisionById);
      }
      return prom;
    };
  }

  async function getVersionsFromTree(tree) {
    let v = [];
    await flavorUtils.traverseTree(tree, (el) => {
      v.push(el.__version);
    });
    return uniq(v);
  }

  function generateHtml(flavorName, rootStructure) {
    return function generateFlavorHtml(el) {
      let isHome = el.__id && el.__name === config.home;
      let basePath = path.parse(el.__path).dir;
      let flavorDir = getFlavorDir(flavorName);
      let relativePath = path.relative(basePath, config.dir) || '.';
      let selfContained = config.isSelfContained(flavorName);
      sitemaps[pathFromDir(flavorName, el.__path)] = true;

      // Create directory
      fs.mkdirSync(basePath, { recursive: true });

      let data = {
        viewURL: selfContained
          ? el.__view
            ? './view.json'
            : undefined
          : getViewUrl(el, 'public'),
        dataURL: selfContained
          ? el.__data
            ? './data.json'
            : undefined
          : getDataUrl(el, 'public'),
        queryString: buildQueryString(el),
        version: el.__version,
        meta: el.__meta,
        keywords: el.__keywords,
        structure: rootStructure,
        config,
        menuHtml: doMenu(rootStructure, basePath, flavorName),
        reldir: relativePath,
        readConfig: path.join(relativePath, READ_CONFIG),
        title: el.__title === 'No title' ? el.__name : el.__title,
        home: path.join(relativePath, path.relative(config.dir, flavorDir)),
        flavor: flavorName,
        selfContained,
        rocLogin: config.rocLogin[flavorName],
      };

      if (isHome && flavorDir === basePath) {
        data.home = '.';
      }

      let finalProm = Promise.resolve();
      finalProm = finalProm.then(() => {
        let prom = [];

        // Now that the file is written the directory exists

        if (el.__view) {
          prom.push(
            new Promise((resolve, reject) => {
              let viewPath = path.join(basePath, 'view.json');
              let prom = Promise.resolve();
              request(
                getViewUrl(el, 'local'),
                config.couchReqOptions,
                (err, response, body) => {
                  if (err) {
                    reject(err);
                  } else {
                    data.botHtml = getBotContent(body);
                    data.description = data.botHtml
                      .replaceAll(/<[^>]*>/g, ' ')
                      .replace('"', "'");
                    let layoutFile =
                      layouts[
                        config.flavorLayouts[flavorName] || DEFAULT_FLAVOR
                      ];
                    writeFile(layoutFile, el.__path, data);
                    if (config.isSelfContained(flavorName)) {
                      fs.writeFileSync(viewPath, body);
                      if (config.flatViews) {
                        prom = prom.then(
                          processViewForLibraries(
                            viewPath,
                            flavorName,
                            path.join(
                              config.flatViews.outdir,
                              el.__id,
                              'view.json',
                            ),
                          ),
                        );
                        prom = prom.then(
                          processViewForLibraries(viewPath, flavorName),
                        );
                      } else {
                        prom = prom.then(
                          processViewForLibraries(viewPath, flavorName),
                        );
                      }
                    }
                    prom.then(resolve);
                  }
                },
              );
            }),
          );
        }
        if (el.__data) {
          prom.push(
            new Promise((resolve, reject) => {
              let read = request(
                getDataUrl(el, 'local'),
                config.couchReqOptions,
              );
              let viewPath = path.join(basePath, 'data.json');
              let write = fs.createWriteStream(viewPath);
              write.on('finish', () => {
                return resolve();
              });
              write.on('error', (err) => {
                return reject(err);
              });
              read.on('error', (err) => {
                return reject(err);
              });
              read.pipe(write);
            }),
          );
        }

        writeJsonSync(path.join(basePath, 'couch.json'), {
          id: el.__id,
          rev: el.__rev,
          database: `${config.couchurl}/${config.couchDatabase}`,
        });
        return Promise.all(prom);
      });

      return finalProm;
    };
  }

  function doPath(dir) {
    return function doDirPath(el) {
      el.__filename = el.__name.replaceAll(pathCharactersRegExp, '_');
      el.__path = el.__parents
        .map((parent) => {
          return parent.replaceAll(pathCharactersRegExp, '_');
        })
        .join('/');
      el.__path = path.join(dir, el.__path);

      if (el.__name === config.home) {
        el.__path = path.join(el.__path, 'index.html');
        el.__parent.__homeChild = el;
      } else {
        el.__path = path.join(el.__path, el.__filename, 'index.html');
      }
    };
  }

  function processViewForLibraries(viewPath, flavorName, out) {
    let prom = [];
    let view = readJsonSync(viewPath);
    eachModule(
      view,
      (module) => {
        try {
          let libs = module.configuration.groups.libs[0];
          for (let i = 0; i < libs.length; i++) {
            if (libraryNeedsProcess(libs[i].lib)) {
              prom.push(cacheUrl(config, libs[i].lib, flavorName, true));
              libs[i].lib = fromVisuLocalUrl(config, libs[i].lib);
            }
          }
        } catch (error) {
          console.error(
            'Error  while processing view to change libraries',
            error,
            error.stack,
          );
        }
      },
      ['filter_editor', 'code_executor'],
    );

    eachModule(view, (module) => {
      if (libraryNeedsProcess(module.url)) {
        prom.push(cacheDir(config, module.url, flavorName, true));
        module.url = fromVisuLocalUrl(config, module.url);
      }
    });

    try {
      if (view.aliases) {
        for (let i = 0; i < view.aliases.length; i++) {
          let lib = view.aliases[i].path;
          if (libraryNeedsProcess(lib)) {
            prom.push(cacheUrl(config, lib, flavorName, true));
            view.aliases[i].path = fromVisuLocalUrl(config, lib);
          }
        }
      }
    } catch (error) {
      console.error(
        'Error while processing view to change library urls (general preferences)',
        error,
        error.stack,
      );
    }

    out = out || viewPath;
    fs.mkdirSync(path.parse(out).dir, { recursive: true });
    writeJsonSync(out, view);

    return Promise.all(prom);
  }

  function getFlavorConfig(flavorName) {
    flavorName = flavorName || config.flavor;
    if (config.flavorConfig && config.flavorConfig[flavorName]) {
      return config.flavorConfig[flavorName];
    }
    return {};
  }

  function buildQueryString(el, flavorName) {
    let result = '?';
    let conf = getFlavorConfig(flavorName);

    if (conf.lockView) {
      if (result !== '?') result += '&';
      result += 'lockView=1';
    }

    if (result === '?') return '';
    return result;
  }

  function doMenu(structure, cpath, flavorName) {
    let html = '';
    if (structure.__id) {
      if (structure.__name !== config.home) {
        html += `<li><a href="${path.relative(
          cpath,
          structure.__path,
        )}${buildQueryString(structure, flavorName)}"><span>${
          structure.__name
        }</span></a></li>`;
      } // No leaf for home elements
      return html;
    } else {
      let link = structure.__homeChild
        ? path.relative(cpath, structure.__homeChild.__path) +
          buildQueryString(structure.__homeChild, flavorName)
        : '#';

      if (structure.__name) {
        html += `<li><a href="${link}">${structure.__name}</a>`;
      }
      html += `<ul${
        structure.__root ? ' class="navmenu" style="display:none"' : ''
      }>`;
      for (let key in structure) {
        if (key.startsWith('__')) continue;
        html += doMenu(structure[key], cpath, flavorName);
      }
      html += '</ul>';
      if (structure.__name) html += '</li>';
    }
    return html;
  }

  async function copyFiles() {
    log.trace('copy files');
    for (let i = 0; i < toCopy.length; i++) {
      log.trace(`copy ${toCopy[i].src} to ${toCopy[i].dest}`);
      await fsAsync.cp(toCopy[i].src, toCopy[i].dest, { recursive: true });
    }
  }

  function swigFiles() {
    for (let i = 0; i < toSwig.length; i++) {
      writeFile(toSwig[i].src, toSwig[i].dest, toSwig[i].data);
    }
  }

  function copyVisualizer(version) {
    version = checkVersion(version);
    let url = new URL('visualizer', config.cdn);
    let extractDir = path.join(
      config.dir,
      config.libFolder,
      url.hostname,
      url.pathname,
      version,
    );

    url.pathname += `/${version}.tar.gz`;

    // Check if already exists
    try {
      fs.statSync(extractDir);
      return Promise.resolve();
    } catch {
      return new Promise((resolve, reject) => {
        log.trace('copying visualizer', version);
        fs.mkdirSync(extractDir, { recursive: true });
        url = getAuthUrl(config, url.href);

        exec(
          `curl ${url} | tar -xz`,
          {
            cwd: extractDir,
          },
          (err) => {
            if (err) reject(err);
            resolve();
          },
        );
      });
    }
  }
}

export default {
  build(config) {
    return call(config).build();
  },
  getFlavors(config) {
    return call(config).getFlavors();
  },
};

function checkFile(path) {
  log.trace(`check that ${path} can be written`);
  try {
    let fid = fs.openSync(path, 'a+');
    fs.closeSync(fid);
    try {
      return readJsonSync(path);
    } catch {
      return {};
    }
  } catch (error) {
    if (error.code === 'ENOENT') {
      writeJsonSync(path, {});
      return {};
    } else {
      // propagate the error
      throw error;
    }
  }
}

function processFlavors(data) {
  let result;
  if (data && data.rows && !isUndefined(data.rows.length)) {
    result = data.rows.flat();
    result = result.flatMap((r) => r.value);
  }
  return result;
}

function logProcessView(el, flavorName) {
  log.info(`process view - flavor: ${flavorName}, id: ${el.__id}`);
}

function fixVersion(el) {
  if (el.__version && !el.__version.startsWith('v')) {
    el.__version = `v${el.__version}`;
  }
}

function writeFile(readpath, writepath, data) {
  // Compile a file and store it, rendering it later
  let tpl = swig.compileFile(readpath);
  let htmlcontent = tpl(data);
  fs.writeFileSync(writepath, htmlcontent);
}

function getBotContent(viewContent) {
  let content = JSON.parse(viewContent);
  if (content.modules) {
    let modules = content.modules.filter((m) => {
      // eslint-disable-next-line prefer-named-capture-group
      return m.url.match(/\/(rich_text|postit)/);
    });
    return modules
      .map((m) => {
        return m.richtext || m.text || '';
      })
      .join('');
  }
  return '';
}

function libraryNeedsProcess(url) {
  return /^https?:\/\/|^\.|^\/\//.test(url);
}

function eachModule(view, callback, moduleNames) {
  if (view.modules) {
    if (typeof moduleNames === 'string') {
      moduleNames = [moduleNames];
    } else if (!Array.isArray(moduleNames)) {
      moduleNames = [''];
    }
    let i = 0;
    let ii = view.modules.length;
    let module;
    let url;
    let j;
    let jj = moduleNames.length;
    for (; i < ii; i++) {
      module = view.modules[i];

      url = module.url;
      if (url) {
        if (!moduleNames) {
          callback(module);
          continue;
        }
        for (j = 0; j < jj; j++) {
          if (String(url).includes(moduleNames[j])) {
            callback(module);
            break;
          }
        }
      }
    }
  }
}
