'use strict';

const DEFAULT_FLAVOR = 'default';

var Promise = require('bluebird'),
    url = require('url'),
    _ = require('lodash'),
    swig = require('swig'),
    fs = require('fs-extra'),
    path = require('path'),
    request = require('request'),
    crypto = require('crypto'),
    co = require('co'),
    auth = '';


var config, layouts, toCopy, toSwig, nano, couchdb, versions, filters;

var queue = Promise.resolve();

function init(configArg) {
    config = require('./config')(configArg);
    nano = require('nano')(config.couchLocalUrl || config.couchurl);
    couchdb = nano.use(config.couchDatabase);
    filters = require('./filters')(config);
    layouts = config.layouts;
}

function build(configArg) {
    init(configArg);

    toCopy = [
        {src: './lib', dest: path.join(config.dir, './lib')},
        {src: './themes', dest: path.join(config.dir, './themes')},
        {src: './static', dest: path.join(config.dir, './static')}
    ];

    toSwig = [
        {src: './static/editConfig.json', dest: path.join(config.dir, './static/editConfig.json'), data: {config: config}},
        {src: './static/index.html', dest: path.join(config.dir, './static/index.html'), data: {config: config}}
    ];

    for (var key in filters) {
        swig.setFilter(key, filters[key]);
    }


    return co(function*() {
        versions = yield getVersionsRequest();
        if (config.flavor) {
            return yield couchAuthenticate()
                .then(getFlavors)
                .then(handleFlavors)
                .then(getFlavor)
                .then(handleFlavor(config.dir));
        }

        else {
            return yield couchAuthenticate()
                .then(getFlavors)
                .then(processFlavors)
                .then(filterFlavorsByMd5)
                .then(function (flavors) {
                    console.log('Processing ' + flavors.length + ' flavors');
                    var prom = [];
                    for (var i = 0; i < flavors.length; i++) {
                        let flavordir;
                        if (flavors[i] === DEFAULT_FLAVOR) {
                            flavordir = config.dir;
                        }
                        else {
                            flavordir = path.join(config.dir, 'flavor', flavors[i]);
                        }
                        fs.mkdirp(flavordir);
                        prom.push(getFlavor(flavors[i]).then(handleFlavor(flavordir)));
                    }
                    return Promise.all(prom);
                });
        }
    }).catch(handleError);
}

