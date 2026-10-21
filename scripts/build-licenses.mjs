// Collects the licence of every package that ships inside the app (npm's
// production tree) into src/legal/licenses.json, for the Open-source licences
// screen. Run after changing dependencies: npm run build:licenses
//
// Each licence text is stored once and packages point at it, which keeps
// the file small even though most packages share the same few licences.
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const tree = JSON.parse(
  execSync('npm ls --omit=dev --all --json', { cwd: root, encoding: 'utf8', maxBuffer: 64 << 20 })
);

// Packages whose package.json leaves the licence out.
const KNOWN = { '@opentelemetry/api': 'Apache-2.0', 'react-native-web': 'MIT' };

const packages = new Map();
const texts = new Map();

function licenceText(dir) {
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir).filter((f) => /^(licen[cs]e|copying|notice)(\.|$|-|_)/i.test(f));
  const parts = files
    .sort((a, b) => (/notice/i.test(a) ? 1 : 0) - (/notice/i.test(b) ? 1 : 0))
    .map((f) => readFileSync(join(dir, f), 'utf8').trim())
    .filter(Boolean);
  return parts.length ? parts.join('\n\n') : null;
}

function walk(node) {
  for (const [name, info] of Object.entries(node.dependencies ?? {})) {
    const key = `${name}@${info.version}`;
    if (packages.has(key)) continue;
    const dir = join(root, 'node_modules', name);
    let licence = KNOWN[name] ?? 'See licence text';
    let repo = null;
    try {
      const pj = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
      const l = pj.license ?? pj.licenses;
      if (typeof l === 'string') licence = l;
      else if (Array.isArray(l)) licence = l.map((x) => x.type ?? x).join(' OR ');
      else if (l?.type) licence = l.type;
      const r = typeof pj.repository === 'string' ? pj.repository : pj.repository?.url;
      repo = r ? r.replace(/^git\+/, '').replace(/\.git$/, '').replace(/^git:/, 'https:') : pj.homepage ?? null;
    } catch {
      // Not installed locally (an optional peer); the name is still listed.
    }
    const text = licenceText(dir);
    let textId = null;
    if (text) {
      textId = createHash('sha1').update(text).digest('hex').slice(0, 10);
      texts.set(textId, text);
    }
    packages.set(key, { name, version: info.version ?? '', licence, repo, textId });
    walk(info);
  }
}
walk(tree);

const list = [...packages.values()].sort((a, b) => a.name.localeCompare(b.name));
writeFileSync(
  join(root, 'src/legal/licenses.json'),
  JSON.stringify({ packages: list, texts: Object.fromEntries(texts) })
);
console.log(`${list.length} packages, ${texts.size} distinct licence texts`);
