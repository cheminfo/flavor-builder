import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import isRunning from 'is-running';

export function acquireLock(filename) {
  // try to read the file
  let running;
  const dir = path.dirname(filename);
  fs.mkdirSync(dir, { recursive: true });
  try {
    const fd = fs.openSync(filename, 'wx'); // Fails if already exists
    fs.writeSync(fd, process.pid.toString());
    fs.closeSync(fd);
    return false;
  } catch (error) {
    if (error.code === 'EEXIST') {
      const pid = fs.readFileSync(filename, 'utf8');
      running = pid && isRunning(Number(pid));
      if (!running) {
        fs.writeFileSync(filename, String(process.pid));
        running = false;
      }
    } else {
      console.error(error);
      throw error;
    }
  }

  return running;
}

export function releaseLock(filename) {
  fs.unlinkSync(filename);
}
