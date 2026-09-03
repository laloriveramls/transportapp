#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function extractFirstStyle(file) {
    const content = fs.readFileSync(file, 'utf8');
    const m = content.match(/<style>([\s\S]*?)<\/style>/);
    if (!m) throw new Error(`No <style> in ${file}`);
    return m[1].trim();
}

function stripComments(css) {
    return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

function scopeCss(css, scope) {
    css = stripComments(css);
    const blocks = [];
    let i = 0;
    while (i < css.length) {
        const rest = css.slice(i).trimStart();
        i = css.length - rest.length;

        if (rest.startsWith('@keyframes') || rest.startsWith('@-webkit-keyframes')) {
            const end = findMatchingBrace(rest, 0);
            blocks.push({ type: 'raw', text: rest.slice(0, end + 1) });
            i += rest.slice(0, end + 1).length;
            continue;
        }

        if (rest.startsWith('@media')) {
            const open = rest.indexOf('{');
            const query = rest.slice(0, open).trim();
            const innerStart = open + 1;
            let depth = 1;
            let j = innerStart;
            while (j < rest.length && depth) {
                if (rest[j] === '{') depth++;
                if (rest[j] === '}') depth--;
                j++;
            }
            const inner = rest.slice(innerStart, j - 1);
            blocks.push({ type: 'media', query, inner: scopeCss(inner, scope) });
            i += j;
            continue;
        }

        const open = rest.indexOf('{');
        if (open === -1) break;
        const selectors = rest.slice(0, open).trim();
        const end = findMatchingBrace(rest, open);
        const body = rest.slice(open, end + 1);
        blocks.push({ type: 'rule', selectors, body });
        i += end + 1;
    }

    return blocks.map(b => {
        if (b.type === 'raw') return b.text;
        if (b.type === 'media') return `${b.query} {\n${b.inner}\n}`;
        return `${prefixSelectors(b.selectors, scope)} ${b.body}`;
    }).join('\n\n');
}

function findMatchingBrace(str, startIdx) {
    let depth = 0;
    for (let i = startIdx; i < str.length; i++) {
        if (str[i] === '{') depth++;
        if (str[i] === '}') {
            depth--;
            if (depth === 0) return i;
        }
    }
    return str.length - 1;
}

function prefixSelectors(selectors, scope) {
    return selectors.split(',').map(s => {
        s = s.trim();
        if (!s) return s;
        if (s.startsWith('@')) return s;
        if (s === 'body.drawer-open') return `body${scope}.drawer-open`;
        if (s === 'body') return `body${scope}`;
        if (s.startsWith('body.')) return s;
        if (s === 'html, body' || s === 'html,body') return `html, body${scope}`;
        if (s.startsWith(scope + ' ') || s.startsWith(scope + '.') || s === scope) return s;
        if (s === 'main.container') return `${scope} main.container`;
        return `${scope} ${s}`;
    }).join(', ');
}

const SHARED = `/* public/css/pages.css — Flujos públicos compartidos */

/* ===== Shared utilities ===== */
.mono {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
    font-variant-numeric: tabular-nums;
}

.pill {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.42rem 0.68rem;
    border-radius: 999px;
    border: 1px solid var(--border);
    background: var(--chip-bg);
    color: var(--chip-text);
    font-weight: 600;
    font-size: 0.9rem;
    white-space: nowrap;
}

.pill--ok {
    background: color-mix(in srgb, var(--wine) 10%, transparent);
    border-color: color-mix(in srgb, var(--wine) 25%, var(--border));
}

.pill--warn {
    background: color-mix(in srgb, #f59e0b 14%, transparent);
    border-color: color-mix(in srgb, #f59e0b 28%, var(--border));
    color: color-mix(in srgb, #b45309 70%, var(--text));
}

.pill--bad {
    background: color-mix(in srgb, #ef4444 12%, transparent);
    border-color: color-mix(in srgb, #ef4444 28%, var(--border));
    color: color-mix(in srgb, #991b1b 70%, var(--text));
}

.btn-xs {
    padding: 0.55rem 0.85rem;
    border-radius: 14px;
    font-weight: 650;
    font-size: 0.95rem;
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    line-height: 1.1;
    white-space: nowrap;
    transition: transform 0.12s ease, box-shadow 0.15s ease, background 0.15s ease, border-color 0.15s ease;
}

.btn-xs:active { transform: scale(0.98); }

.btn-ghost {
    border: 1px solid var(--border);
    background: transparent;
    color: var(--text);
}

.btn-ghost:hover {
    border-color: color-mix(in srgb, var(--wine) 40%, var(--border));
    background: color-mix(in srgb, var(--card) 70%, transparent);
    color: var(--text);
}

.btn-wine {
    border: 1px solid color-mix(in srgb, var(--wine) 55%, var(--border));
    background: var(--wine);
    color: #fff;
}

.btn-wine:hover {
    background: var(--wine-2);
    border-color: var(--wine-2);
    color: #fff;
}

.btn-wa {
    background: #25D366;
    border-color: #25D366;
    color: #fff;
    box-shadow: 0 8px 20px rgba(37, 211, 102, 0.22);
}

.btn-wa:hover {
    background: #1fb85a;
    border-color: #1fb85a;
    color: #fff;
    box-shadow: 0 12px 26px rgba(37, 211, 102, 0.3);
    transform: translateY(-1px);
}

.btn-wa:active {
    transform: translateY(0);
    box-shadow: 0 8px 18px rgba(37, 211, 102, 0.22);
}

.btn-wa:focus-visible {
    outline: 3px solid rgba(37, 211, 102, 0.35);
    outline-offset: 2px;
}

.btn-pdf {
    border: 1px solid color-mix(in srgb, var(--wine) 40%, var(--border));
    background: color-mix(in srgb, var(--wine) 12%, transparent);
    color: var(--text);
}

.btn-pdf:hover {
    border-color: var(--wine);
    background: color-mix(in srgb, var(--wine) 18%, transparent);
}

.btn-solid {
    border: 1px solid color-mix(in srgb, var(--border) 90%, transparent);
    background: color-mix(in srgb, var(--card) 88%, transparent);
    color: var(--text);
}

.btn-solid:hover {
    border-color: color-mix(in srgb, var(--wine) 40%, var(--border));
    background: color-mix(in srgb, var(--card) 72%, transparent);
    color: var(--text);
}

.btn-primary {
    border: 1px solid color-mix(in srgb, var(--wine) 55%, var(--border));
    background: var(--wine);
    color: #fff;
}

.btn-primary:hover {
    background: var(--wine-2);
    color: #fff;
}

.btn-primary:disabled {
    opacity: 0.55;
    cursor: not-allowed;
}

.note {
    border: 1px solid var(--border);
    background: color-mix(in srgb, var(--card) 82%, transparent);
    border-radius: 16px;
    padding: 12px 14px;
    color: var(--muted);
    font-weight: 500;
    line-height: 1.45;
}

.note strong { color: var(--text); }

.note.danger,
.danger {
    border-color: rgba(239, 68, 68, 0.35);
    background: rgba(239, 68, 68, 0.06);
    color: color-mix(in srgb, #ef4444 55%, var(--text));
}

.page-wrap { max-width: 1120px; }

.page-pay main.container,
.page-checkout main.container,
.page-ticket main.container {
    padding-top: 0.85rem !important;
    padding-bottom: 1rem !important;
}

.page-pay .btn-group-top,
.page-checkout .actions,
.page-ticket .actions {
    max-width: 100%;
}

.copy-toast {
    display: none;
    font-size: 0.9rem;
    color: color-mix(in srgb, var(--wine) 78%, var(--text));
    font-weight: 600;
}

@keyframes spin { to { transform: rotate(360deg); } }

`;

const sections = [
    { file: 'views/pay.ejs', scope: '.page-pay', label: 'Pay' },
    { file: 'views/checkout.ejs', scope: '.page-checkout', label: 'Checkout' },
    { file: 'views/ticket.ejs', scope: '.page-ticket', label: 'Ticket (screen)', skipPrint: true },
    { file: 'views/maintenance.ejs', scope: '.page-maintenance', label: 'Maintenance' },
];

let out = SHARED;

for (const sec of sections) {
    let css = extractFirstStyle(path.join(ROOT, sec.file));
    if (sec.skipPrint) {
        const printIdx = css.indexOf('@media print');
        if (printIdx !== -1) css = css.slice(0, printIdx).trim();
    }
    out += `\n/* ===== ${sec.label} ===== */\n`;
    out += scopeCss(css, sec.scope);
    out += '\n';
}

fs.writeFileSync(path.join(ROOT, 'public/css/pages.css'), out);
console.log('Wrote public/css/pages.css', out.length, 'bytes');
