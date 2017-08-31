'use strict';

const DEFAULT_FLAVOR = 'default';
const READ_CONFIG = './static/readConfig.json';

const urlLib = require('url');
const _ = require('lodash');
const swig = require('swig');
const fs = require('fs-extra');
const path = require('path');
const request = require('request');
const crypto = require('crypto');
const co = require('co');
const utils = require('./utils');
const FlavorUtils = require('flavor-utils');
const visualizerOnTabs = require('visualizer-on-tabs');
const exec = require('child_process').exec;
const debug = require('debug')('flavor-builder:main');

const URL = urlLib.URL;

const pathCharactersRegExp = /[^A-Za-z0-9.-]/g;

function call(f, configArg) {
    var config, layouts, toCopy, toSwig, filters, flavorUtils, sitemaps, revisionById, md5;

    function init(configArg) {
        config = require('./config')(configArg);
        if (config.pidFile) {
            var isLocked = require('./isLocked')(path.resolve(path.join(__dirname, '..'), config.pidFile));
            if (isLocked) {
                throw new Error('flavor-builder already running');
            }
        }

        filters = require('./filters')(config);
        layouts = config.layouts;
        flavorUtils = new FlavorUtils({
            username: config.flavorUsername,
            couchUrl: config.couchLocalUrl,
            couchDatabase: config.couchDatabase,
            couchUsername: config.couchUsername,
            couchPassword: config.couchPassword,
            designDoc: config.designDoc
        });
    }

    return Promise.resolve().then(function () {
        init(configArg);
        return eval(f + '()');
    });

    function build() {
        debug('start build');
        revisionById = checkFile(config.revisionByIdPath);
        md5 = checkFile(config.md5Path);

        toCopy = [
            {src: path.join(__dirname, '../lib'), dest: path.join(config.dir, './lib')},
            {src: path.join(__dirname, '../themes'), dest: path.join(config.dir, './themes')},
            {src: path.join(__dirname, '../static'), dest: path.join(config.dir, './static')}
        ];

        toSwig = [];

        for (var key in filters) {
            swig.setFilter(key, filters[key]);
        }


        return co(function*() {
            try {
                sitemaps = readSiteMaps();
                debug('get versions');
                if (config.flavor) {
                    // Build single flavor
                    let exists = yield hasFlavor(config.flavor);
                    if (!exists) {
                        debug('Flavor not found');
                        return;
                    }
                    debug('get flavor');
                    if (config.flavorLayouts[config.flavor] === 'visualizer-on-tabs') {
                        yield handleVisualizerOnTabs(config.flavor);
                    } else {
                        yield handleFlavor(config.flavor);
                    }
                    yield Promise.all(filters.plist);
                } else {
                    // Build all flavors
                    // Get a list of all available flavors
                    let flavors = yield getFlavors();
                    // Filter flavors to get only those that have changed
                    flavors = yield filterFlavorsByMd5(flavors);
                    debug(`Processing ${flavors.length} flavors: ${flavors}`);
                    for (let i = 0; i < flavors.length; i++) {
                        if (config.flavorLayouts[flavors[i]] === 'visualizer-on-tabs') {
                            yield handleVisualizerOnTabs(flavors[i]);
                        } else {
                            yield handleFlavor(flavors[i]);
                        }
                        // Some swig filter are asynchronous, wait for them to finish
                        yield Promise.all(filters.plist);
                    }
                }
                writeSiteMaps();
            } catch (e) {
                debug('error occured', e);
            }
        });
    }

    function checkFile(path) {
        debug(`check that ${path} can be written`);
        try {
            var fid = fs.openSync(path, 'a+');
            fs.closeSync(fid);
            try {
                return fs.readJSONSync(path);
            } catch (e) {
                return {};
            }

        } catch (e) {
            if (e.code === 'ENOENT') {
                fs.writeJSONSync(path, {});
                return {};
            } else {
                // propagate the error
                throw e;
            }
        }
    }

    function readSiteMaps() {
        debug('write site maps');
        try {
            var r = {};
            var content = fs.readFileSync(path.join(config.dir, 'sitemap.txt'), 'utf-8');
            content.split('\n').forEach(function (el) {
                el = el.replace(config.rootUrl, '');
                el = el.replace(/^\//, '');
                r[el] = true;
            });
            return r;
        } catch (e) {
            return {};
        }
    }

    function writeSiteMaps() {
        if (!config.rootUrl) {
            debug('No root url specified, not creating sitemap.txt');
            return;
        }
        debug('write site maps');
        fs.writeFileSync(path.join(config.dir, 'sitemap.txt'),
            Object.keys(sitemaps)
                .map(el => config.rootUrl + '/' + el)
                .join('\n'));
    }

    function pathFromDir(flavorName, p) {
        var basicPath = path.relative(config.dir, p);
        if (flavorName === DEFAULT_FLAVOR) {
            return basicPath;
        } else {
            return path.join('flavor', flavorName, basicPath);
        }
    }

    function getFlavorDir(flavorName, create) {
        var flavorDir;
        if (flavorName === DEFAULT_FLAVOR || flavorName === config.flavor) {
            flavorDir = config.dir;
        } else {
            flavorDir = path.join(config.dir, 'flavor', flavorName);
        }
        if (create) {
            fs.mkdirpSync(flavorDir);
        }
        return flavorDir;
    }

    function * handleVisualizerOnTabs(flavorName) {
        var viewsList = yield getFlavor(flavorName);
        var viewTree = yield flavorUtils.getTree(viewsList);
        const flavorDir = getFlavorDir(flavorName, true);


        const homePages = [];
        var tabsConfig = config.visualizerOnTabs && config.visualizerOnTabs[flavorName];
        if (!tabsConfig) tabsConfig = config.visualizerOnTabs._default;
        if (!tabsConfig) throw new Error('No visualizer on tabs configuration found');

        yield flavorUtils.traverseTree(viewTree, function (el) {
            if (el.__name === config.home) {
                const outDir = path.join(flavorDir, el.__parents.join('/'));
                const indexPage = path.relative(config.dir, path.join(outDir, 'index.html'));

                var customConfig = {
                    possibleViews: {}
                };
                sitemaps[indexPage] = true;

                customConfig.possibleViews[el.__name] = {
                    url: getViewUrl(el, 'public'),
                    closable: false
                };

                customConfig.possibleViews = Object.assign(customConfig.possibleViews, tabsConfig ? tabsConfig.possibleViews : {});
                homePages.push({
                    outDir,
                    config: Object.assign({}, tabsConfig, customConfig)
                });
            }
        });

        for (let i = 0; i < homePages.length; i++) {
            yield visualizerOnTabs(homePages[i]);
        }
    }

    // returns an array of flavors for which the md5 has changed
    function filterFlavorsByMd5(flavors) {
        debug('filter flavors by md5');
        return getFlavorMD5(flavors).then(function (result) {
            if (config.forceUpdate) {
                debug('force update, no flavor filtering');
                return Object.keys(result);
            }
            if (JSON.stringify(md5) === '{}') {
                fs.writeJSONSync(config.md5Path, result);
                return Object.keys(result);
            }
            var keys = [];
            for (var key in result) {
                if (result[key] !== md5[key]) {
                    debug(`flavor ${key} has changed, add to the list`);
                    md5[key] = result[key];
                    keys.push(key);
                } else {
                    debug(`flavor ${key} has not changed, ignoring it`);
                }
            }
            fs.writeJSONSync(config.md5Path, md5);
            return keys;
        });
    }

    function getFlavors() {
        debug('get list of flavors');
        return flavorUtils.getFlavors().then(function (flavors) {
            return processFlavors(flavors);
        });
    }

    function getFlavorMD5(flavors) {
        if (flavors instanceof Array) {
            var prom = [];
            for (var i = 0; i < flavors.length; i++) {
                prom.push(getFlavorMD5(flavors[i]));
            }
            return Promise.all(prom).then(function (md5s) {
                var result = {};
                for (var j = 0; j < md5s.length; j++) {
                    result[flavors[j]] = md5s[j];
                }
                return result;
            });
        } else {
            return flavorUtils.getFlavor({flavor: flavors}, false).then(function (result) {
                return crypto.createHash('md5').update(JSON.stringify(result.rows)).digest('hex');
            }, function (err) {
                throw err;
            });
        }
    }


    function processFlavors(data) {
        var result;
        if (data && data.rows && !_.isUndefined(data.rows.length)) {
            result = _.flatten(data.rows);
            result = _.flatten(result.map(r => r.value));
        }
        return result;
    }

    function getFlavor(flavor) {
        // Returns sorted flavor views
        return flavorUtils.getFlavor({flavor: flavor}, true);
    }

    function getViewUrl(el, type) {
        return el.__view ? getCouchUrlByType(type) + '/' + config.couchDatabase + '/' + el.__id + '/view.json?rev=' + el.__rev : undefined;
    }

    function getDataUrl(el, type) {
        return el.__data ? getCouchUrlByType(type) + '/' + config.couchDatabase + '/' + el.__id + '/data.json?rev=' + el.__rev : undefined;
    }

    function getCouchUrlByType(type) {
        if (type === 'local') {
            return config.couchLocalUrl;
        } else if (type === 'public') {
            return config.couchurl;
        }
        throw new Error('getCouchUrlByType: type must be "local" or "public"');
    }

    function*hasFlavor() {
        let flavors = yield getFlavors();
        if (!flavors) {
            return false;
        }
        var flavorIdx = flavors.indexOf(config.flavor);
        return flavorIdx !== -1;
    }

    // dir: The directory where this flavor should be copied to
    // data: the
    function * handleFlavor(flavorName) {
        var viewsList = yield getFlavor(flavorName);
        debug(`handle flavor ${flavorName}`);
        const flavorDir = getFlavorDir(flavorName, true);

        // Transforms the array-representation of a flavor's views as returned by couchdb
        // into a tree representation that reflects the views' hierarchy in a flavor
        debug('get tree');
        let viewTree = yield flavorUtils.getTree(viewsList);
        // Set the path of each view to end up to
        debug('do path on tree');
        yield flavorUtils.traverseTree(viewTree, doPath(flavorDir));
        // For each view fix version number
        debug('fix version on tree');
        yield flavorUtils.traverseTree(viewTree, fixVersion);
        // For each view generate the html in the appropriate directory
        debug('generate html on tree');

        var hasNew = false;
        var nameChanged = false;
        var hasDeleted = false;
        const flavorIds = {};

        yield flavorUtils.traverseTree(viewTree, function (el) {
            flavorIds[el.__id] = 1;
            if (!revisionById[flavorName] || !revisionById[flavorName][el.__id]) {
                hasNew = true;
            } else if (revisionById[flavorName][el.__id].name !== el.__name) {
                nameChanged = true;
            }
        });

        // Remove deleted views
        const savedIds = revisionById[flavorName] ? Object.keys(revisionById[flavorName]) : [];
        for (let i = 0; i < savedIds.length; i++) {
            if (!flavorIds[savedIds[i]]) {
                hasDeleted = true;
                delete revisionById[flavorName][savedIds[i]];
            }
        }

        fs.writeJsonSync(config.revisionByIdPath, revisionById);

        if (!hasNew && !nameChanged && !hasDeleted) {
            // Generate only for views that changed
            yield flavorUtils.traverseTree(viewTree, checkRevisionChanged(generateHtml(flavorName, viewTree), flavorName));
        } else {
            // Generate for all views (because menu needs to be updated)
            yield flavorUtils.traverseTree(viewTree, updateRevision(generateHtml(flavorName, viewTree), flavorName));
        }
        // Copy visualizer from cdn
        if (config.isSelfContained(flavorName)) {
            let versions = yield getVersionsFromTree(viewTree);
            for (let i = 0; i < versions.length; i++) {
                yield copyVisualizer(versions[i]);
            }
        }
        // Copy static files
        copyFiles();
        // Process non view-specific swig
        swigFiles();
    }

    function logProcessView(el, flavorName) {
        debug(`process view - flavor: ${flavorName}, id: ${el.__id}`);
    }

    function updateRevision(cb, flavorName) {
        return function (el) {
            logProcessView(el, flavorName);
            var prom = cb(el);
            if (!revisionById[flavorName]) revisionById[flavorName] = {};
            revisionById[flavorName][el.__id] = {
                rev: el.__rev,
                name: el.__name
            };
            fs.writeJsonSync(config.revisionByIdPath, revisionById);
            return prom;
        };
    }

    function checkRevisionChanged(cb, flavorName) {
        return function (el) {
            var prom = Promise.resolve();
            var id = el.__id;
            var rev = el.__rev;
            if (config.forceUpdate || !revisionById[flavorName] || !revisionById[flavorName][id] || revisionById[flavorName][id].rev !== rev) {
                logProcessView(el, flavorName);
                prom = cb(el);
                if (!revisionById[flavorName]) revisionById[flavorName] = {};
                revisionById[flavorName][el.__id] = {
                    rev: el.__rev,
                    name: el.__name
                };
                fs.writeJsonSync(config.revisionByIdPath, revisionById);
            }
            return prom;
        };
    }

    function fixVersion(el) {
        if (el.__version) {
            if (!el.__version.startsWith('v')) {
                el.__version = 'v' + el.__version;
            }
        }
    }

    function*getVersionsFromTree(tree) {
        let v = [];
        yield flavorUtils.traverseTree(tree, function (el) {
            v.push(el.__version);
        });
        return _.uniq(v);
    }


    function generateHtml(flavorName, rootStructure) {
        return function (el) {
            let isHome = el.__id && el.__name === config.home;
            let basePath = path.parse(el.__path).dir;
            let flavorDir = getFlavorDir(flavorName);
            let relativePath = path.relative(basePath, config.dir) || '.';
            let selfContained = config.isSelfContained(flavorName);
            sitemaps[pathFromDir(flavorName, el.__path)] = true;

            // Create directory
            fs.mkdirpSync(basePath);

            let data = {
                viewURL: selfContained ? (el.__view ? './view.json' : undefined) : getViewUrl(el, 'public'),
                dataURL: selfContained ? (el.__data ? './data.json' : undefined) : getDataUrl(el, 'public'),
                queryString: buildQueryString(el),
                version: el.__version,
                meta: el.__meta,
                keywords: el.__keywords,
                structure: rootStructure,
                config: config,
                menuHtml: doMenu(rootStructure, basePath, flavorName),
                reldir: relativePath,
                readConfig: path.join(relativePath, READ_CONFIG),
                title: el.__title === 'No title' ? el.__name : el.__title,
                home: path.join(relativePath, path.relative(config.dir, flavorDir)),
                flavor: flavorName,
                selfContained,
                rocLogin: config.rocLogin[flavorName]
            };

            if (isHome && flavorDir === basePath) {
                data.home = '.';
            }

            let finalProm = Promise.resolve();
            finalProm = finalProm.then(function () {
                var prom = [];

                // Now that the file is written the directory exists

                if (el.__view) {
                    prom.push(new Promise(function (resolve, reject) {
                        var viewPath = path.join(basePath, 'view.json');
                        var prom = Promise.resolve();
                        request(getViewUrl(el, 'local'), config.couchReqOptions, function (err, response, body) {
                            if (err) {
                                reject(err);
                            } else {
                                data.botHtml = getBotContent(body);
                                data.description = data.botHtml.replace(/<[^>]*>/g, ' ').replace('"', "'");
                                var layoutFile = layouts[config.flavorLayouts[flavorName] || DEFAULT_FLAVOR];
                                writeFile(layoutFile, el.__path, data);
                                if (config.isSelfContained(flavorName)) {
                                    fs.writeFileSync(viewPath, body);
                                    if (config.flatViews) {
                                        prom = prom.then(processViewForLibraries(viewPath, flavorName, path.join(config.flatViews.outdir, el.__id, 'view.json')));
                                        prom = prom.then(processViewForLibraries(viewPath, flavorName));
                                    } else {
                                        prom = prom.then(processViewForLibraries(viewPath, flavorName));
                                    }
                                }
                                prom.then(resolve);
                            }
                        });
                    }));
                }
                if (el.__data) {
                    prom.push(new Promise(function (resolve, reject) {
                        var read = request(getDataUrl(el, 'local'), config.couchReqOptions);
                        var viewPath = path.join(basePath, 'data.json');
                        var write = fs.createWriteStream(viewPath);
                        write.on('finish', function () {
                            return resolve();
                        });
                        write.on('error', function (err) {
                            return reject(err);
                        });
                        read.on('error', function (err) {
                            return reject(err);
                        });
                        read.pipe(write);
                    }));
                }


                fs.writeJsonSync(path.join(basePath, 'couch.json'), {
                    id: el.__id,
                    rev: el.__rev,
                    database: config.couchurl + '/' + config.couchDatabase
                });
                return Promise.all(prom);
            });

            return finalProm;
        };
    }

    function doPath(dir) {
        return function (el) {
            el.__filename = el.__name.replace(pathCharactersRegExp, '_');
            el.__path = el.__parents.map(function (parent) {
                return parent.replace(pathCharactersRegExp, '_');
            }).join('/');
            el.__path = path.join(dir, el.__path);

            if (el.__name === config.home) {
                el.__path = path.join(el.__path, 'index.html');
                el.__parent.__homeChild = el;
            } else {
                el.__path = path.join(el.__path, el.__filename, 'index.html');
            }
        };
    }

    function writeFile(readpath, writepath, data) {
        // Compile a file and store it, rendering it later
        var tpl = swig.compileFile(readpath);
        var htmlcontent = tpl(data);
        fs.writeFileSync(writepath, htmlcontent);
    }

    function getBotContent(viewContent) {
        var content = JSON.parse(viewContent);
        if (content.modules) {
            var modules = content.modules.filter(m => {
                return m.url.match(/\/(rich_text|postit)/);
            });
            return modules.map(m => {
                return m.richtext || m.text || '';
            }).join('');
        }
        return '';
    }

    function processViewForLibraries(viewPath, flavorName, out) {
        var prom = [];
        var view = fs.readJsonSync(viewPath);
        eachModule(view, function (module) {
            try {
                var libs = module.configuration.groups.libs[0];
                for (var i = 0; i < libs.length; i++) {
                    if (libraryNeedsProcess(libs[i].lib)) {
                        prom.push(utils.cacheUrl(config, libs[i].lib, flavorName, true));
                        libs[i].lib = utils.fromVisuLocalUrl(config, libs[i].lib);
                    }
                }

            } catch (e) {
                // eslint-disable-next-line no-console
                console.error('Error  while processing view to change libraries', e, e.stack);
            }
        }, ['filter_editor', 'code_executor']);

        eachModule(view, function (module) {
            if (libraryNeedsProcess(module.url)) {
                prom.push(utils.cacheDir(config, module.url, flavorName, true));
                module.url = utils.fromVisuLocalUrl(config, module.url);
            }
        });

        try {
            if (view.aliases) {

                for (var i = 0; i < view.aliases.length; i++) {
                    let lib = view.aliases[i].path;
                    if (libraryNeedsProcess(lib)) {
                        prom.push(utils.cacheUrl(config, lib, flavorName, true));
                        view.aliases[i].path = utils.fromVisuLocalUrl(config, lib);
                    }
                }
            }
        } catch (e) {
            // eslint-disable-next-line no-console
            console.error('Error while processing view to change library urls (general preferences)', e, e.stack);
        }

        out = out || viewPath;
        fs.mkdirpSync(path.parse(out).dir);
        fs.writeJsonSync(out, view);

        return Promise.all(prom);
    }

    function libraryNeedsProcess(url) {
        return /^https?:\/\/|^\.|^\/\//.test(url);
    }

    function eachModule(view, callback, moduleNames) {
        if (view.modules) {
            if (typeof (moduleNames) === 'string') {
                moduleNames = [moduleNames];
            } else if (!Array.isArray(moduleNames)) {
                moduleNames = [''];
            }
            var i = 0;
            var ii = view.modules.length;
            var module;
            var url;
            var j;
            var jj = moduleNames.length;
            for (; i < ii; i++) {
                module = view.modules[i];

                url = module.url;
                if (url) {
                    if (!moduleNames) {
                        callback(module);
                        continue;
                    }
                    for (j = 0; j < jj; j++) {

                        if (String(url).indexOf(moduleNames[j]) >= 0) {
                            callback(module);
                            break;
                        }
                    }
                }

            }
        }
    }

    function getFlavorConfig(flavorName) {
        flavorName = flavorName || config.flavor;
        if (config.flavorConfig && config.flavorConfig[flavorName]) {
            return config.flavorConfig[flavorName];
        }
        return {};
    }

    function buildQueryString(el, flavorName) {
        var result = '?';
        // if (el.__view) {
        //     if (config.isSelfContained(flavorName))
        //         result += 'viewURL=' + encodeURIComponent('./view.json');
        //     else
        //         result += 'viewURL=' + encodeURIComponent(config.couchurl + '/' + config.couchDatabase + '/' + el.__id + '/view.json?rev=' + el.__rev);
        // }
        // if (el.__data) {
        //     if (result !== '?') result += '&';
        //     if (config.isSelfContained(flavorName))
        //         result += 'dataURL=' + encodeURIComponent('./data.json');
        //     else
        //         result += 'dataURL=' + encodeURIComponent(config.couchurl + '/' + config.couchDatabase + '/' + el.__id + '/data.json?rev=' + el.__rev);
        // }

        var conf = getFlavorConfig(flavorName);

        if (conf.lockView) {
            if (result !== '?') result += '&';
            result += 'lockView=1';
        }

        if (result === '?') return '';
        return result;
    }


    function doMenu(structure, cpath, flavorName) {
        var html = '';
        if (structure.__id) {
            if (structure.__name !== config.home) {
                html += '<li><a href="' + path.relative(cpath, structure.__path) + buildQueryString(structure, flavorName) + '"><span>' + structure.__name + '</span></a></li>';
            } // No leaf for home elements
            return html;
        } else {
            var link = structure.__homeChild ? path.relative(cpath, structure.__homeChild.__path) + buildQueryString(structure.__homeChild, flavorName) : '#';

            if (structure.__name) html += '<li><a href="' + link + '">' + structure.__name + '</a>';
            html += '<ul' + (structure.__root ? ' class="navmenu" style="display:none"' : '') + '>';
            for (var key in structure) {
                if (key.startsWith('__')) continue;
                html += doMenu(structure[key], cpath, flavorName);
            }
            html += '</ul>';
            if (structure.__name) html += '</li>';
        }
        return html;
    }

    function copyFiles() {
        debug('copy files');
        for (var i = 0; i < toCopy.length; i++) {
            debug('copy ' + toCopy[i].src + ' to ' + toCopy[i].dest);
            fs.copySync(toCopy[i].src, toCopy[i].dest);
        }
    }

    function swigFiles() {
        for (var i = 0; i < toSwig.length; i++) {
            writeFile(toSwig[i].src, toSwig[i].dest, toSwig[i].data);
        }
    }

    function copyVisualizer(version) {
        version = utils.checkVersion(version);
        let url = new URL('visualizer', config.cdn);
        let extractDir = path.join(config.dir, config.libFolder, url.hostname, url.pathname, version);

        url.pathname += `/${version}.tar.gz`;

        // Check if already exists
        try {
            fs.statSync(extractDir);
            return Promise.resolve();
        } catch (e) {
            return new Promise(function (resolve, reject) {
                debug('copying visualizer', version);
                fs.mkdirpSync(extractDir);
                url = utils.getAuthUrl(config, url.href);

                exec(`curl ${url} | tar -xz`, {
                    cwd: extractDir
                }, function (err) {
                    if (err) reject(err);
                    resolve();
                });
            });
        }
    }
}


exports = module.exports = {
    build: function (config) {
        return call('build', config);
    },
    getFlavors: function (config) {
        return call('getFlavors', config);
    }
};
