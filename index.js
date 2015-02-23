'use strict';

var parseArgs = require('minimist'),
    config = require('./config.json'),
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
    auth = '';

config.couchurl = config.couchurl.replace(/\/$/, '');


// Overwrite config from command line
var args = parseArgs(process.argv.slice(2));
for(var key in args) {
    config[key] = args[key];
}

var toCopy = [
    {src: './visualizer/config.json', dest: path.join(config.dir, 'config.json')},
    {src: './lib', dest: path.join(config.dir, './lib')},
    {src: './themes', dest: path.join(config.dir, './themes')}
];

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
            var url = config.couchurl + '/' + config.couchDatabase + '/_design/flavor/_list/config/alldocs?key="' + flavors + '"';
            request(url, {
                authxxx: {
                    user: config.couchUsername,
                    pass: config.couchPassword,
                    sendImmediately: true
                }
            }, function(error, response, body) {
                var md5 = crypto.createHash('md5').update(body).digest('hex');
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
         couchdb.view('flavor', 'docs', {key: [flavor, config.flavorUsername]}, function(err, body) {
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
        for(var i=0; i<data.rows.length; i++){
            row = data.rows[i];
            var flavors = row.value.flavors;
            getStructure(flavors, structure, row.value);
        }
        addPath(structure, dir);
        generateHtml(structure, structure, dir);
        copyFiles();
    }

}

function getStructure(flavors, current, row) {
    if(!flavors.length) {
        current.__end = true;
        current.__data = row.data;
        current.__view = row.view;
        current.__meta = row.meta;
        current.__id = row._id;
        current.__rev = row._rev;
        current.filename = current.__name.trim().replace(/[^A-Za-z0-9.-]/g, '_') + '.html';
        return;
    }

    var flavor = flavors.shift();
    if(!current[flavor])
        current[flavor]={
            __name: flavor
        };
    getStructure(flavors, current[flavor], row);
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
            el.__path = path.join(currentPath, el.filename);
        }
        else {
            addPath(structure[key], path.join(currentPath, el.__name));
        }
    }
}

function generateHtml(rootStructure, structure, currentPath) {
    for(var key in structure) {
        if(key === '__name') continue;
        var el = structure[key];
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
        if(el.__id) {
            var name = el.__name || '';
            var data = {
                viewURL: el.__view ? config.couchurl + '/' + config.couchDatabase + '/' + el.__id + '/view.json?rev=' + el.__rev : undefined,
                dataURL: el.__data ? config.couchurl + '/' + config.couchDatabase + '/' + el.__id + '/data.json?rev=' + el.__rev : undefined,
                structure: rootStructure,
                config: config,
                menuHtml: doMenu(rootStructure, currentPath),
                reldir: path.relative(currentPath, config.dir) === '' ? '.' : path.relative(currentPath, config.dir),
                title: el.__name,
                home: path.relative(currentPath, flavorDir)
            };

            var homeData;
            if(el.__name === config.home) {
                console.log('found home', flavorDir);
                homeData = _.cloneDeep(data);
                homeData.menuHtml = doMenu(rootStructure, flavorDir);
                homeData.reldir = path.relative(flavorDir, config.dir);
                if(homeData.reldir === '') homeData.reldir = '.';
            }

            // If couch has meta.json, we make a request to get that file first
            if(el.__meta) {
                console.log('meta defined', el.__name, flavorDir);
                (function(el){
                    var url = config.couchurl + '/' + config.couchDatabase + '/' + el.__id + '/meta.json?rev=' + el.__rev;
                    request(url, {
                        authxxx: {
                            user: config.couchUsername,
                            pass: config.couchPassword,
                            sendImmediately: true
                        }
                    }, function(error, response, body) {
                        if(!error && response.statusCode === 200) {
                            data.meta = JSON.parse(body);
                            console.log(data.meta.content);
                            if(homeData) {
                                homeData.meta = data.meta;
                                writeFile('./layout/' + config.layoutFile, path.join(flavorDir, 'index.html'), homeData);
                            }
                            else {
                                writeFile('./layout/' + config.layoutFile , path.join(currentPath, el.filename), data);
                            }
                        }
                    });
                })(el);
            }
            else {
                if(homeData) {
                    writeFile('./layout/' + config.layoutFile, path.join(flavorDir, 'index.html'), homeData);
                }
                else {
                    writeFile('./layout/' + config.layoutFile , path.join(currentPath,  el.filename), data);
                }
            }



        }
        else {
            generateHtml(rootStructure, el, path.join(currentPath, el.__name));
        }
    }
}


function doMenu(structure, cpath, html) {
    if(!html) html = '';
    if(structure.__id) {
        if(structure.__name !== config.home)
            html += '<li><a href="' + path.relative(cpath, structure.__path) + '">' + structure.__name + '</a></li>';
        return html;
    }
    else {
        if(structure.__name) html += '<li><a href="#">' + structure.__name  + '</a>';
        html += "<ul>";
        for(var key in structure) {
            if(key === '__name') continue;
            html += doMenu(structure[key], cpath);
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
if(config.flavor) {
    couchAuthenticate()
    .then(getFlavors)
    .then(handleFlavors)
    .then(getFlavor)
    .then(handleFlavor(config.dir))
    .catch(handleError);

}

else {
    getFlavors()
        .then(processFlavors)
        .then(filterFlavorsByMd5)
        .then(function(flavors) {
            console.log('Processing ' + flavors.length + ' flavors');
            var prom = [];
            for(var i=0; i<flavors.length; i++) {
                var flavordir;
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
        })
        .catch(handleError);
}
