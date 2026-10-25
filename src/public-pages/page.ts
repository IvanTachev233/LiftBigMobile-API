import { createHash } from 'node:crypto';

// Colours from the app's design tokens (liftbig-app/src/theme/tokens.scss):
// dark by default, the light tokens when the device prefers light.
const STYLE = `
:root {
  color-scheme: dark;
  --bg: #0c0d0f;
  --surface: #16181b;
  --surface-input: #0f1113;
  --line: #23262b;
  --line-strong: #2a2e33;
  --text: #f3f3f1;
  --text-2: #a3a8b0;
  --text-3: #8a9099;
  --accent: #ff6a3d;
  --on-accent: #120b07;
  --accent-text: #ff6a3d;
  --danger: #f2555a;
  --on-danger: #1a0606;
  --danger-text: #ff7a70;
  --danger-tint: #3b1716;
  --success-text: #6fd8a2;
  --success-tint: #173426;
}
@media (prefers-color-scheme: light) {
  :root {
    color-scheme: light;
    --bg: #f6f5f2;
    --surface: #ffffff;
    --surface-input: #f6f5f2;
    --line: #e6e4df;
    --line-strong: #dedbd5;
    --text: #141518;
    --text-2: #5c6068;
    --text-3: #6e727a;
    --accent-text: #c2410c;
    --danger: #e5484d;
    --danger-text: #c8372d;
    --danger-tint: #fde8e7;
    --success-text: #1e7a4e;
    --success-tint: #e3f3ea;
  }
}
*, *::before, *::after { box-sizing: border-box; }
[hidden] { display: none !important; }
html { -webkit-text-size-adjust: 100%; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font: 16px/1.55 system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  overflow-wrap: anywhere;
}
main { max-width: 680px; margin: 0 auto; padding: 32px 20px 48px; }
.brand { margin: 0 0 4px; color: var(--accent-text); font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; font-size: 13px; }
h1 { margin: 0 0 8px; font-size: 28px; line-height: 1.2; }
h2 { margin: 32px 0 8px; font-size: 19px; line-height: 1.3; }
p, ul { margin: 0 0 12px; }
ul { padding-left: 22px; }
li { margin-bottom: 6px; }
strong { font-weight: 600; }
a { color: var(--accent-text); }
.muted { color: var(--text-2); }
.small { font-size: 14px; color: var(--text-3); }
.placeholder { padding: 0 4px; border-radius: 4px; background: var(--danger-tint); color: var(--danger-text); font-weight: 600; }
.card { margin: 16px 0; padding: 20px; border: 1px solid var(--line); border-radius: 18px; background: var(--surface); }
label { display: block; margin: 0 0 6px; font-size: 14px; font-weight: 600; color: var(--text-2); }
input {
  display: block; width: 100%; min-height: 48px; margin: 0 0 16px; padding: 12px 14px;
  border: 1px solid var(--line-strong); border-radius: 14px;
  background: var(--surface-input); color: var(--text); font: inherit;
}
input:focus { outline: 2px solid var(--accent); outline-offset: 1px; }
button {
  display: block; width: 100%; min-height: 48px; margin: 8px 0 0; padding: 12px 16px;
  border: 0; border-radius: 999px; font: inherit; font-weight: 600; cursor: pointer;
}
button:disabled { opacity: 0.6; cursor: default; }
.primary { background: var(--accent); color: var(--on-accent); }
.danger { background: var(--danger); color: var(--on-danger); }
.secondary { background: transparent; color: var(--text); border: 1px solid var(--line-strong); }
.alert { margin: 0 0 16px; padding: 12px 14px; border-radius: 14px; background: var(--danger-tint); color: var(--danger-text); }
.success { padding: 12px 14px; border-radius: 14px; background: var(--success-tint); color: var(--success-text); font-weight: 600; }
code { padding: 1px 4px; border-radius: 4px; background: var(--surface); font: 0.9em ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
table { width: 100%; margin: 0 0 16px; border-collapse: collapse; font-size: 15px; }
th, td { padding: 8px 8px 8px 0; border-bottom: 1px solid var(--line); text-align: left; vertical-align: top; }
th { color: var(--text-2); font-weight: 600; }
`;

function hashSource(source: string): string {
  return `'sha256-${createHash('sha256').update(source).digest('base64')}'`;
}

/** Escapes text for HTML element content and quoted attribute values */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Shown, highlighted, until the operator is configured
function configured(value: string | undefined, placeholder: string) {
  const text = value?.trim();
  return text
    ? { text, html: escapeHtml(text) }
    : { text: null, html: `<span class="placeholder">${placeholder}</span>` };
}

/**
 * The operator's name and a contact link as HTML, from PRIVACY_OPERATOR_NAME
 * and PRIVACY_CONTACT_EMAIL.
 */
export function operatorHtml(env: NodeJS.ProcessEnv): {
  name: string;
  contact: string;
} {
  const operator = configured(env.PRIVACY_OPERATOR_NAME, '[OPERATOR NAME]');
  const contact = configured(env.PRIVACY_CONTACT_EMAIL, '[CONTACT EMAIL]');
  return {
    name: operator.html,
    contact: contact.text
      ? `<a href="mailto:${contact.html}">${contact.html}</a>`
      : contact.html,
  };
}

/** "Version 2026-10-21 · Last updated 21 October 2026" for a dated version */
export function versionLine(version: string): string {
  const date = new Date(`${version}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
  return `Version ${escapeHtml(version)} · Last updated ${date}`;
}

/**
 * Content-Security-Policy allowing only the page style and the given inline
 * scripts (by hash), requests to the same origin and forms posting to it.
 */
export function contentSecurityPolicy(scripts: string[] = []): string {
  return [
    "default-src 'none'",
    `style-src ${hashSource(STYLE)}`,
    `script-src ${scripts.length ? scripts.map(hashSource).join(' ') : "'none'"}`,
    "connect-src 'self'",
    "form-action 'self'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
}

/** A complete page; `body` is trusted HTML, `script` an inline script */
export function renderPage(page: {
  title: string;
  body: string;
  script?: string;
}): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>${escapeHtml(page.title)}</title>
<style>${STYLE}</style>
</head>
<body>
<main>
<p class="brand">LiftBig</p>
${page.body}
</main>
${page.script === undefined ? '' : `<script>${page.script}</script>\n`}</body>
</html>
`;
}
