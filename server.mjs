#!/usr/bin/env node
/**
 * BrowSDR self-hosting server (alternative to Cloudflare Workers).
 * Requires Node.js 18+ (uses global fetch and async iterables on requests).
 *
 * Usage:
 *   node server.mjs
 *
 * Environment variables:
 *   PORT          Listening port (default: 8787)
 *   TURN_URL      TURN/STUN server hostname (e.g. turn.example.com)
 *   TURN_USER     TURN username
 *   TURN_PASS     TURN credential
 *   GEO_COUNTRY   Two-letter country code returned by /api/geo (default: XX)
 *
 * TURN server setup: https://coturn.net  or any other RFC 5766 implementation.
 *
 * HTTPS note: WebUSB requires a secure context. In production put this server
 * behind a TLS-terminating reverse proxy (nginx, Caddy, Traefik, etc.).
 *
 * Bookmark storage: bookmarks are written to bookmarks-store.json next to this
 * file. Protect or back up that file as needed.
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(__dirname, 'dist');
const BOOKMARKS_FILE = path.join(__dirname, 'bookmarks-store.json');
const PORT = parseInt(process.env.PORT || '8787', 10);

const COOP_HEADERS = {
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Embedder-Policy': 'require-corp',
};

const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js':   'application/javascript',
    '.mjs':  'application/javascript',
    '.css':  'text/css',
    '.wasm': 'application/wasm',
    '.json': 'application/json',
    '.png':  'image/png',
    '.ico':  'image/x-icon',
    '.svg':  'image/svg+xml',
    '.txt':  'text/plain',
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function respond(res, status, contentType, body, extraHeaders = {}) {
    res.writeHead(status, { 'Content-Type': contentType, ...COOP_HEADERS, ...extraHeaders });
    res.end(body);
}

const respondJson = (res, status, data) =>
    respond(res, status, 'application/json', JSON.stringify(data));

const respondText = (res, status, msg) =>
    respond(res, status, 'text/plain', msg);

async function readBody(req, maxBytes) {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
        size += chunk.length;
        if (size > maxBytes) return null;
        chunks.push(chunk);
    }
    return Buffer.concat(chunks).toString('utf-8');
}

// ── Bookmark storage ─────────────────────────────────────────────────────────

function readStore() {
    try {
        if (fs.existsSync(BOOKMARKS_FILE))
            return JSON.parse(fs.readFileSync(BOOKMARKS_FILE, 'utf-8'));
    } catch {}
    return {};
}

function writeStore(store) {
    fs.writeFileSync(BOOKMARKS_FILE, JSON.stringify(store));
}

// ── API routes ────────────────────────────────────────────────────────────────

async function handleApi(req, res, url) {
    // /api/geo — country code
    if (url.pathname === '/api/geo') {
        return respondJson(res, 200, { country: process.env.GEO_COUNTRY || 'XX' });
    }

    // /api/turn — WebRTC ICE/TURN credentials
    if (url.pathname === '/api/turn') {
        const iceServers = [];
        const { TURN_URL, TURN_USER, TURN_PASS } = process.env;
        if (TURN_URL && TURN_USER && TURN_PASS) {
            iceServers.push({
                urls: [`turn:${TURN_URL}`, `stun:${TURN_URL}`],
                username: TURN_USER,
                credential: TURN_PASS,
            });
        }
        return respondJson(res, 200, { iceServers });
    }

    // /api/bookmarks — cloud sync backed by local JSON file
    if (url.pathname === '/api/bookmarks') {
        const token = url.searchParams.get('token') ?? '';
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token)) {
            return respondText(res, 400, 'Invalid token');
        }
        const key = `bookmarks:${token}`;

        if (req.method === 'GET') {
            const store = readStore();
            if (!store[key]) return respondText(res, 404, 'Not found');
            return respond(res, 200, 'application/json', store[key]);
        }

        if (req.method === 'PUT') {
            const body = await readBody(req, 512 * 1024);
            if (body === null) return respondText(res, 413, 'Payload too large');
            try { JSON.parse(body); } catch { return respondText(res, 400, 'Invalid JSON'); }
            const store = readStore();
            store[key] = body;
            writeStore(store);
            return respondText(res, 200, 'OK');
        }

        return respondText(res, 405, 'Method not allowed');
    }

    // /hf-proxy/* — HuggingFace CORS proxy for Whisper model downloads
    if (url.pathname.startsWith('/hf-proxy/')) {
        const hfPath = url.pathname.slice('/hf-proxy/'.length) + url.search;
        const hfRes = await fetch(`https://huggingface.co/${hfPath}`, {
            headers: { 'User-Agent': 'BrowSDR-Server' },
        });
        const buf = await hfRes.arrayBuffer();
        respond(
            res, hfRes.status,
            hfRes.headers.get('Content-Type') || 'application/octet-stream',
            Buffer.from(buf),
            { 'Access-Control-Allow-Origin': '*' }
        );
        return;
    }

    respondText(res, 404, 'Not found');
}

// ── Static file server ────────────────────────────────────────────────────────

function serveStatic(req, res, pathname) {
    let filePath = path.resolve(DIST, pathname === '/' ? 'index.html' : `.${pathname}`);

    // Path traversal guard
    if (!filePath.startsWith(DIST + path.sep) && filePath !== DIST) {
        return respondText(res, 403, 'Forbidden');
    }

    // SPA fallback: serve index.html for unknown paths
    if (!fs.existsSync(filePath)) {
        filePath = path.join(DIST, 'index.html');
    }

    const ext = path.extname(filePath).toLowerCase();
    const mime = MIME_TYPES[ext] || 'application/octet-stream';
    respond(res, 200, mime, fs.readFileSync(filePath));
}

// ── Entry point ───────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    try {
        if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/hf-proxy/')) {
            await handleApi(req, res, url);
        } else {
            serveStatic(req, res, url.pathname);
        }
    } catch (err) {
        console.error('[BrowSDR]', err);
        respondText(res, 500, 'Internal server error');
    }
});

server.listen(PORT, () => {
    console.log(`BrowSDR running on http://localhost:${PORT}`);
    if (!process.env.TURN_URL) {
        console.warn('[BrowSDR] TURN_URL not set — WebRTC remote sharing will not work.');
    }
});
