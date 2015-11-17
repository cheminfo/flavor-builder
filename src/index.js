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
    flavorUtils = require('flavor-utils'),
    utils = require('./utils'),
    wf = require('./writeFile'),
    targz = require('tar.gz'),
    auth = '';

var pathCharactersRegExp = /[^A-Za-z0-9.-]/g;

function call(f, configArg) {
    var config, layouts, toCopy, toSwig, nano, couchdb, versions, filters;

    function init(configArg) {
        config = require('./config')(configArg);
        filters = require('./filters')(config);
        layouts = config.layouts;
        nano = require('nano')(config.couchLocalUrl || config.couchurl);
        return couchAuthenticate();
    }

    return init(configArg).then(function() {
        return eval(f + '()'); 
    });

    function build() {
        toCopy = [
            {src: path.join(__dirname, '../lib'), dest: path.join(config.dir, './lib')},
            {src: path.join(__dirname, '../themes'), dest: path.join(config.dir, './themes')},
            {src: path.join(__dirname, '../static'), dest: path.join(config.dir, './static')}
        ];

        toSwig = [
            {
                src: path.join(__dirname, '../static/editConfig.json'),
                dest: path.join(config.dir, './static/editConfig.json'),
                data: {config: config}
            },
            {
                src: path.join(__dirname, '../static/index.html'),
                dest: path.join(config.dir, './static/index.html'),
                data: {config: config}
            }
        ];

        for (var key in filters) {
            swig.setFilter(key, filters[key]);
        }


        return co(function*() {
            versions = yield getVersionsRequest();
            if (config.flavor) {
                let exists = yield hasFlavor(config.flavor);
                if (!exists) {
                    console.log('Flavor not found');
                    return;
                }
                let flavor = yield getFlavor(config.flavor);
                yield handleFlavor(config.dir, flavor);
                return yield Promise.all(filters.plist);
            }

            else {
                let flavors = yield getFlavors();
                flavors = yield filterFlavorsByMd5(flavors);
                console.log('Processing ' + flavors.length + ' flavors');
                for (let i = 0; i < flavors.length; i++) {
                    let flavorDir;
                    if (flavors[i] === DEFAULT_FLAVOR) {
                        flavorDir = config.dir;
                    }
                    else {
                        flavorDir = path.join(config.dir, 'flavor', flavors[i]);
                    }
                    fs.mkdirp(flavorDir);
                    let flavor = yield getFlavor(flavors[i]);
                    yield handleFlavor(flavorDir, flavor);
                    yield Promise.all(filters.plist);
                }
            }
        });
    }


    function couchAuthenticate() {
        return new Promise(function (resolve, reject) {
            if (!config.couchPassword) {
                // no auth needed
                couchdb = nano.use(config.couchDatabase);
                resolve();
            }
            nano.auth(config.couchUsername, config.couchPassword, function (err, body, headers) {
                if (err) {
                    return reject(err);
                }

                if (headers && headers['set-cookie']) {
                    auth = headers['set-cookie'];
                    nano = require('nano')({url: config.couchLocalUrl || config.couchurl, cookie: auth[0]});
                    couchdb = nano.use(config.couchDatabase);
                }
                return resolve();
            });
        });
    }

// returns an array of flavors for which the md5 has changed
    function filterFlavorsByMd5(flavors) {
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
        return new Promise(function (resolve, reject) {
            couchdb.view('flavor', 'list', {key: config.flavorUsername}, function (err, body) {
                if (err) {
                    return reject(err);
                }
                return resolve(processFlavors(body));
            });
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
            return new Promise(function (resolve, reject) {
                var key = encodeURIComponent(JSON.stringify([flavors, config.flavorUsername]));
                var url = config.couchLocalUrl + '/' + config.couchDatabase + '/_design/flavor/_view/docs?key=' + key;
                request(url, config.couchReqOptions, function (error, response, body) {
                    if (error) {
                        return reject(error);
                    }
                    var x = JSON.stringify(JSON.parse(body).rows);
                    var md5 = crypto.createHash('md5').update(x).digest('hex');
                    return resolve(md5);
                });
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
        return new Promise(function (resolve, reject) {
            couchdb.viewWithList('flavor', 'docs', 'sort', {key: [flavor, config.flavorUsername]}, function (err, body) {
                if (err) {
                    return reject(err);
                }
                return resolve(body);
            });
        });
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

    function getViewUrl(el, couchurl) {
        return el.__view ? couchurl + '/' + config.couchDatabase + '/' + el.__id + '/view.json?rev=' + el.__rev : undefined;
    }

    function getDataUrl(el, couchurl) {
        return el.__data ? couchurl + '/' + config.couchDatabase + '/' + el.__id + '/data.json?rev=' + el.__rev : undefined;
    }

    function getMetaUrl(el, couchurl) {
        return el.__meta ? couchurl + '/' + config.couchDatabase + '/' + el.__id + '/meta.json?rev=' + el.__rev : undefined;
    }

    function getVersion(el) {
        var url = getViewUrl(el, config.couchLocalUrl);
        return requestGet(url, config.couchReqOptions);
    }

    function*hasFlavor() {
        let flavors = yield getFlavors();
        if (!flavors) {
            return false;
        }
        var flavorIdx = flavors.indexOf(config.flavor);
        return flavorIdx !== -1;
    }

    function*handleFlavor(dir, data) {
        if (!dir) dir = config.dir;

        let structure = yield flavorUtils.getTree(data);
        yield flavorUtils.traverseTree(structure, doPath(dir));
        yield flavorUtils.traverseTree(structure, setVersion);
        yield flavorUtils.traverseTree(structure, generateHtml(structure));

        if (config.selfContained) {
            let versions = yield getVersionsFromTree(structure);
            let copies = new Array(versions.length);
            for (let i = 0; i < versions.length; i++) {
                copies[i] = copyVisualizer(versions[i]);
            }
            yield copies;
        }
        copyFiles();
        swigFiles();
    }

    function*getVersionsFromTree(tree) {
        let versions = [];
        yield flavorUtils.traverseTree(tree, function (el) {
            if (el.__version !== undefined) {
                versions.push(el.__version);
            }
        });
        return _.uniq(versions);
    }


    function generateHtml(rootStructure) {
        return function (el) {
            let flavorDir;
            let isHome = el.__id && el.__name === config.home;
            let basePath = path.parse(el.__path).dir;
            let flavorName = /\/flavor\/([^\/]+)/.exec(basePath);
            if (flavorName && flavorName[1]) {
                flavorName = flavorName[1];
                flavorDir = path.join(config.dir, 'flavor', flavorName);
            }
            else {
                flavorDir = config.dir;
            }
            let relativePath = path.relative(basePath, config.dir) || '.';

            let data = {
                viewURL: config.selfContained ? (el.__view ? './view.json' : undefined) : getViewUrl(el, config.couchurl),
                dataURL: config.selfContained ? (el.__data ? './data.json' : undefined) : getDataUrl(el, config.couchurl),
                queryString: buildQueryString(el),
                version: el.__version,
                structure: rootStructure,
                config: config,
                menuHtml: doMenu(rootStructure, basePath),
                reldir: relativePath,
                readConfig: path.join(relativePath, READ_CONFIG),
                title: el.__name,
                home: path.join(relativePath, path.relative(config.dir, flavorDir)),
                flavor: flavorName || DEFAULT_FLAVOR
            };

            let homeData;
            if (isHome && flavorDir === basePath) {
                data.home = '.';
                homeData = _.cloneDeep(data);
                homeData.menuHtml = doMenu(rootStructure, flavorDir);
                homeData.reldir = path.relative(flavorDir, config.dir);
                homeData.readConfig = path.join(path.relative(flavorDir, config.dir), READ_CONFIG);
                if (homeData.reldir === '') homeData.reldir = '.';
            }

            // If couch has meta.json, we make a request to get that file first
            let metaProm = Promise.resolve();
            if (el.__meta) {
                metaProm = metaProm.then(function () {
                    return new Promise(function (resolve, reject) {
                        var url = getMetaUrl(el, config.couchLocalUrl);
                        request(url, config.couchReqOptions, function (error, response, body) {
                            if (!error && response.statusCode === 200) {
                                data.meta = JSON.parse(body);
                                if (homeData) {
                                    homeData.meta = data.meta;
                                }
                                return resolve();
                            }
                            return reject();
                        });
                    })
                });
            }
            metaProm = metaProm.then(function () {
                var prom = [];
                var layoutFile = layouts[config.flavorLayouts[flavorName] || DEFAULT_FLAVOR];
                writeFile(layoutFile, el.__path, data);

                // Now that the file is written the directory exists
                if (config.selfContained) {
                    if (el.__view) {
                        prom.push(new Promise(function(resolve, reject) {
                            var read = request(getViewUrl(el, config.couchLocalUrl), config.couchReqOptions);
                            var viewPath = path.join(basePath, 'view.json');
                            var write = fs.createWriteStream(viewPath);
                            write.on('finish', function () {
                                var prom = config.flatViews ? processViewForLibraries(viewPath, path.join(config.flatViews.outdir, el.__id, 'view.json')) : Promise.resolve();
                                prom.then(function() {
                                    return processViewForLibraries(viewPath);
                                }).then(function() {
                                    return resolve();
                                });
                            });

                            write.on('error', function() {
                                return reject();
                            });

                            read.on('error', function () {
                                return reject();
                            });
                            read.pipe(write);
                        }));
                    }
                    if (el.__data) {
                        prom.push(new Promise(function(resolve, reject) {
                            var read = request(getDataUrl(el, config.couchLocalUrl), config.couchReqOptions);
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

            return metaProm;
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

    function setVersion(el) {
        return getVersion(el).then(function (view) {
            view = JSON.parse(view);
            if (versions.indexOf(view.version) > -1)
                el.__version = view.version;
            else {
                // Fallback version is HEAD-min!
                // See https://github.com/cheminfo/flavor-builder/issues/9
                el.__version = 'HEAD-min';
            }
        });
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

    function processViewForLibraries(viewPath, out) {
        var prom = [];
        var view = fs.readJsonSync(viewPath);
        eachModule(view, function (module) {
            try {
                var libs = module.configuration.groups.libs[0];
                for (var i = 0; i < libs.length; i++) {
                    if (libraryNeedsProcess(libs[i].lib)) {
                        prom.push(utils.cacheUrl(config, libs[i].lib, true));
                        libs[i].lib = utils.fromVisuLocalUrl(config, libs[i].lib, false);
                    }
                }

            } catch (e) {
                console.error('Error  while processing view to change libraries', e, e.stack)
            }
        }, ['filter_editor', 'code_executor']);

        try {
            if (view.aliases) {
                for (var i = 0; i < view.aliases.length; i++) {
                    let lib = view.aliases[i].path;
                    if (libraryNeedsProcess(lib)) {
                        prom.push(utils.cacheUrl(config, lib, true));
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
                    if(!moduleNames) {
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

    function buildQueryString(el) {
        var result = '?';
        if (el.__view) {
            if (config.selfContained)
                result += 'viewURL=' + encodeURIComponent('./view.json');
            else
                result += 'viewURL=' + encodeURIComponent(config.couchurl + '/' + config.couchDatabase + '/' + el.__id + '/view.json?rev=' + el.__rev);
        }
        if (el.__data) {
            if (result !== '?') result += '&';
            if (config.selfContained)
                result += 'dataURL=' + encodeURIComponent('./data.json');
            else
                result += 'dataURL=' + encodeURIComponent(config.couchurl + '/' + config.couchDatabase + '/' + el.__id + '/data.json?rev=' + el.__rev);
        }

        if (result === '?') return '';
        return result;
    }


    function doMenu(structure, cpath) {
        var html = '';
        if (structure.__id) {
            if (structure.__name !== config.home) {
                html += '<li><a href="' + path.relative(cpath, structure.__path) + buildQueryString(structure) + '"><span>' + structure.__name + '</span></a></li>';
            } // No leaf for home elements
            return html;
        }
        else {
            var link = structure.__homeChild ? path.relative(cpath, structure.__homeChild.__path) + buildQueryString(structure.__homeChild) : '#';

            if (structure.__name) html += '<li><a href="' + link + '">' + structure.__name + '</a>';
            html += '<ul' + (structure.__root ? ' class="navmenu" style="display:none"' : '') + '>';
            for (var key in structure) {
                if (key.startsWith('__')) continue;
                html += doMenu(structure[key], cpath);
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
                var write = targz().createWriteStream(extractDir);
                write.on('finish', function () {
                    return resolve();
                });

                write.on('error', function (err) {
                    return reject(err);
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
