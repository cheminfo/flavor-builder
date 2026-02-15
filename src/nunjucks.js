import { writeFileSync } from 'node:fs';

import nj from 'nunjucks';

export function nunjucksWriteFile(readPath, writePath, data) {
  // Compile a file and store it, rendering it later
  const result = nj.render(readPath, data);
  writeFileSync(writePath, result);
}
