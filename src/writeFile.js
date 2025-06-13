import fs from 'node:fs';
import path from 'node:path';

import request from 'request';

let filesWriting = {};

export function writeFile(url, p, options) {
  options = options || {};
  return new Promise(function writeFilePromiseCallback(resolve, reject) {
    if (filesWriting[p]) {
      resolve(true);
      return;
    }
    filesWriting[p] = true;

    if (fs.existsSync(p)) {
      resolve();
      return;
    }
    fs.mkdirSync(path.parse(p).dir, { recursive: true });
    let read = request.get(url, options);

    read.on('response', function onReadResponse(res) {
      if (res.statusCode !== 200) {
        reject(new Error('Got an error code !== 200'));
        return;
      }

      let write = fs.createWriteStream(p);
      write.on('error', function onWriteError(e) {
        reject(e);
      });

      write.on('finish', function onWriteFinish() {
        resolve();
      });
      read.pipe(write);
    });

    read.on('error', function onReadError(e) {
      reject(e);
    });
  });
}
