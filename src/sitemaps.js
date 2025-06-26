import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import log from './log.js';

export function readSiteMaps(config) {
  log.trace('write site maps');
  try {
    let r = {};
    let content = readFileSync(path.join(config.dir, 'sitemap.txt'), 'utf8');
    for (let el of content.split('\n')) {
      el = el.replace(config.rootUrl, '');
      el = el.replace(/^\//, '');
      r[el] = true;
    }
    return r;
  } catch {
    return {};
  }
}

export function writeSiteMaps(config, sitemaps) {
  if (!config.rootUrl) {
    log.info('No root url specified, not creating sitemap.txt');
    return;
  }
  log.trace('write site maps');
  writeFileSync(
    path.join(config.dir, 'sitemap.txt'),
    Object.keys(sitemaps)
      .map((el) => `${config.rootUrl}/${el}`)
      .join('\n'),
  );
}
