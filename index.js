'use strict';

var parseArgs = require('minimist'),
    config = require('./config.json'),
    layouts = require('./layouts.json'),
    nano = require('nano')(config.couchurl),
    couchdb = nano.use(config.couchDatabase),
    Promise = require('bluebird'),
    url = require('url'),
    _ = require('lodash'),
    swig = require('swig'),
    fs = require('fs-extra'),
    path = require('path'),
    request = require('request'),
    crypto = require('crypto'),
    co = require('co'),
    auth = '';

config.couchurl = config.couchurl.replace(/\/$/, '');

// Overwrite config from command line
var args = parseArgs(process.argv.slice(2));
if(args.config) {
    config = require('./'+ path.join(args.config));
}
if(args.layouts) {
    layouts = require('./' + path.join(args.layouts))
}

for(var key in args) {
    config[key] = args[key];
}


config.flavorLayouts = config.flavorLayouts || {};

var toCopy = [
    {src: './lib', dest: path.join(config.dir, './lib')},
    {src: './themes', dest: path.join(config.dir, './themes')},
    {src: './static', dest: path.join(config.dir, './static')}
];

var toSwig = [
    {src: './static/editConfig.json', dest: path.join(config.dir, './static/editConfig.json'), data: {config: config}}
];


var versions;

