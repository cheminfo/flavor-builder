import fs from 'node:fs/promises';

import { build, buildConfig } from './src/index.js';
import log from './src/log.js';

const configFile = './configs/cheminfo.json';
const config = await buildConfig(configFile);
log.info('Cleaning up previous build artifacts...');
await fs.rm('./build', { recursive: true, force: true });
log.info('Building from cheminfo.json configuration...');
await build(configFile);
log.info('Rebuilding (uses cached data)...');
await build(config);
