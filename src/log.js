'use strict';

const logInfo = require('debug')('flavor-builder:info');
const logTrace = require('debug')('flavor-builder:trace');

module.exports = {
  info: logInfo,
  trace: logTrace,
}