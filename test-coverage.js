import fs from 'node:fs/promises';

import { build, buildConfig } from './src/index.js';
import log from './src/log.js';

const config = await buildConfig('./configs/cheminfo.json');
log.info('Cleaning up previous build artifacts...');
await fs.rm('./build', { recursive: true, force: true });
log.info('Building from cheminfo.json configuration...');
await build(config);
log.info('Rebuilding (uses cached data)...');
await build(config);
