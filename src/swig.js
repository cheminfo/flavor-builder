import { writeFileSync } from 'node:fs';

import swig from 'swig';

swig.setFilter('concat', concat);

export function swigWriteFile(readpath, writepath, data) {
  // Compile a file and store it, rendering it later
  let tpl = swig.compileFile(readpath);
  let htmlcontent = tpl(data);
  writeFileSync(writepath, htmlcontent);
}

function concat(a, b) {
  if (b === undefined) return a;
  return a + b;
}
