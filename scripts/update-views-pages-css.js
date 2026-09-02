#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

const NAVBAR = `<%- include('partials/navbar') %>`;

const updates = [
    {
        file: 'views/pay.ejs',
        bodyClass: 'page-pay',
        keepPrint: false,
        printOnly: false,
    },
    {
        file: 'views/checkout.ejs',
        bodyClass: 'page-checkout',
    },
    {
        file: 'views/ticket.ejs',
        bodyClass: 'page-ticket',
        printOnly: true,
    },
    {
        file: 'views/maintenance.ejs',
        bodyClass: 'page-maintenance',
    },
    {
        file: 'views/reserve.ejs',
        bodyClass: 'page-reserve',
    },
];

function extractPrintBlock(css) {
    const idx = css.indexOf('@media print');
    return idx === -1 ? '' : css.slice(idx).trim();
}

function removeStyleBlock(content) {
    return content.replace(/\n?\s*<style>[\s\S]*?<\/style>\n?/, '\n');
}

function replaceNavbar(content) {
    return content.replace(
        /<nav class="navbar navbar-dark app-navbar">[\s\S]*?<\/nav>\n/,
        NAVBAR + '\n'
    );
}

for (const u of updates) {
    const filePath = path.join(ROOT, u.file);
    let content = fs.readFileSync(filePath, 'utf8');

    if (u.printOnly) {
        const styleMatch = content.match(/<style>([\s\S]*?)<\/style>/);
        const printCss = styleMatch ? extractPrintBlock(styleMatch[1]) : '';
        content = removeStyleBlock(content);
        if (printCss) {
            const insertAfter = content.indexOf('}) %>');
            const headClose = content.indexOf('</head>');
            const styleBlock = `\n    <style>\n        ${printCss.split('\n').join('\n        ')}\n    </style>\n`;
            content = content.slice(0, headClose) + styleBlock + content.slice(headClose);
        }
    } else {
        content = removeStyleBlock(content);
    }

    content = content.replace(/<body>/, `<body class="${u.bodyClass}">`);
    content = replaceNavbar(content);

    fs.writeFileSync(filePath, content);
    console.log('Updated', u.file);
}

// head.ejs
const headPath = path.join(ROOT, 'views/partials/head.ejs');
let head = fs.readFileSync(headPath, 'utf8');
if (!head.includes('/css/pages.css')) {
    head = head.replace(
        '<link href="/css/theme.css" rel="stylesheet">',
        '<link href="/css/theme.css" rel="stylesheet">\n<link href="/css/pages.css" rel="stylesheet">'
    );
    fs.writeFileSync(headPath, head);
    console.log('Updated views/partials/head.ejs');
}