function couchAuthenticate() {
    return new Promise(function (resolve, reject) {
        if (!config.couchPassword) {
            // no auth needed
            resolve();
        }
        nano.auth(config.couchUsername, config.couchPassword, function (err, body, headers) {
            if (err) {
                return reject(err);
            }

            if (headers && headers['set-cookie']) {
                auth = headers['set-cookie'];
                nano = require('nano')({url: config.couchLocalUrl, cookie: auth[0]});
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
            return resolve(body);
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
                if(error) {
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

function getViewUrl(el, options) {
    options = options || {};
    return el.__view ? (options.absolute ? options.couchurl : '') + '/' + config.couchDatabase + '/' + el.__id + '/view.json?rev=' + el.__rev : undefined;
}

function getDataUrl(el, options) {
    options = options || {};
    return el.__data ? (options.absolute ? options.couchurl : '') + '/' + config.couchDatabase + '/' + el.__id + '/data.json?rev=' + el.__rev : undefined;
}

function getMetaUrl(el, options) {
    options = options || {};
    return el.__meta ? (options.absolute ? options.couchurl : '') + '/' + config.couchDatabase + '/' + el.__id + '/meta.json?rev=' + el.__rev : undefined;
}

function getVersion(el) {
    var url = getViewUrl(el, {absolute: true, couchurl: config.couchLocalUrl});
    return requestGet(url, config.couchReqOptions);
}


function handleFlavors(data) {
    var flavors = processFlavors(data);

    if (!flavors) {
        throw new Error('No flavors exist');
    }
    var flavorIdx = flavors.indexOf(config.flavor);
    if (flavorIdx === -1) {
        throw new Error('Flavor does not exist for couch user: ' + config.couchUsername);
    }
    return config.flavor;
}

function handleFlavor(dir) {
    if (!dir) dir = config.dir;
    return function (data) {
        var row, structure = {};
        Object.defineProperty(structure, '__root', {enumerable: false, writable: true});
        structure.__root = true;
        var prom = Promise.resolve();
        for (let i = 0; i < data.length; i++) {
            row = data[i];
            var flavors = row.value.flavors;
            prom = prom.then(getStructure(flavors, structure, row.value));
        }
        return prom.then(function () {
            addPath(structure, dir);
            return generateHtml(structure, structure, dir).then(function () {
                copyFiles();
                swigFiles();
            });
        });
    };
}

function getStructure(flavors, current, row) {
    return function () {
        if (!flavors.length) {
            current.__end = true;
            current.__data = row.data;
            current.__view = row.view;
            current.__meta = row.meta;
            current.__id = row._id;
            current.__rev = row._rev;
            current.filename = current.__name.trim().replace(/[^A-Za-z0-9.-]/g, '_');
            return getVersion(current).then(function (view) {
                view = JSON.parse(view);
                if (versions.indexOf(view.version) > -1)
                    current.version = view.version;
                else {
                    // Fallback version is HEAD-min!
                    // See https://github.com/cheminfo/flavor-builder/issues/9
                    current.version = 'HEAD-min';
                }
            });
        }

        var flavor = flavors.shift();
        if (!current[flavor])
            current[flavor] = {
                __name: flavor
            };
        return getStructure(flavors, current[flavor], row)();
    }
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

function handleError(err) {
    console.log('Error', err.message);
    console.log('Stack trace: ', err.stack);
}

function addPath(structure, currentPath) {
    for (var key in structure) {
        if (key === '__name') continue;
        var el = structure[key];
        if (el.__id) {
            el.__url = encodeURI(config.urlPrefix + '/' + path.join(currentPath, el.filename));
            if (config.selfContained)
                el.__path = path.join(currentPath, el.filename, 'index.html');
            else
                el.__path = path.join(currentPath, el.filename + '.html');
        }
        else if (key !== '__root') {
            addPath(structure[key], path.join(currentPath, el.__name));
        }
    }
}


function generateHtml(rootStructure, structure, currentPath) {
    var prom = [];
    for (var key in structure) {
        if (key === '__name') continue;
        let el = structure[key];
        var flavorName;
        var flavorDir;
        flavorName = /\/flavor\/([^\/]+)/.exec(currentPath);
        if (flavorName && flavorName[1]) {
            flavorName = flavorName[1];
            flavorDir = path.join(config.dir, 'flavor', flavorName);
        }
        else {
            flavorDir = config.dir;
        }
        //flavorDir = flavorDir.replace(/[^A-Za-z0-9.-\/]/g, '_');
        if (el.__id) {
            let relativePath = '';
            if (config.selfContained) {
                relativePath = path.relative(path.join(currentPath, 'dummy'), config.dir);
            }
            else {
                relativePath = path.relative(currentPath, config.dir);
            }
            relativePath = relativePath === '' ? '.' : relativePath;
            let data = {
                viewURL: config.selfContained ? (el.__view ? './view.json' : undefined) : getViewUrl(el, {
                    absolute: true,
                    couchurl: config.couchurl
                }),
                dataURL: config.selfContained ? (el.__data ? './data.json' : undefined) : getDataUrl(el, {
                    absolute: true,
                    couchurl: config.couchurl
                }),
                queryString: buildQueryString(el),
                version: el.version,
                structure: rootStructure,
                config: config,
                menuHtml: doMenu(rootStructure, currentPath),
                reldir: relativePath,
                readConfig: path.join(relativePath, config.readConfig),
                title: el.__name,
                home: path.join(relativePath, path.relative(config.dir, flavorDir)),
                flavor: flavorName || DEFAULT_FLAVOR
            };

            let homeData;
            if (el.__name === config.home) {
                data.home = '.';
                homeData = _.cloneDeep(data);
                homeData.menuHtml = doMenu(rootStructure, flavorDir, true);
                homeData.reldir = path.relative(flavorDir, config.dir);
                homeData.readConfig = path.join(path.relative(flavorDir, config.dir), config.readConfig);
                if (homeData.reldir === '') homeData.reldir = '.';
            }

            // If couch has meta.json, we make a request to get that file first
            let metaProm = Promise.resolve();
            if (el.__meta) {
                metaProm = metaProm.then(function () {
                    return new Promise(function (resolve, reject) {
                        var url = getMetaUrl(el, {absolute: true, couchurl: config.couchLocalUrl});
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
            prom.push(metaProm);
            metaProm.then(function () {
                var layoutFile = layouts[config.flavorLayouts[flavorName] || DEFAULT_FLAVOR];
                if (homeData) {
                    writeFile(layoutFile, path.join(flavorDir, 'index.html'), homeData);
                }
                else {
                    var pathToFile;
                    if (config.selfContained) {
                        pathToFile = path.join(currentPath, el.filename, 'index.html');
                    }
                    else {
                        pathToFile = path.join(currentPath, el.filename + '.html');
                    }
                    writeFile(layoutFile, pathToFile, data);
                }

                // Now that the file is written the directory exists
                if (config.selfContained) {
                    if (homeData) {
                        if (el.__view) {
                            // Add couch auth
                            var read = request(getViewUrl(el, {
                                absolute: true,
                                couchurl: config.couchLocalUrl
                            }), config.couchReqOptions);
                            var viewPath = path.join(currentPath, 'view.json');
                            var write = fs.createWriteStream(viewPath);
                            read.pipe(write);
                            write.on('finish', function () {
                                if (config.selfContained) {
                                    processViewForLibraries(viewPath, data.reldir);
                                }
                            });
                        }
                        if (el.__data)
                            request(getDataUrl(el, {
                                absolute: true,
                                couchurl: config.couchLocalUrl
                            }), config.couchReqOptions).pipe(fs.createWriteStream(path.join(currentPath, 'data.json')));
                    }

                    else {
                        if (el.__view) {
                            var read = request(getViewUrl(el, {
                                absolute: true,
                                couchurl: config.couchLocalUrl
                            }), config.couchReqOptions);
                            var viewPath = path.join(currentPath, el.filename, 'view.json');
                            var write = fs.createWriteStream(viewPath);
                            read.pipe(write);
                            write.on('finish', function () {
                                processViewForLibraries(viewPath, data.reldir);
                            });
                        }
                        if (el.__data)
                            request(getDataUrl(el, {
                                absolute: true,
                                couchurl: config.couchLocalUrl
                            }), config.couchReqOptions).pipe(fs.createWriteStream(path.join(currentPath, el.filename, 'data.json')));
                    }
                    fs.mkdirpSync(path.join(currentPath, el.filename));
                    fs.writeJsonSync(path.join(currentPath, el.filename, 'couch.json'), {
                        id: el.__id,
                        rev: el.__rev,
                        database: config.couchurl + '/' + config.couchDatabase
                    });
                }
            });
        }
        else {
            prom.push(generateHtml(rootStructure, el, path.join(currentPath, el.__name)));
        }
    }
    return Promise.all(prom);
}

function processViewForLibraries(viewPath, reldir) {
    var view = fs.readJsonSync(viewPath);
    var changed = false;
    eachModule(view, function (module) {
        try {
            var libs = module.configuration.groups.libs[0];
            for (var i = 0; i < libs.length; i++) {
                if (libraryNeedsProcess(libs[i].lib)) {
                    changed = true;
                    libs[i].lib = filters.processUrl(libs[i].lib, reldir);
                }
            }

        } catch (e) {
            console.error('Error  while processing view to change libraries', e)
        }
    }, ['filter_editor', 'code_executor']);

    try {
        if (!view.aliases) return;
        for (var i = 0; i < view.aliases.length; i++) {
            let lib = view.aliases[i].path;
            if (libraryNeedsProcess(lib)) {
                changed = true;
                view.aliases[i].path = filters.processUrl(lib, reldir);
            }
        }
    } catch (e) {
        console.error('Error while processing view to change library urls (general preferences)', e);
    }
    fs.writeJsonSync(viewPath, view);
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

function buildQueryString(el, options) {
    options = options || {};
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


function doMenu(structure, cpath, isHome) {
    var html = '';
    if (structure.__id) {
        if (structure.__name !== config.home) {
            if (!isHome) {
                html += '<li><a href="' + path.relative((config.selfContained ? path.join(cpath, 'dummy') : cpath), structure.__path) + buildQueryString(structure) + '"><span>' + structure.__name + '</span></a></li>';
            }

            else
                html += '<li><a href="' + path.relative(cpath, structure.__path) + buildQueryString(structure) + '"><span>' + structure.__name + '</span></a></li>';
        }
        return html;
    }
    else {
        if (structure.__name) html += '<li><a href="#">' + structure.__name + '</a>';
        html += '<ul' + (structure.__root ? ' class="navmenu" style="display:none"' : '') + '>';
        for (var key in structure) {
            if (key === '__name') continue;
            html += doMenu(structure[key], cpath, isHome);
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

function addToQueue(fn) {
    return function() {
        var _args = arguments;
        return queue.then(function() {
            return fn.apply(this, _args);
        });
    };
}

exports = module.exports = {
    build: addToQueue(build),
    getFlavors: addToQueue(function(configArg) {
        init(configArg);
        return co(function*() {
            return yield couchAuthenticate()
                .then(getFlavors)
                .then(processFlavors)
        });
    })
};