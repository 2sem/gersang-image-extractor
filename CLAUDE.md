# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Single-page, no-build browser tool: `index.html` (Korean UI, "거상 이미지 Viewer" = "Gersang Image Viewer"). Parses `.S32` sprite files (from the game 거상/Gersang) client-side, decompresses their custom RLE pixel format, renders each frame to a `<canvas>`, and lets user export selected/all frames as PNG.

No build step, no package manager, no server. Deployed as-is via GitHub Pages (root `index.html` is the entry point — see commit `fit: enables github pages` which renamed `gersang-image-viewer.html` → `index.html`).

## Running / testing

Open `index.html` directly in a browser (or serve the folder statically). Test by loading a `.S32` file from `sample/` via the file input. Debug via browser DevTools console — the parser logs verbose `[Log] ...` traces for every image and pixel command (file type, width/height, image count, per-image start offsets/compressed pixel counts, per-pixel decode).

There are no automated tests, linter, or build/lint/test commands — this is a plain static HTML/JS file.

## S32 file format (see `prompt` for original spec notes)

32-bit-with-alpha sprite format from 거상(Gersang)'s client. Independently reverse-engineered here and cross-checked against the third-party reference decoder [hallazzang/gosang](https://github.com/hallazzang/gosang) (`sprite32alpha.go`), which confirms the layout below. All integers little-endian.

- Header (16 bytes): `u32 signature` (`0x19`/25 for this alpha variant — sibling formats `0x0F` 32-bit-no-alpha and `0x09` 8-bit-palette exist but aren't supported), `u32 width`, `u32 height`, `u32 frameCount`.
- At offset `0x4c0` (1216): `u32[frameCount]` frame data offset, relative to the frame-data base at `0xe4c`.
- At offset `0x970` (2416): `u32[frameCount]` pixel-op record count per frame.
- Both tables reserve a fixed 1200-byte block (300 frame slots) regardless of actual `frameCount` — that's why table offsets are constants, not derived from `frameCount`.
- At offset `0xe24`/`0xe28` (3620/3624): a separate sprite-level width/height field, distinct from the per-frame width/height in the main header and unused by the decoder (confirmed unused in the reference implementation too).
- Frame pixel-op streams begin at offset `0xe4c` (3660). Each record is 4 bytes: `[alpha, red, green, blue]`.
  - `alpha == 0 && green == 0 && blue == 0`: skip run — `red` = number of fully-transparent pixels to advance over.
  - otherwise: paints exactly one pixel using the record's own alpha (no repeat/run-length semantics for opaque pixels; only skip-runs are RLE'd).

An earlier "압축" (compressed) mode treated the type byte as a repeat count instead of an alpha value. It was removed — real S32 data has non-`0x00`/`0xFF` type bytes (variable alpha), so that interpretation desyncs `pixelIndex` and corrupts the image (confirmed against `sample/Helmet01_I.S32`). `parseS32File` now also validates `signature === 25` and rejects other sprite variants with a clear error instead of silently misdecoding them.

`sample/` contains real `.S32` fixtures (`armor02_I.S32`, `CoinIcon.S32`, `creature_i.S32`, `Element01_I.S32`, `Helmet01_I.S32`, `Ring01_I.S32`, `Weapon02_F.S32`) for manual testing.

`s32-hex` is a raw hex dump excerpt of an `.S32` file's compressed-pixel region (offset `0x4C0`-`0x64F`), useful as a reference for manually verifying decoder output byte-by-byte.

## Code structure (all in `index.html`)

Everything lives in one `<script>` block, in read order:

1. `handleFileSelect` — file input → `FileReader` → `parseS32File`.
2. `parseS32File` — reads/validates the header, calls `readFrameTable` for the offset/record-count arrays, then loops frames calling `decompressPixels` → `createImageData` → `addImageToContainer`.
3. `readFrameTable` — reads the two parallel per-frame tables at the `S32_FRAME_OFFSETS_OFFSET`/`S32_FRAME_RECORD_COUNTS_OFFSET` constants.
4. `decompressPixels` — the core RLE decoder per the format spec above.
5. `createImageData` — writes decoded RGBA pixels into an offscreen `<canvas>`, returns a data URL.
6. `addImageToContainer` — renders one numbered, checkbox-selectable thumbnail into `#imageContainer`; also wires a click handler so tapping anywhere on the card (image or padding) toggles its checkbox without double-firing when the checkbox/label itself is clicked.
7. `exportSelectedImages` / `exportAllImages` / `downloadImage` — trigger PNG downloads via synthetic `<a download>` clicks, staggered `DOWNLOAD_INTERVAL_MS` apart to avoid the browser blocking a burst of same-tick downloads.

`parseS32File` validates buffer size and header sanity (throws/shows a user-facing error via `showError` on garbage input) and reports load status (`showInfo`) — see `statusMessage` element.

Many S32 files have mostly-empty frame slots (e.g. `Helmet01_I.S32` has 99 fully-transparent frames out of 100). `#skipBlankToggle` (checked by default) hides frames where `decompressPixels` set `pixels.isBlank` (no painted pixel-ops); `currentBuffer` caches the last-loaded `ArrayBuffer` so toggling it re-runs `parseS32File` without re-picking the file.

Visual design: warm charcoal/amber theme (CSS variables in the `<style>` block), light/dark via `prefers-color-scheme`, card-based gallery grid. Pure CSS — no DOM structure the JS depends on was changed for it.
