import debug from 'debug';

const info = debug('flavor-builder:info');
const trace = debug('flavor-builder:trace');

export default {
  info,
  trace,
  logProcess,
};

function logProcess(message, el, flavorName) {
  info(`${message} - flavor: ${flavorName}, id: ${el.__id}`);
}
