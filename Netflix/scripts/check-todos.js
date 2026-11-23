// Run before deploying: lists every placeholder still on the site.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const hits = [];
function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (p.endsWith('.html')) {
      readFileSync(p, 'utf8').split('\n').forEach((line, i) => {
        if (/TODO|YOUR-USERNAME/.test(line)) hits.push(`${p}:${i + 1}: ${line.trim().slice(0, 110)}`);
      });
    }
  }
}
walk('.');
try { statSync('resume.pdf'); } catch { hits.push('resume.pdf is missing: export your résumé and save it at the site root'); }
if (hits.length) {
  console.log(`${hits.length} placeholder(s) left:\n` + hits.join('\n'));
  process.exit(1);
}
console.log('No placeholders left. Ready to deploy.');
