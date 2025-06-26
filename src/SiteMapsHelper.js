import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import log from './log.js';

export class SiteMapHelper {
  constructor(config) {
    this.config = config;
  }

  read() {
    log.trace('read site maps');
    const sitemaps = new Set();
    let content = '';
    try {
      content = readFileSync(path.join(this.config.dir, 'sitemap.txt'), 'utf8');
    } catch {
      return new Set();
    }

    for (let el of content.split('\n')) {
      const relativePath = el
        .replace(this.config.rootUrl, '')
        .replace(/^\//, '');
      sitemaps.add(relativePath);
    }
    return sitemaps;
  }
  write(sitemaps) {
    if (!this.config.rootUrl) {
      log.info('No root url specified, not creating sitemap.txt');
      return;
    }
    log.trace('write site maps');
    writeFileSync(
      path.join(this.config.dir, 'sitemap.txt'),
      Array.from(sitemaps)
        .map((el) => `${this.config.rootUrl}/${el}`)
        .join('\n'),
    );
  }
}
