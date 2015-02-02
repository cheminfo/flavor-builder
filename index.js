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
    {src: './themes', dest: path.join(config.dir, './themes')},
    {src: './static', dest: path.join(config.dir, './static')}
];

function getFlavors() {
    return new Promise(function (resolve, reject) {
        couchdb.view('flavor', 'list', {key: config.couchUsername}, function(err, body) {
            console.log(err ,body);
            if(err) {
                return reject(err);
            }
            return resolve(body);
        });
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

function processViewResult(data) {
    var result;
    if(data && data.rows && !_.isUndefined(data.rows.length)) {
        result = _.flatten(data.rows);
        result = _(result).pluck('value').flatten().value();
    }
    return result;
}

function handleFlavors(data) {
    var flavors = processViewResult(data);

    if(!flavors) {
        throw new Error('No flavors exist');
    }
    var flavorIdx = flavors.indexOf(config.flavor);
    if(flavorIdx === -1) {
        throw new Error('Flavor does not exist for couch user: ' + config.couchUsername);
    }
}

function getFlavor() {
    var flavor = config.flavor;
    return new Promise(function (resolve, reject) {
        couchdb.view('flavor', 'docs', {key: [config.flavor, config.couchUsername]}, function(err, body) {
            if(err) {
                return reject(err);
            }
            return resolve(body);
        });
    });
}

function handleFlavor(data) {
    var row, structure = {};
    for(var i=0; i<data.rows.length; i++){
        row = data.rows[i];
        var flavors = row.value.flavors;
        getStructure(flavors, structure, row.value);
    }
    addPath(structure, config.dir);
    generateHtml(structure, structure, config.dir);
    copyFiles();
}

function getStructure(flavors, current, row) {
    if(!flavors.length) {
        current.__end = true;
        current.__data = row.data;
        current.__view = row.view;
        current.__meta = row.meta;
        current.__id = row._id;
        current.__rev = row._rev;
        return;
    }

    var flavor = flavors.shift();
    if(!current[flavor])
        current[flavor]={__name: flavor};
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
            el.__url = encodeURI(config.urlPrefix + '/' + path.join(currentPath, name.trim()+'.html'));
            el.__path = path.join(currentPath, name.trim() + '.html');
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
        if(el.__id) {
            var name = el.__name || '';
            var data = {
                viewURL: el.__view ? config.couchurl + '/' + config.couchDatabase + '/' + el.__id + '/view.json?rev=' + el.__rev : undefined,
                dataURL: el.__data ? config.couchurl + '/' + config.couchDatabase + '/' + el.__id + '/data.json?rev=' + el.__rev : undefined,
                structure: rootStructure,
                config: config,
                menuHtml: doMenu(rootStructure, currentPath),
                reldir: path.relative(currentPath, config.dir) === '' ? '.' : path.relative(currentPath, config.dir),
                title: el.__name
            };

            var homeData;
            console.log(currentPath);
            if(el.__name === config.home) {
                homeData = _.cloneDeep(data);
                homeData.menuHtml = doMenu(rootStructure, config.dir);
                homeData.reldir = '.';
            }

            if(el.__meta) {
                var url = config.couchurl + '/' + config.couchDatabase + '/' + el.__id + '/meta.json?rev=' + el.__rev;
                request(url, {
                    auth: {
                        user: 'username',
                        pass: 'password',
                        sendImmediately: false
                    }
                }, function(error, response, body) {
                    if(!error && response.statusCode === 200) {
                        data.meta = JSON.parse(body);
                        writeFile('./layout/' + config.layoutFile , path.join(currentPath, name.trim()) + '.html', data);
                        if(homeData) {
                            writeFile('./layout/' + config.layoutFile, path.join(config.dir, 'index.html'), homeData);
                        }
                    }
                });
            }
            else {
                writeFile('./layout/' + config.layoutFile , path.join(currentPath, name.trim()) + '.html', data);
                writeFile('./layout/' + config.layoutFile, path.join(config.dir, 'index.html'), homeData);
            }



        }
        else {
            generateHtml(rootStructure, el, path.join(currentPath, el.__name))
        }
    }
}


function doMenu(structure, cpath, html) {
    if(!html) html = '';
    if(structure.__id) {
        debugger;
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


couchAuthenticate()
    .then(getFlavors)
    .then(handleFlavors)
    .then(getFlavor)
    .then(handleFlavor)
    .catch(handleError);