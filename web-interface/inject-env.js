/**
 * AttendX — inject-env.js
 * Vercel build script. Injects environment variables into index.html
 * at build time so the static SPA can read runtime configuration.
 *
 * Vercel environment variables used:
 *   ATTENDX_API_URL  — Backend URL (e.g. https://attendx-api.onrender.com)
 */

const fs = require("fs");
const path = require("path");

const htmlPath = path.join(__dirname, "index.html");
let html = fs.readFileSync(htmlPath, "utf8");

const apiUrl = process.env.ATTENDX_API_URL || "";

// Inject API URL before the closing </head>
const injectScript = `<script>window.ATTENDX_API_URL = ${JSON.stringify(apiUrl)};</script>`;
html = html.replace("</head>", `${injectScript}\n</head>`);

fs.writeFileSync(htmlPath, html, "utf8");
console.log(`[inject-env] ATTENDX_API_URL = ${apiUrl || "(not set — API calls will fail)"}`);