co(function*() {
    versions = yield getVersionsRequest();
    if(config.flavor) {
        yield couchAuthenticate()
            .then(getFlavors)
            .then(handleFlavors)
            .then(getFlavor)
            .then(handleFlavor(config.dir));
    }

    else {
        yield couchAuthenticate()
            .then(getFlavors)
            .then(processFlavors)
            .then(filterFlavorsByMd5)
            .then(function(flavors) {
                console.log('Processing ' + flavors.length + ' flavors');
                var prom = [];
                for(var i=0; i<flavors.length; i++) {
                    let flavordir;
                    if(flavors[i] === 'default') {
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

function requestGet(url) {
    return new Promise(function (resolve, reject) {
        request(url, function(err, response, body) {
            if(err) {
                return reject(err);
            }
            return resolve(body);
        });
    });
}

function getVersionsRequest() {
    return requestGet('http://www.lactame.com/visualizer/versions.php')
}

function getViewUrl(el, options) {
    options = options || {};
    return el.__view ? (options.absolute ? config.couchurl : '') + '/' + config.couchDatabase + '/' + el.__id + '/view.json?rev=' + el.__rev: undefined;
}

function getDataUrl(el, options) {
    options = options || {};
    return el.__data ? (options.absolute ? config.couchurl : '') + '/' + config.couchDatabase + '/' + el.__id + '/data.json?rev=' + el.__rev : undefined;
}

function getMetaUrl(el, options) {
    options = options || {};
    return el.__meta ? (options.absolute ? config.couchurl : '') + '/' + config.couchDatabase + '/' + el.__id + '/meta.json?rev=' + el.__rev : undefined;
}

function getVersion(el) {
    var url = getViewUrl(el, {absolute: true});
    return requestGet(url);
}

function getFlavors() {
    return new Promise(function (resolve, reject) {
        couchdb.view('flavor', 'list', {key: config.flavorUsername}, function(err, body) {
            if(err) {
                return reject(err);
            }
            return resolve(body);
        });
    });
}

function getFlavorMD5(flavors) {
    if(flavors instanceof Array) {
        var prom = [];
        for(var i=0; i<flavors.length; i++) {
            prom.push(getFlavorMD5(flavors[i]));
        }
        return Promise.all(prom).then(function(md5s) {
            var result = {};
            for(var j=0 ;j<md5s.length; j++) {
                result[flavors[j]] = md5s[j];
            }
            return result;
        });
    }
    else {
        return new Promise(function (resolve, reject) {
            var key = encodeURIComponent(JSON.stringify([flavors, config.flavorUsername]));
            var url = config.couchurl + '/' + config.couchDatabase + '/_design/flavor/_view/docs?key=' + key ;
            var options = config.couchPassword ? {
                auth: {
                    user: config.couchUsername,
                    pass: config.couchPassword,
                    sendImmediately: true
                }
            } : {};
            request(url, options, function(error, response, body) {
                var x = JSON.stringify(JSON.parse(body).rows);
                var md5 = crypto.createHash('md5').update(x).digest('hex');
                return resolve(md5);
            });
        });
    }
}

function filterFlavorsByMd5(flavors) {
    return getFlavorMD5(flavors).then(function(result) {
        if(config.forceUpdate) {
            return Object.keys(result);
        }
        var exists = fs.existsSync('./md5s.json');
        if(!exists) {
            fs.writeJSONFileSync('./md5s.json', result);
            return Object.keys(result);
        }
        var md5 = fs.readJSONFileSync('./md5s.json');
        var keys = [];
        for(var key in result) {
            if(result[key] !== md5[key]) {
                keys.push(key);
            }
        }
        fs.writeJSONFileSync('./md5s.json', result);
        return keys;
    });
}

function filterFlavorByMD5(flavor) {
    return filterFlavorsByMd5([flavor]).then(function(flavors) {
        if(flavors.length) return flavors[0];
        return null;
    });
}

function couchAuthenticate() {
    return new Promise(function (resolve, reject) {
        if(!config.couchPassword) {
            // no auth needed
            resolve();
        }
        nano.auth(config.couchUsername, config.couchPassword, function (err, body, headers) {
            if (err) {
                return reject(err);
            }

            if (headers && headers['set-cookie']) {
                auth = headers['set-cookie'];

                //cookies[config.couchUsername] = headers['set-cookie'];
                nano = require('nano')({url: config.couchurl, cookie: auth[0] });
                couchdb = nano.use(config.couchDatabase);
            }
            console.log(auth);
            return resolve();
        });
    });
}

function processFlavors(data) {
    var result;
    if(data && data.rows && !_.isUndefined(data.rows.length)) {
        result = _.flatten(data.rows);
        result = _(result).pluck('value').flatten().value();
    }
    return result;
}



function handleFlavors(data) {
    var flavors = processFlavors(data);

    if(!flavors) {
        throw new Error('No flavors exist');
    }
    var flavorIdx = flavors.indexOf(config.flavor);
    if(flavorIdx === -1) {
        throw new Error('Flavor does not exist for couch user: ' + config.couchUsername);
    }
    return config.flavor;
}

function getFlavor(flavor) {
    return new Promise(function (resolve, reject) {
         couchdb.viewWithList('flavor', 'docs', 'sort', {key: [flavor, config.flavorUsername]}, function(err, body) {
       	     if(err) {
       	         return reject(err);
       	     }
       	     return resolve(body);
       	 });
    });
}


function handleFlavor(dir) {
    if(!dir) dir = config.dir;
    return function(data) {
        var row, structure = {};
        Object.defineProperty(structure, '__root', {enumerable: false, writable: true});
        structure.__root = true;
        var prom = Promise.resolve();
        for(let i=0; i<data.length; i++){
            row = data[i];
            var flavors = row.value.flavors;
            prom = prom.then(getStructure(flavors, structure, row.value));
        }
        return prom.then(function() {
            addPath(structure, dir);
            return generateHtml(structure, structure, dir).then(function() {
                copyFiles();
                swigFiles();
            });
        });
    };

}

function getStructure(flavors, current, row) {
    return function() {
    if(!flavors.length) {
        current.__end = true;
        current.__data = row.data;
        current.__view = row.view;
        current.__meta = row.meta;
        current.__id = row._id;
        current.__rev = row._rev;
        current.filename = current.__name.trim().replace(/[^A-Za-z0-9.-]/g, '_');
        return getVersion(current).then(function(view) {
            view = JSON.parse(view);
            if(versions.indexOf(view.version) > -1)
                current.version = view.version ;
            else {
                current.version = 'HEAD';
            }
        });
    }

    var flavor = flavors.shift();
    if(!current[flavor])
        current[flavor]={
            __name: flavor
        };
    return getStructure(flavors, current[flavor], row)();
    }
}

function writeFile(readpath, writepath, data) {
    // Compile a file and store it, rendering it later
    var tpl = swig.compileFile(readpath);
    var htmlcontent =  tpl(data);
    var idx = writepath.lastIndexOf('/');
    var dir;
    if(idx > -1) dir = writepath.slice(0, idx);
    else dir = writepath;
    fs.mkdirpSync(dir);
    fs.writeFileSync(writepath, htmlcontent);
}

function handleError(err) {
    console.log('Error', err.message);
    console.log('Stack trace: ', err.stack);
}

function addPath(structure, currentPath) {
    for(var key in structure) {
        if(key === '__name') continue;
        var el = structure[key];
        if(el.__id) {
            var name = el.__name || '';
            el.__url = encodeURI(config.urlPrefix + '/' + path.join(currentPath, el.filename));
            if(config.selfContained)
                el.__path = path.join(currentPath, el.filename, 'index.html');
            else
                el.__path = path.join(currentPath, el.filename + '.html');
        }
        else if(key !== '__root'){
            addPath(structure[key], path.join(currentPath, el.__name));
        }
    }
}


function generateHtml(rootStructure, structure, currentPath) {
    var prom = [];
    for(var key in structure) {
        if(key === '__name') continue;
        let el = structure[key];
        var flavorName;
        var flavorDir;
        flavorName = /\/flavor\/([^\/]+)/.exec(currentPath);
        if(flavorName && flavorName[1]) {
            flavorName = flavorName[1];
            flavorDir = path.join(config.dir, 'flavor', flavorName);
        }
        else {
            flavorDir = config.dir;
        }
    //flavorDir = flavorDir.replace(/[^A-Za-z0-9.-\/]/g, '_');
        if(el.__id) {
            let relativePath = '';
            if(config.selfContained) {
                relativePath = path.relative(path.join(currentPath, 'dummy'), config.dir);
            }
            else {
                relativePath = path.relative(currentPath, config.dir);
            }
            relativePath = relativePath === '' ? '.' : relativePath;
            let data = {
                viewURL: config.selfContained ? (el.__view ? './view.json' : undefined) : getViewUrl(el, {absolute:true}),
                dataURL: config.selfContained ? (el.__data ? './data.json' : undefined) : getDataUrl(el, {absolute:true}),
                version: el.version,
                structure: rootStructure,
                config: config,
                menuHtml: doMenu(rootStructure, currentPath),
                reldir: relativePath,
                readConfig:  path.join(relativePath, config.readConfig),
                title: el.__name,
                home: path.join(relativePath, path.relative(config.dir, flavorDir))
            };


            let homeData;
            if(el.__name === config.home) {
                data.home = '.';
                homeData = _.cloneDeep(data);
                homeData.menuHtml = doMenu(rootStructure, flavorDir, true);
                homeData.reldir = path.relative(flavorDir, config.dir);
                homeData.readConfig = path.join(path.relative(flavorDir, config.dir), config.readConfig);
                if(homeData.reldir === '') homeData.reldir = '.';
            }

            // If couch has meta.json, we make a request to get that file first
            let metaProm = Promise.resolve();
            if(el.__meta) {
                metaProm = metaProm.then(function() {
                    return new Promise(function (resolve, reject) {
                        var url = getMetaUrl(el, {absolute: true});
                        var options = config.couchPassword ? {
                            auth: {
                                user: config.couchUsername,
                                pass: config.couchPassword,
                                sendImmediately: true
                            }
                        } : {};
                        request(url, options, function(error, response, body) {
                            if(!error && response.statusCode === 200) {
                                data.meta = JSON.parse(body);
                                if(homeData){
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
            metaProm.then(function() {
                var layoutFile = layouts[config.flavorLayouts[flavorName] || 'default'];
                if(homeData) {
                    writeFile('./layout/' + layoutFile, path.join(flavorDir, 'index.html'), homeData);
                }
                else {
                    var pathToFile;
                    if(config.selfContained) {
                        pathToFile = path.join(currentPath, el.filename, 'index.html');
                    }
                    else {
                        pathToFile = path.join(currentPath, el.filename + '.html');
                    }
                    writeFile('./layout/' + layoutFile, pathToFile, data);
                }

                // Now that the file is written the directory exists
                if(config.selfContained) {
                    if(homeData) {
                        if(el.__view)
                            request(getViewUrl(el, {absolute: true})).pipe(fs.createWriteStream(path.join(currentPath, 'view.json')));
                        if(el.__data)
                            request(getDataUrl(el, {absolute: true})).pipe(fs.createWriteStream(path.join(currentPath, 'data.json')));
                    }

                    else {
                        if(el.__view)
                            request(getViewUrl(el, {absolute: true})).pipe(fs.createWriteStream(path.join(currentPath, el.filename, 'view.json')));
                        if(el.__data)
                            request(getDataUrl(el, {absolute: true})).pipe(fs.createWriteStream(path.join(currentPath, el.filename, 'data.json')));
                    }
                }
            });
        }
        else {
            prom.push(generateHtml(rootStructure, el, path.join(currentPath, el.__name)));
        }
    }
    return Promise.all(prom);
}

function buildQueryString(el) {
    var result = '?';
    if(el.__view) {
        if(config.selfContained)
            result += 'viewURL=' + encodeURIComponent('./view.json');
        else
            result += 'viewURL=' + encodeURIComponent(config.couchurl + '/' + config.couchDatabase + '/' + el.__id + '/view.json?rev=' + el.__rev);
    }
    if(el.__data) {
        if(result !== '?') result += '&';
        if(config.selfContained)
            result += 'dataURL=' + encodeURIComponent('./data.json');
        else
            result += 'dataURL=' + encodeURIComponent(config.couchurl + '/' + config.couchDatabase + '/' + el.__id + '/data.json?rev=' + el.__rev);
    }
    if(el.version) {
        if(result !== '?') result += '&';
        result += 'v=' + encodeURIComponent(el.version);
    }

    if(result === '?') return '';
    return result;
}


function doMenu(structure, cpath, isHome) {
    var html = '';
    if(structure.__id) {
        if(structure.__name !== config.home) {
            if (!isHome) {
                html += '<li><a href="' + path.relative((config.selfContained ? path.join(cpath, 'dummy') : cpath), structure.__path) + buildQueryString(structure) + '">' + structure.__name + '</a></li>';
            }

            else
                html += '<li><a href="' + path.relative(cpath, structure.__path) + buildQueryString(structure) + '">' + structure.__name + '</a></li>';
        }
        return html;
    }
    else {
        if(structure.__name) html += '<li><a href="#">' + structure.__name  + '</a>';
        html += '<ul' + (structure.__root ? ' class="navmenu" style="display:none"' : '') + '>';
        for(var key in structure) {
            if(key === '__name') continue;
            html += doMenu(structure[key], cpath, isHome);
        }
        html += '</ul>';
        if(structure.__name) html += '</li>';
    }
    return html;
}

function copyFiles() {
    for(var i=0; i<toCopy.length; i++) {
        fs.copySync(toCopy[i].src, toCopy[i].dest);
    }
}

function swigFiles() {
    for(var i=0; i<toSwig.length; i++) {
        writeFile(toSwig[i].src, toSwig[i].dest, toSwig[i].data);
    }
}