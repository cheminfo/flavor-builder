'use strict';

const fs = require('fs');

const isRunning = require('is-running');

module.exports = function isLocked(filename) {
  // try to read the file
  let running;
  try {
    const pid = fs.readFileSync(filename, 'utf8');
    running = pid && isRunning(Number(pid));
    if (!running) {
      fs.writeFileSync(filename, String(process.pid));
    }
  } catch (e) {
    if (e.code === 'ENOENT') {
      fs.writeFileSync(filename, String(process.pid));
      running = false;
    } else {
      throw e;
    }
  }

  return running;
};
