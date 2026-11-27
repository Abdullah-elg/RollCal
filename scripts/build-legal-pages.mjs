// Writes the website's Terms, Pro Terms and Privacy pages from the same text
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

for (const [doc, slug] of Object.entries(PAGES)) {
  const d = LEGAL[doc];
  const body = d.sections
    .map((s) => `    <h2>${escape(s.heading)}</h2>\n${s.paragraphs.map((p) => `    <p>${linkify(p)}</p>`).join('\n')}`)
    .join('\n');
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escape(d.title)} · RollCal</title>
  <link rel="icon" href="/favicon.png">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Figtree:wght@400;600;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/style.css">
</head>
<body>
  <main>
    <a class="brand" href="/"><img src="/icon.png" alt="">RollCal</a>
    <h1>${escape(d.title)}</h1>
    <p class="muted">Last updated ${escape(d.updated)}</p>
    <p>${linkify(d.intro)}</p>
${body}
    <footer>
      <a href="/terms/">Terms</a><a href="/pro-terms/">Pro Terms</a><a href="/privacy/">Privacy</a><a href="mailto:support@rollcal.app">support@rollcal.app</a>
    </footer>
  </main>
</body>
</html>
`;
  mkdirSync(new URL(`../web/${slug}/`, import.meta.url), { recursive: true });
  writeFileSync(new URL(`../web/${slug}/index.html`, import.meta.url), html);
  console.log(`web/${slug}/index.html`);
}
