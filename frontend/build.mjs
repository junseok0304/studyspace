import { build } from 'esbuild';
import { readFile, writeFile } from 'node:fs/promises';

await build({entryPoints:['frontend/markdown.js'],bundle:true,format:'esm',minify:true,
  legalComments:'eof',outfile:'src/main/resources/static/markdown.js'});
const libraries = [['marked','LICENSE'],['dompurify','LICENSE'],['highlight.js','LICENSE']];
const notices = await Promise.all(libraries.map(async ([name,file]) => `${name}\n\n${await readFile(`node_modules/${name}/${file}`,'utf8')}`));
await writeFile('src/main/resources/static/THIRD-PARTY-NOTICES.txt',notices.join('\n\n---\n\n'));
