# Postbox

**Postbox** (`postbox.scheuber.dev`) is an open-source, 100% client-side, zero-upload mail archive viewer built with React, TypeScript, and Vite. Inspect, search, and export emails and attachments from `.pst`, `.ost`, `.msg`, `.eml`, and `.mbox` files directly inside browser RAM without ever sending data to a server.

## Features

- **Strict Zero-Upload Architecture:** All parsing, indexing, HTML sanitization, and ZIP/EML generation run locally inside a browser Web Worker. Nothing leaves your machine.
- **Broad Format Support:**
  - `.pst` & `.ost` (Outlook Personal & Offline Data Files) via `@hiraokahypertools/pst-extractor` with a custom `File.slice()` random-access reader and 256 KB LRU block cache (32 MB cap).
  - `.msg` (Outlook Message items) via `@kenjiuno/msgreader` with full MAPI raw property extraction.
  - `.eml` & `.mbox` (RFC 5322 & Unix mailbox archives) via `postal-mime` with streaming 4 MB `.mbox` boundary scanning and lazy body loading.
- **XSS & Privacy Protection:**
  - Sanitizes HTML email bodies with `DOMPurify` and renders inside `<iframe sandbox="allow-same-origin">`.
  - Resolves inline `cid:` attachments locally via `Blob` URLs while blocking external `http://` / `https://` images and tracking pixels by default (with a user-togglable banner).
- **Three-Pane Mail Client:**
  - **Folder Tree:** Collapsible folder hierarchy with unread/total counts, folder search filter, and a virtual `Imported Messages` bucket for standalone `.msg`/`.eml` drops.
  - **Virtualized Message List:** Smoothly handles 50,000+ messages with instant full-text search, date-range filtering, attachment filter, keyboard navigation (`Up`/`Down`, `Esc`), and folder `.zip` export.
  - **Reading Pane:** Full header inspection + expandable raw internet headers, one-click attachment downloads & **Download All as ZIP**, **HTML / Plain Text / Raw Source & MAPI Properties** tabs, **Print / Save as PDF**, and **Export as .eml**.
- **Self-Contained & Air-Gapped Bundle:** All fonts (`@fontsource-variable/inter`, `@fontsource-variable/jetbrains-mono`) and icons (`lucide-react`) are bundled locally—zero external CDNs or analytics.

## Zero-Upload Security & CSP Architecture

Postbox enforces an air-gapped Content Security Policy both in `index.html` and as an HTTP response header in `nginx.conf`:

```text
default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'none'; font-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none';
```

Because `connect-src 'none'` is active, the browser engine physically blocks `fetch`, `XMLHttpRequest`, `WebSocket`, and `sendBeacon` requests—verifiable at any time via DevTools Network & Security panels or the **100% Local Processing — Zero Network Connections** badge in the top bar.

Clicking **Clear Session / Unload File** (or closing the tab) immediately terminates the Web Worker, clears all caches, and revokes every generated `Blob` URL.

## Local Development

```bash
npm install
npm run dev
```

Run tests and production build verification:

```bash
npm test
npm run build
```

## Self-Hosting with Docker

Run Postbox locally or on your own server with Docker Compose:

```bash
docker compose up -d --build
```

Then open [http://localhost:8080](http://localhost:8080).

Or build and run the container directly:

```bash
docker build -t postbox .
docker run -d --name postbox -p 8080:80 postbox
```

## License

[MIT](LICENSE)
