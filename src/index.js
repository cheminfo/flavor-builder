import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';

import swig from 'swig';
import visualizerOnTabs from 'visualizer-on-tabs';

import { RevisionHelper } from './RevisionHelper.js';
import { UrlHelper } from './UrlHelper.js';
import { checkConfig } from './config.js';
import { DEFAULT_FLAVOR, READ_CONFIG } from './constants.js';
import { getFilters } from './filters.js';
import { FlavorHelper } from './flavorUtils.js';
import { copyFiles, createOrReadJson, writeJsonSync } from './fs.js';
import log from './log.js';
import { getFlavorDir, pathFromDir } from './paths.js';
import { readSiteMaps, writeSiteMaps } from './sitemaps.js';
import { swigWriteFile } from './swig.js';

const pathCharactersRegExp = /[^A-Za-z0-9.-]/g;

export async function build(config) {
  checkConfig(config);
  const flavorHelper = new FlavorHelper(config);
  const revisionHelper = new RevisionHelper(config);
  log.info('start build');

  for (let [key, value] of Object.entries(getFilters())) {
    swig.setFilter(key, value);
  }

  try {
    const sitemaps = readSiteMaps();
    log.trace('get versions');
    if (config.flavor) {
      // Build single flavor
      let exists = await flavorHelper.hasFlavor(config.flavor);
      if (!exists) {
        log.info(`Flavor ${config.flavor} not found`);
        return;
      }
      log.trace('get flavor');
      if (config.flavorLayouts[config.flavor] === 'visualizer-on-tabs') {
        await handleVisualizerOnTabs(config, sitemaps);
      } else {
        await handleFlavor(config, config.flavor, sitemaps, revisionHelper);
      }
    } else {
      // Build all flavors
      // Get a list of all available flavors
      let flavors = await flavorHelper.getFlavors();
      // Filter flavors to get only those that have changed
      flavors = await filterFlavorsByMd5(config, flavors);
      log.info(`Processing ${flavors.length} flavors: ${flavors}`);
      for (let i = 0; i < flavors.length; i++) {
        if (config.flavorLayouts[flavors[i]] === 'visualizer-on-tabs') {
          await handleVisualizerOnTabs(flavors[i], sitemaps);
        } else {
          await handleFlavor(config, flavors[i], sitemaps, revisionHelper);
        }
      }
    }
    writeSiteMaps(config, sitemaps);
  } catch (error) {
    log.info('error occured', error);
  }
}

