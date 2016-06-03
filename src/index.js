'use strict';

const DEFAULT_FLAVOR = 'default';
const READ_CONFIG = './static/readConfig.json';

var Promise = require('bluebird'),
    urlLib = require('url'),
    _ = require('lodash'),
    swig = require('swig'),
    fs = require('fs-extra'),
    path = require('path'),
    request = require('request'),
    crypto = require('crypto'),
    co = require('co'),
    utils = require('./utils'),
    targz = require('tar.gz'),
    FlavorUtils = require('flavor-utils'),
    visualizerOnTabs = require('visualizer-on-tabs'),
    debug = require('debug')('flavor-builder:main');

var pathCharactersRegExp = /[^A-Za-z0-9.-]/g;

function call(f, configArg) {
    var config, layouts, toCopy, toSwig, versions, filters, flavorUtils, sitemaps;


    function init(configArg) {
        config = require('./config')(configArg);
        filters = require('./filters')(config);
        layouts = config.layouts;
        flavorUtils = new FlavorUtils({
            username: config.flavorUsername,
            couchUrl: config.couchLocalUrl,
            couchDatabase: config.couchDatabase,
            couchUsername: config.couchUsername,
            couchPassword: config.couchPassword,
            designDoc: 'app'
        });
    }

    return Promise.resolve().then(function () {
        init(configArg);
        return eval(f + '()');
    });

    function build() {
        debug('start build');
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
            sitemaps = readSiteMaps();
            debug('get versions');
            versions = yield getVersionsRequest();
            if (config.flavor) {
                // Build single flavor
                let exists = yield hasFlavor(config.flavor);
                if (!exists) {
                    console.log('Flavor not found');
                    return;
                }
                debug('get flavor');
                if (config.flavorLayouts[config.flavor] === 'visualizer-on-tabs') {
                    yield handleVisualizerOnTabs(config.flavor);
                } else {
                    yield handleFlavor(config.flavor);
                }
                yield Promise.all(filters.plist);
            }

            else {
                // Build all flavors
                // Get a list of all available flavors
                let flavors = yield getFlavors();
                // Filter flavors to get only those that have changed
                flavors = yield filterFlavorsByMd5(flavors);
                console.log('Processing ' + flavors.length + ' flavors');
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
        });
    }

    function readSiteMaps() {
        debug('write site maps');
        try {
            var r = {};
            var content = fs.readFileSync(path.join(config.dir, 'sitemap.txt'), 'utf-8');
            content.split('\n').forEach(function(el) {
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
            console.warn('No root url specified, not creating sitemap.txt');
            return;
        }
        debug('write site maps')
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
        const indexPage = path.relative(config.dir, path.join(flavorDir, 'index.html'));
        var customConfig = {
            possibleViews: {}
        };
        var possibleViews = customConfig.possibleViews;

        yield flavorUtils.traverseTree(viewTree, function (el) {
            if (el.__name === config.home) {
                sitemaps[indexPage] = true;
                possibleViews[el.__name] = {
                    url: getViewUrl(el, 'public'),
                    closable: false
                }
            }
        });
        var tabsConfig;
        try {
            tabsConfig = config.visualizerOnTabs[flavorName] || config.visualizerOnTabs._default;
        } catch (e) {
        }

        yield visualizerOnTabs({
            outDir: flavorDir,
            config: Object.assign({}, tabsConfig, customConfig)
        });
    }

// returns an array of flavors for which the md5 has changed
    function filterFlavorsByMd5(flavors) {
        debug('filter flavors by md5');
        return getFlavorMD5(flavors).then(function (result) {
            if (config.forceUpdate) {
                return Object.keys(result);
            }
            var exists = fs.existsSync('./md5s.json');
            if (!exists) {
                fs.writeJSONFileSync('./md5s.json', result);
                return Object.keys(result);
            }
            var md5 = fs.readJSONFileSync('./md5s.json');
            var keys = [];
            for (var key in result) {
                if (result[key] !== md5[key]) {
                    keys.push(key);
                }
            }
            fs.writeJSONFileSync('./md5s.json', result);
            return keys;
        });
    }

    function filterFlavorByMD5(flavor) {
        return filterFlavorsByMd5([flavor]).then(function (flavors) {
            if (flavors.length) return flavors[0];
            return null;
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
        }
        else {
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
            result = _(result).pluck('value').flatten().value();
        }
        return result;
    }

    function getFlavor(flavor) {
        // Returns sorted flavor views
        return flavorUtils.getFlavor({flavor: flavor}, true);
    }

    function requestGet(url, options) {
        options = options || {};
        return new Promise(function (resolve, reject) {
            request(url, options, function (err, response, body) {
                if (err) {
                    return reject(err);
                }
                return resolve(body);
            });
        });
    }

    function getVersionsRequest() {
        return requestGet('http://www.lactame.com/visualizer/versions.json')
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
        debug('handle flavor');
        const flavorDir = getFlavorDir(flavorName, true);

        // Transforms the array-representation of a flavor's views as returned by couchdb
        // into a tree representation that reflects the views' hierarchy in a flavor
        let viewTree = yield flavorUtils.getTree(viewsList);
        // Set the path of each view to end up to
        yield flavorUtils.traverseTree(viewTree, doPath(flavorDir));
        // For each view fix version number
        yield flavorUtils.traverseTree(viewTree, fixVersion);
        // For each view generate the html in the appropriate directory
        yield flavorUtils.traverseTree(viewTree, generateHtml(flavorName, viewTree));

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

    function fixVersion(el) {
        if (el.__version) {
            if (!el.__version.startsWith('v')) {
                el.__version = 'v' + el.__version;
            }
        }
        if (el.__version === undefined || versions.indexOf(el.__version) === -1) {
            el.__version = 'HEAD-min';
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


            let data = {
                viewURL: selfContained ? (el.__view ? './view.json' : undefined) : getViewUrl(el, 'public'),
                dataURL: selfContained ? (el.__data ? './data.json' : undefined) : getDataUrl(el, 'public'),
                queryString: buildQueryString(el),
                version: el.__version,
                meta: el.__meta,
                structure: rootStructure,
                config: config,
                menuHtml: doMenu(rootStructure, basePath, flavorName),
                reldir: relativePath,
                readConfig: path.join(relativePath, READ_CONFIG),
                title: el.__name,
                home: path.join(relativePath, path.relative(config.dir, flavorDir)),
                flavor: flavorName,
                selfContained
            };

            let homeData;
            if (isHome && flavorDir === basePath) {
                data.home = '.';
                homeData = _.cloneDeep(data);
                homeData.menuHtml = doMenu(rootStructure, flavorDir, flavorName);
                homeData.reldir = path.relative(flavorDir, config.dir);
                homeData.readConfig = path.join(path.relative(flavorDir, config.dir), READ_CONFIG);
                if (homeData.reldir === '') homeData.reldir = '.';
            }

            let finalProm = Promise.resolve();
            finalProm = finalProm.then(function () {
                var prom = [];
                var layoutFile = layouts[config.flavorLayouts[flavorName] || DEFAULT_FLAVOR];
                writeFile(layoutFile, el.__path, data);

                // Now that the file is written the directory exists
                if (config.isSelfContained(flavorName)) {
                    if (el.__view) {
                        prom.push(new Promise(function (resolve, reject) {
                            var read = request(getViewUrl(el, 'local'), config.couchReqOptions);
                            var viewPath = path.join(basePath, 'view.json');
                            var write = fs.createWriteStream(viewPath);
                            write.on('finish', function () {
                                var prom = config.flatViews ? processViewForLibraries(viewPath, flavorName, path.join(config.flatViews.outdir, el.__id, 'view.json')) : Promise.resolve();
                                prom.then(function () {
                                    return processViewForLibraries(viewPath, flavorName);
                                }).then(function () {
                                    return resolve();
                                });
                            });

                            write.on('error', function () {
                                return reject();
                            });

                            read.on('error', function () {
                                return reject();
                            });
                            read.pipe(write);
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
                            write.on('error', function () {
                                return reject();
                            });
                            read.on('error', function () {
                                return reject();
                            });
                            read.pipe(write);
                        }));
                    }


                    fs.mkdirpSync(basePath);
                    fs.writeJsonSync(path.join(basePath, 'couch.json'), {
                        id: el.__id,
                        rev: el.__rev,
                        database: config.couchurl + '/' + config.couchDatabase
                    });
                }
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
            } else
                el.__path = path.join(el.__path, el.__filename, 'index.html');
        };
    }

    function writeFile(readpath, writepath, data) {
        // Compile a file and store it, rendering it later
        var tpl = swig.compileFile(readpath);
        var htmlcontent = tpl(data);
        var idx = writepath.lastIndexOf('/');
        var dir;
        if (idx > -1) dir = writepath.slice(0, idx);
        else dir = writepath;
        fs.mkdirpSync(dir);
        fs.writeFileSync(writepath, htmlcontent);
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
                        libs[i].lib = utils.fromVisuLocalUrl(config, libs[i].lib, false);
                    }
                }

            } catch (e) {
                console.error('Error  while processing view to change libraries', e, e.stack)
            }
        }, ['filter_editor', 'code_executor']);

        eachModule(view, function (module) {
            if (libraryNeedsProcess(module.url)) {
                prom.push(utils.cacheDir(config, module.url, flavorName, true));
                module.url = utils.fromVisuLocalUrl(config, module.url, false);
            }
        });

        try {
            if (view.aliases) {
                for (var i = 0; i < view.aliases.length; i++) {
                    let lib = view.aliases[i].path;
                    if (libraryNeedsProcess(lib)) {
                        prom.push(utils.cacheUrl(config, lib, flavorName, true));
                        view.aliases[i].path = utils.fromVisuLocalUrl(config, lib, false);
                    }
                }
            }
        } catch (e) {
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
            if (typeof(moduleNames) === 'string') {
                moduleNames = [moduleNames];
            } else if (!Array.isArray(moduleNames)) {
                moduleNames = [''];
            }
            var i = 0, ii = view.modules.length, module, url;
            var j, jj = moduleNames.length;
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
        if (el.__view) {
            if (config.isSelfContained(flavorName))
                result += 'viewURL=' + encodeURIComponent('./view.json');
            else
                result += 'viewURL=' + encodeURIComponent(config.couchurl + '/' + config.couchDatabase + '/' + el.__id + '/view.json?rev=' + el.__rev);
        }
        if (el.__data) {
            if (result !== '?') result += '&';
            if (config.isSelfContained(flavorName))
                result += 'dataURL=' + encodeURIComponent('./data.json');
            else
                result += 'dataURL=' + encodeURIComponent(config.couchurl + '/' + config.couchDatabase + '/' + el.__id + '/data.json?rev=' + el.__rev);
        }

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
        }
        else {
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
        for (var i = 0; i < toCopy.length; i++) {
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
        let visualizerUrl = (config.cdn + '/visualizer').replace(/^\/\//, 'https://');
        let parsedUrl = urlLib.parse(visualizerUrl);
        let file = version + '.tar.gz';
        let url = visualizerUrl + '/' + file;
        let extractDir = path.join(config.dir, config.libFolder, parsedUrl.hostname, parsedUrl.path, version);


        // Check if already exists
        try {
            fs.statSync(extractDir);
            return Promise.resolve();
        } catch (e) {
            return new Promise(function (resolve, reject) {
                console.log('copying visualizer', version);
                fs.mkdirpSync(extractDir);
                var reqOptions = {};
                utils.checkAuth(config, reqOptions, url);
                reqOptions.encoding = null;

                var read = request.get(url, reqOptions);
                read.on('error', function (err) {
                    console.log('read error');
                    reject(err);
                });
                var write = targz().createWriteStream(extractDir);
                write.on('finish', function () {
                    resolve();
                });

                write.on('error', function (err) {
                    reject(err);
                });

                read.pipe(write);
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
