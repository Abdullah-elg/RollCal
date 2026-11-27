// Writes the website's Terms, Plan Terms and Privacy pages from the same text
// the app shows (src/legal/documents.ts), so the two never drift apart.
// Run after editing the documents: npm run build:legal
import { mkdirSync, writeFileSync } from 'node:fs';
import { LEGAL } from '../src/legal/documents.ts';

const PAGES = { terms: 'terms', pro: 'pro-terms', privacy: 'privacy' };

const escape = (text) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// Email addresses in the text become links.
const linkify = (text) =>
  // The address ends at a letter, so a sentence's full stop stays outside the link.
  escape(text).replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)*\.[a-z]{2,}/gi, (email) => `<a href="mailto:${email}">${email}</a>`);

// Section headings become anchors (#who-can-use-rollcal) for the contents list.
const slugify = (text) =>
  text.toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// The same footer as every other page on the site.
export const FOOTER = `    <footer>
      <a href="/terms/">Terms</a><a href="/pro-terms/">Plan Terms</a><a href="/privacy/">Privacy</a><a href="/child-safety/">Child Safety</a><a href="/delete-account/">Delete account</a><a href="mailto:support@rollcal.app">support@rollcal.app</a>
    </footer>`;

for (const [doc, slug] of Object.entries(PAGES)) {
  const d = LEGAL[doc];
  const contents = d.sections
    .map((s) => `        <li><a href="#${slugify(s.heading)}">${escape(s.heading)}</a></li>`)
    .join('\n');
  const body = d.sections
    .map((s) => `      <h2 id="${slugify(s.heading)}">${escape(s.heading)}</h2>\n${s.paragraphs.map((p) => `      <p>${linkify(p)}</p>`).join('\n')}`)
    .join('\n');
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escape(d.title)} · RollCal</title>
  <meta name="theme-color" content="#f6f4ee" media="(prefers-color-scheme: light)">
  <meta name="theme-color" content="#111513" media="(prefers-color-scheme: dark)">
  <link rel="icon" href="/favicon.png?v=2">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Figtree:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/style.css?v=2">
  <link rel="stylesheet" href="/home.css?v=3">
  <link rel="stylesheet" href="/legal.css?v=2">
</head>
<body class="home">
  <header class="nav">
    <a class="brand" href="/"><img src="/icon.png?v=2" alt="">RollCal</a>
    <a class="nav-link" href="mailto:support@rollcal.app">Contact</a>
  </header>
  <main class="legal">
    <p class="kicker">Legal</p>
    <h1>${escape(d.title)}</h1>
    <p class="updated">Last updated ${escape(d.updated)}</p>
    <p class="intro">${linkify(d.intro)}</p>
    <nav class="contents" aria-label="Contents">
      <p>Contents</p>
      <ol>
${contents}
      </ol>
    </nav>
    <article>
${body}
    </article>
${FOOTER}
  </main>
</body>
</html>
`;
  mkdirSync(new URL(`../web/${slug}/`, import.meta.url), { recursive: true });
  writeFileSync(new URL(`../web/${slug}/index.html`, import.meta.url), html);
  console.log(`web/${slug}/index.html`);
}
