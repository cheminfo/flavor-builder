import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import isRunning from 'is-running';

export function isLocked(filename) {
  // try to read the file
  let running;
  try {
    const pid = fs.readFileSync(filename, 'utf8');
    running = pid && isRunning(Number(pid));
    if (!running) {
      fs.writeFileSync(filename, String(process.pid));
    }
  } catch (error) {
    if (error.code === 'ENOENT') {
      const dir = path.dirname(filename);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(filename, String(process.pid));
      running = false;
    } else {
      throw error;
    }
  }

  return running;
}
