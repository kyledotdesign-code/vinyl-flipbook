# Vinyl Collection — Baked Art (v36)

This build uses a **pre-baked** cover-art index so the app never depends on live APIs.

## One‑time setup
1) Install Node 18+
2) `npm i`

## Bake the art index
Option A — Use your Google Sheet (recommended):
```bash
export SHEET_CSV_URL="https://docs.google.com/spreadsheets/d/e/2PACX-1vTJ7Jiw68O2JXlYMFddNYg7z622NoOjJ0Iz6A0yWT6afvrftLnc-OrN7loKD2W7t7PDbqrJpzLjtKDu/pub?gid=0&single=true&output=csv"
npm run bake
```

Option B — Also download images into the repo (faster & fully offline after deploy):
```bash
export SHEET_CSV_URL="<<your CSV url>>"
npm run bake:download
```
Outputs:
- `public/art-index.json` (always)
- `public/covers/*` (only with `--download`)

## Develop locally
```bash
npm run dev
# open http://localhost:5173
```

## Deploy
Push/drag to Vercel. The site reads `public/art-index.json` at runtime.
If you want Vercel to bake on every deploy, add a Project Environment Variable:
- Key: `SHEET_CSV_URL`
- Value: your Google Sheet CSV URL
…then add a Build Command in Vercel: `npm ci && npm run bake && true`
(Static app still deploys even if baking fails.)

### Sheet columns expected
- **Title** (or `Album`)
- **Artist**
- **Cover** _(optional — direct image link; Drive/Dropbox share links are auto-converted)_
- **Genre/Year** _(optional)_

Your sheet-provided cover always wins over API results.