async function handleVisualizerOnTabs(config, sitemaps) {
  const flavorHelper = new FlavorHelper(config);
  const urlHelper = new UrlHelper(config);
  const flavorName = config.flavor;
  assert.ok(
    flavorName,
    'Flavor name must be defined to handle visualizer on tabs',
  );
  let viewsList = await flavorHelper.getFlavor(flavorName);
  let viewTree = await flavorHelper.utils.getTree(viewsList);
  const flavorDir = getFlavorDir(config, flavorName, true);

  const homePages = [];
  let tabsConfig =
    config.visualizerOnTabs && config.visualizerOnTabs[flavorName];
  if (!tabsConfig) tabsConfig = config.visualizerOnTabs._default;
  if (!tabsConfig) {
    throw new Error('No visualizer on tabs configuration found');
  }

  await flavorHelper.utils.traverseTree(viewTree, (el) => {
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
        url: urlHelper.getViewUrl(el, 'public'),
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
async function filterFlavorsByMd5(config, flavors) {
  log.trace('filter flavors by md5');
  const flavorHelper = new FlavorHelper(config);
  const md5 = createOrReadJson(config.md5Path);
  return flavorHelper.getFlavorMD5(flavors).then((result) => {
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

async function handleFlavor(config, flavorName, sitemaps, revisionHelper) {
  assert.ok(flavorName, 'Flavor name must be defined to handle flavor');
  log.info(`build flavor ${flavorName}`);
  const flavorHelper = new FlavorHelper(config);
  let viewsList = await flavorHelper.getFlavor(flavorName);
  const flavorDir = getFlavorDir(config, flavorName, true);

  // Transforms the array-representation of a flavor's views as returned by couchdb
  // into a tree representation that reflects the views' hierarchy in a flavor
  log.trace('get tree');
  let viewTree = await flavorHelper.utils.getTree(viewsList);
  // Set the path of each view to end up to
  log.trace('do path on tree');
  await flavorHelper.utils.traverseTree(viewTree, doPath(config, flavorDir));
  // For each view fix version number
  log.trace('fix version on tree');
  await flavorHelper.utils.traverseTree(viewTree, fixVersion);
  // For each view generate the html in the appropriate directory
  log.trace('generate html on tree');

  const menuNeedsUpdate = await revisionHelper.menuNeedsUpdate(
    viewTree,
    flavorName,
  );

  if (menuNeedsUpdate) {
    log.info(`Generate HTML for all views of flavor ${flavorName}`);
    // Generate for all views (because menu needs to be updated)
    await flavorHelper.utils.traverseTree(
      viewTree,
      revisionHelper.updateRevision(
        generateHtml(config, flavorName, viewTree, sitemaps),
        flavorName,
      ),
    );
  } else {
    // Generate only for views that changed
    log.info(`Generate HTML for changed views of ${flavorName}`);
    await flavorHelper.utils.traverseTree(
      viewTree,
      revisionHelper.checkRevisionChanged(
        generateHtml(config, flavorName, viewTree, sitemaps),
        flavorName,
      ),
    );
  }
  // Copy static files
  log.trace('copy files');
  await copyFiles([
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
  ]);
}

function generateHtml(config, flavorName, rootStructure, sitemaps) {
  const urlHelper = new UrlHelper(config);
  return function generateFlavorHtml(el) {
    let isHome = el.__id && el.__name === config.home;
    let basePath = path.parse(el.__path).dir;
    let flavorDir = getFlavorDir(config, flavorName);
    let relativePath = path.relative(basePath, config.dir) || '.';
    sitemaps[pathFromDir(config, flavorName, el.__path)] = true;
    // Create directory
    fs.mkdirSync(basePath, { recursive: true });

    let data = {
      viewURL: urlHelper.getViewUrl(el, 'public'),
      dataURL: urlHelper.getDataUrl(el, 'public'),
      queryString: urlHelper.buildQueryString(el),
      version: el.__version,
      meta: el.__meta,
      keywords: el.__keywords,
      structure: rootStructure,
      config,
      menuHtml: doMenu(config, rootStructure, basePath, flavorName),
      reldir: relativePath,
      readConfig: path.join(relativePath, READ_CONFIG),
      title: el.__title === 'No title' ? el.__name : el.__title,
      home: path.join(relativePath, path.relative(config.dir, flavorDir)),
      flavor: flavorName,
      rocLogin: config.rocLogin[flavorName],
    };

    if (isHome && flavorDir === basePath) {
      data.home = '.';
    }

    let prom = [];

    // Now that the file is written, the directory exists

    if (el.__view) {
      prom.push(
        (async function processView() {
          log.trace('fetch view', el.__id);
          const viewResponse = await fetch(
            urlHelper.getViewUrl(el, 'local'),
            config.fetchReqOptions,
          );
          assert.ok(
            viewResponse.ok,
            `Failed to fetch view for ${el.__id}: ${viewResponse.statusText}`,
          );
          const body = await viewResponse.text();
          data.botHtml = getBotContent(body);
          data.description = data.botHtml
            .replaceAll(/<[^>]*>/g, ' ')
            .replace('"', "'");
          let layoutFile =
            config.layouts[config.flavorLayouts[flavorName] || DEFAULT_FLAVOR];
          swigWriteFile(layoutFile, el.__path, data);
        })(),
      );
    }
    if (el.__data) {
      prom.push(
        (async function processData() {
          log.trace('fetch data view data', el.__id);
          const response = await fetch(
            urlHelper.getDataUrl(el, 'local'),
            config.fetchReqOptions,
          );
          assert.ok(
            response.ok,
            `Failed to fetch data for ${el.__id}: ${response.statusText}`,
          );

          let dataPath = path.join(basePath, 'data.json');
          const fileStream = fs.createWriteStream(dataPath);
          await pipeline(response.body, fileStream);
        })(),
      );
    }

    log.trace('write couch.json file', path.join(basePath, 'couch.json'));
    writeJsonSync(path.join(basePath, 'couch.json'), {
      id: el.__id,
      rev: el.__rev,
      database: `${config.couchurl}/${config.couchDatabase}`,
    });
    return Promise.all(prom);
  };
}

function doPath(config, dir) {
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

function doMenu(config, structure, cpath, flavorName) {
  const urlHelper = new UrlHelper(config);
  let html = '';
  if (structure.__id) {
    if (structure.__name !== config.home) {
      html += `<li><a href="${path.relative(
        cpath,
        structure.__path,
      )}${urlHelper.buildQueryString(structure, flavorName)}"><span>${
        structure.__name
      }</span></a></li>`;
    } // No leaf for home elements
    return html;
  } else {
    let link = structure.__homeChild
      ? path.relative(cpath, structure.__homeChild.__path) +
        urlHelper.buildQueryString(structure.__homeChild, flavorName)
      : '#';

    if (structure.__name) {
      html += `<li><a href="${link}">${structure.__name}</a>`;
    }
    html += `<ul${
      structure.__root ? ' class="navmenu" style="display:none"' : ''
    }>`;
    for (let key in structure) {
      if (key.startsWith('__')) continue;
      html += doMenu(config, structure[key], cpath, flavorName);
    }
    html += '</ul>';
    if (structure.__name) html += '</li>';
  }
  return html;
}

export function getFlavors(config) {
  checkConfig(config);
  const flavorHelper = new FlavorHelper(config);
  return flavorHelper.utils.getFlavors();
}

export { buildConfig } from './config.js';

function fixVersion(el) {
  if (el.__version && !el.__version.startsWith('v')) {
    el.__version = `v${el.__version}`;
  }
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
