'use strict';

const path = require('path');

const fs = require('fs-extra');
const inquirer = require('inquirer');

const LAYOUT_DEFAULT = 'Visualizer with menu';
const LAYOUT_ON_TABS = 'visualizer-on-tabs';
const LAYOUT_SEARCH = 'Visualizer with menu and search box';

function filterUndef(input) {
  if (!input) return undefined;
  return input;
}

const config = {
  flavors: [],
  rocLogin: {},
  flavorLayouts: {},
  layouts: {
    [LAYOUT_DEFAULT]: 'simplemenu/endlayouts/simplemenu.html',
    [LAYOUT_SEARCH]: 'simplemenu/endlayouts/simple.html',
  },
  libFolder: 'Q92ELCJKTIDXB',
  cdn: 'https://www.lactame.com',
  direct: 'https://direct.lactame.com',
  visualizerOnTabs: {},
};
let configPath = '';

let filePathPrompt = {
  type: 'input',
  required: true,
  name: 'configPath',
  message: 'Where would you like to create the configuration file?',
};

let overwritePrompt = {
  type: 'confirm',
  required: true,
  name: 'overwrite',
  message: 'The file exists, would you like to overwrite it?',
};

let dirPathPrompt = {
  type: 'input',
  required: true,
};

let addFlavorPrompt = [
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
    default: 'Visualizer with menu',
  },
  {
    name: 'login',
    type: 'confirm',
    required: true,
    message: 'Should the built page have rest-on-couch login link',
  },
];

let loginPrompt = [
  {
    name: 'url',
    type: 'input',
    required: true,
    message: 'What is the login url?',
  },
  {
    name: 'auto',
    type: 'confirm',
    required: true,
    message: 'Should the user be automatically redirected if not logged in?',
  },
];

let generalPrompt = [
  {
    name: 'couchLocalurl',
    type: 'input',
    required: true,
    message: 'What is your local couch url?',
    default: '127.0.0.1:5984',
  },
  {
    name: 'couchurl',
    type: 'input',
    required: true,
    message: 'What is your public couch url?',
  },
  {
    name: 'couchUsername',
    type: 'input',
    required: false,
    message:
      'Which user to connect to the couchdb database (not needed if your database is public) ?',
    filter: filterUndef,
  },
  {
    name: 'couchPassword',
    type: 'password',
    required: false,
    message: "What the couchdb user's password?",
    when:  (answers) => {
      return !!answers.couchUsername;
    },
  },
  {
    name: 'rocUrl',
    type: 'input',
    required: false,
    message: 'What is the public rest-on-couch url (optional)?',
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
    message:
      'Would you like to build all flavors a just a specific flavor? (just press enter to build all flavors)',
  },
  {
    name: 'selfContained',
    type: 'confirm',
    required: true,
    message:
      'Would you like the created directory to be self-contained? (all static resources will be copied)',
  },
];

let visualizerOnTabsPrompt = {
  type: 'confirm',
  name: 'addRewrite',
  required: true,
  message:
    'Would you like to add the default rewrite urls to your on-tabs configuration?',
};

function main() {
  filePath()
    .then(buildDir)
    .then(general)
    .then(updateFlavorPrompt)
    .then(addFlavors)
    .then(postProcess)
    .then(writeConfig)
    .catch((e) => {
      console.error('error', e);
    });
}

function general() {
  return inquirer.prompt(generalPrompt).then((answer) => {
    Object.assign(config, answer);
  });
}

function overwrite() {
  return inquirer.prompt(overwritePrompt).then((answer) => {
    if (!answer.overwrite) {
      return filePath();
    }
  });
}

function writeConfig() {
  fs.writeJsonSync(configPath, config);
}

function buildDir() {
  return dirPath({
    name: 'dir',
    message:
      "What is your build output directory? (the website's root directory or sub-directory)",
    cb: buildDir,
  });
}

function createDirectory(dir, cb) {
  let createDirectoryPrompt = {
    type: 'confirm',
    required: true,
    name: 'createDir',
    message: `The directory ${dir} does not exist, would you like to create it?`,
  };
  return inquirer.prompt(createDirectoryPrompt).then((answer) => {
    if (answer.createDir) {
      fs.mkdirpSync(dir);
    } else {
      return cb();
    }
  });
}

function dirPath(options) {
  options = Object.assign({}, dirPathPrompt, options);
  return inquirer.prompt(options).then((answer) => {
    let dir = path.resolve(process.cwd(), answer[options.name]);
    config[options.name] = dir;
    try {
      fs.statSync(dir);
    } catch (e) {
      return createDirectory(dir, options.cb);
    }
  });
}

function filePath() {
  return inquirer.prompt(filePathPrompt).then((answer) => {
    configPath = path.resolve(process.cwd(), answer.configPath);
    try {
      fs.statSync(configPath);
      return overwrite();
    } catch {
      // ignore
    }
    let dir = path.parse(configPath).dir;
    try {
      fs.statSync(dir);
    } catch (e) {
      return createDirectory(dir, filePath);
    }
  });
}

function updateFlavorPrompt() {
  if (config.rocUrl) {
    loginPrompt.find((el) => el.name === 'url').default = config.rocUrl;
  }
}

function addFlavor() {
  return inquirer.prompt(addFlavorPrompt).then((answer) => {
    let prom = Promise.resolve();
    if (answer.login) {
      prom = prom.then(() =>
        inquirer.prompt(loginPrompt).then((ans) => {
          answer.login = ans;
          return answer;
        }),
      );
    }
    if (answer.layout === 'visualizer-on-tabs') {
      prom = prom
        .then(() => inquirer.prompt(visualizerOnTabsPrompt))
        .then((ans) => {
          answer.visualizerOnTabs = ans;
        });
    }
    return prom.then(() => {
      if (!answer.login) delete answer.login;
      return answer;
    });
  });
}

function addFlavors() {
  return inquirer
    .prompt({
      name: 'continue',
      type: 'confirm',
      message: 'Would you like to add another flavor configuration?',
      required: true,
    })
    .then((ans) => {
      if (ans.continue) {
        return addFlavor().then((answer) => {
          config.flavors.push(answer);
          return addFlavors();
        });
      }
    });
}

function postProcess() {
  let p = {};
  Object.assign(config, p);
  for (let i = 0; i < config.flavors.length; i++) {
    let flavor = config.flavors[i];
    config.flavorLayouts[flavor.name] = flavor.layout;
    if (flavor.visualizerOnTabs) {
      let onTabsConfig = (config.visualizerOnTabs[flavor.name] = {});
      onTabsConfig.rocLogin = flavor.login;
      if (flavor.visualizerOnTabs.addRewrite) {
        onTabsConfig.rewriteRules = [
          {
            reg: '^[^/]+$',
            replace: `${config.couchurl}/cheminfo-public/$&/view.json`,
          },
          { reg: '^[^/]+/[^/]+$', replace: `${config.couchurl}/$&/view.json` },
          {
            reg: '^[^/]+/view.json.*',
            replace: `${config.couchurl}/cheminfo-public/$&`,
          },
          { reg: '^[^/]+/[^/]+/view.json.*', replace: `${config.couchurl}/$&` },
        ];
      } else {
        onTabsConfig.rewriteRules = [];
      }
    } else if (flavor.login) {
      config.rocLogin[flavor.name] = flavor.login;
    }
  }
  delete config.flavors;
  if (!config.flavor) delete config.flavor;
}

main();
