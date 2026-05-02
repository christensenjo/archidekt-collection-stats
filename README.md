# Archidekt collection stats

A better solution for viewing and filtering collection statistics after exporting them from Archidekt.

Upload your collection CSV (the same export Archidekt provides), then explore totals, charts (rarity, color identity, mana curve, type, top sets and cards), and search. There is no bundled sample data: your file stays in the browser for that session.

Tag-based labels from the `Tags` column can be included or excluded—including a default that omits `Proxy` so “real” cardboard value is easy to compare to the full export.

## Prerequisites

- Node.js (the project pins a `packageManager`; use `npm` as in the steps below)

This repo uses [Vite+](https://viteplus.dev/guide/) (`vp`). See [`AGENTS.md`](./AGENTS.md) for toolchain notes.

## Run locally

```bash
npm install
npm run dev
```

Then open the URL printed in the terminal (usually `http://127.0.0.1:5173/`).

## Build

```bash
npm run build
```

Output goes to `dist/`. Preview the production build with `npm run preview`.

## Lint

```bash
npm run lint
```
