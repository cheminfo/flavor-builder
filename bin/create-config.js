/**
 * Heirarchical conversation example
 */

'use strict';
const inquirer = require('inquirer');
const fs = require('fs-extra');
const path = require('path');

const LAYOUT_DEFAULT = 'Visualizer with menu';
const LAYOUT_ON_TABS = 'visualizer-on-tabs';
const LAYOUT_SEARCH = 'Visualizer with menu and search box';

const config = {
    flavors: [],
    rocLogin: {},
    flavorLayouts: {},
    layouts: {
        [LAYOUT_DEFAULT]: 'simplemenu/endlayouts/simplemenu.html',
        [LAYOUT_SEARCH]: 'simplemenu/endlayouts/simple.html'
    },
    libFolder: 'Q92ELCJKTIDXB',
    cdn: 'https://www.lactame.com',
    direct: 'https://direct.lactame.com',
    visualizerOnTabs: {}
};
var configPath = '';


var filePathPrompt = {
    type: 'input',
    required: true,
    name: 'configPath',
    message: 'Where would you like to create the configuration file?'
};

var overwritePrompt = {
    type: 'confirm',
    required: true,
    name: 'overwrite',
    message: 'The file exists, would you like to overwrite it?'
};

var dirPathPrompt = {
    type: 'input',
    required: true
};

var addFlavorPrompt = [
    {
        name: 'name',
        type: 'input',
        required: true,
        message: 'What is the flavor name?',
    },
    {
        name: 'layout',
        type: 'list',
        required: true,
        choices: [LAYOUT_DEFAULT, LAYOUT_SEARCH, LAYOUT_ON_TABS],
        message: 'What layout would you like to use?',
        default: 'Visualizer with menu'
    },
    {
        name: 'login',
        type: 'confirm',
        required: true,
        message: 'Should the built page have a login link'
    }
];

var loginPrompt = [
    {
        name: 'url',
        type: 'input',
        required: true,
        message: 'What is the login url?'
    },
    {
        name: 'auto',
        type: 'confirm',
        required: true,
        message: 'Should the user be automatically redirected if not logged in?'
    }
];

var generalPrompt = [
    {
        name: 'couchLocalurl',
        type: 'input',
        required: true,
        message: 'What is your local couch url?',
        default: '127.0.0.1:5984'
    },
    {
        name: 'couchurl',
        type: 'input',
        required: true,
        message: 'What is your public couch url?',
    },
    {
        name: 'couchDatabase',
        type: 'input',
        required: true,
        message: 'What is the name of the database you would like to build?',
    },
    {
        name: 'flavorUsername',
        type: 'input',
        required: true,
        message: 'What is the user for which you would like to build?',
    },
    {
        name: 'flavor',
        type: 'input',
        required: false,
        message: 'Would you like to build all flavors a just a specific flavor? (just press enter to build all flavors)'
    },
    {
        name: 'selfContained',
        type: 'confirm',
        required: true,
        message: 'Would you like the created directory to be self-contained? (all static resources will be copied)',
    }
];

var visualizerOnTabsPrompt = {
    type: 'confirm',
    name: 'addRewrite',
    required: true,
    message: 'Would you like to add the default rewrite urls to your on-tabs configuration?'
};


function main() {
    filePath()
        .then(buildDir)
        .then(addFlavors)
        .then(general)
        .then(postProcess)
        .then(writeConfig)
        .catch(function (e) {
            console.error('error', e);
        });
}

function general() {
    return inquirer.prompt(generalPrompt).then(function (answer) {
        Object.assign(config, answer);
    });
}

function overwrite() {
    return inquirer.prompt(overwritePrompt).then(function (answer) {
        if (!answer.overwrite) {
            return filePath();
        }
    })
}

function writeConfig() {
    fs.writeJsonSync(configPath, config);
}

function buildDir() {
    return dirPath({
        name: 'dir',
        message: 'What is your build output directory? (the website\'s root directory or sub-directory)',
        cb: buildDir
    })
}

function createDirectory(dir, cb) {
    var createDirectoryPrompt = {
        type: 'confirm',
        required: true,
        name: 'createDir',
        message: `The directory ${dir} does not exist, would you like to create it?`
    };
    return inquirer.prompt(createDirectoryPrompt).then(function (answer) {
        if (answer.createDir) {
            fs.mkdirpSync(dir);
        } else {
            return cb();
        }
    })
}

function dirPath(options) {
    options = Object.assign({}, dirPathPrompt, options);
    return inquirer.prompt(options).then(function (answer) {
        var dir = path.resolve(process.cwd(), answer[options.name]);
        config[options.name] = dir;
        try {
            fs.statSync(dir);
        } catch (e) {
            return createDirectory(dir, options.cb);
        }
    });
}

function filePath() {
    return inquirer.prompt(filePathPrompt).then(function (answer) {
        configPath = path.resolve(process.cwd(), answer.configPath);
        try {
            fs.statSync(configPath);
            return overwrite();

        } catch (e) {
        }
        var dir = path.parse(configPath).dir;
        try {
            fs.statSync(dir);
        } catch (e) {
            return createDirectory(dir, filePath);
        }
    });
}

function addFlavor() {
    return inquirer.prompt(addFlavorPrompt).then(function (answer) {
        var prom = Promise.resolve();
        if (answer.login) {
            prom = prom.then(() => inquirer.prompt(loginPrompt).then(function (ans) {
                answer.login = ans;
                return answer;
            }));
        }
        if (answer.layout === 'visualizer-on-tabs') {
            prom = prom.then(() => inquirer.prompt(visualizerOnTabsPrompt)).then(function(ans) {
                answer.visualizerOnTabs = ans;
            });
        }
        return prom.then(function() {
            if(!answer.login) delete answer.login;
            return answer;
        });
    });
}

function addFlavors() {
    return inquirer.prompt({
        name: 'continue',
        type: 'confirm',
        message: 'Would you like to add another flavor configuration?',
        required: true
    }).then(function (ans) {
        if (ans.continue) {
            return addFlavor().then(function (answer) {
                config.flavors.push(answer);
                return addFlavors();
            });
        }
    });
}

function postProcess() {
    var p = {};
    Object.assign(config, p);
    for (var i = 0; i < config.flavors.length; i++) {
        var flavor = config.flavors[i];
        config.flavorLayouts[flavor.name] = flavor.layout;
        if(flavor.visualizerOnTabs) {
            var onTabsConfig = config.visualizerOnTabs[flavor.name] = {};
            onTabsConfig.rocLogin = flavor.login;
            if(flavor.visualizerOnTabs.addRewrite) {
                onTabsConfig.rewriteRules = [
                    {reg: "^[^/]+$", replace: `${config.couchurl}/cheminfo-public/$&/view.json`},
                    {reg: "^[^/]+\/[^/]+$", replace: `${config.couchurl}/$&/view.json`},
                    {reg: "^[^/]+\/view.json.*", replace: `${config.couchurl}/cheminfo-public/$&`},
                    {reg: "^[^/]+\/[^/]+\/view.json.*", replace: `${config.couchurl}/$&`}
                ];
            } else {
                onTabsConfig.rewriteRules = [];
            }
        } else if (flavor.login) {
            config.rocLogin[flavor.name] = flavor.login;
        }
    }
    delete config.flavors;
    if(!config.flavor) delete config.flavor;
}


main();
