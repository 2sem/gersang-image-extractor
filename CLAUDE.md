# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Single-page, no-build browser tool: `index.html` (Korean UI, "거상 이미지 Viewer" = "Gersang Image Viewer"). Parses `.S32` sprite files (from the game 거상/Gersang) client-side, decompresses their custom RLE pixel format, renders each frame to a `<canvas>`, and lets user export selected/all frames as PNG.

No build step, no package manager, no server. Deployed as-is via GitHub Pages (root `index.html` is the entry point — see commit `fit: enables github pages` which renamed `gersang-image-viewer.html` → `index.html`).

## Running / testing

Open `index.html` directly in a browser (or serve the folder statically). Test by loading a `.S32` file from `sample/` via the file input. Debug via browser DevTools console — the parser logs verbose `[Log] ...` traces for every image and pixel command (file type, width/height, image count, per-image start offsets/compressed pixel counts, per-pixel decode).

There are no automated tests, linter, or build/lint/test commands — this is a plain static HTML/JS file.

## S32 file format (see `prompt` for full spec)

All integers little-endian.

- Header: `u32` file type, `u32` width, `u32` height, `u32` image count.
- At offset `1216`: one `u32` per image = start offset of that image's compressed pixel data, **plus a fixed `+3660` applied at read time**.
- At offset `2416`: one `u32` per image = compressed pixel count for that image.
- Each compressed pixel record is 4 bytes: `[type, byte1, byte2, byte3]`.
  - `type == 0`: skip command — `byte1` = number of pixels to skip (painted fully transparent `0,0,0,0`); `byte2`/`byte3` unused.
  - `type > 0`: `type` = alpha value directly, followed by R, G, B — one record decodes exactly one pixel (no repeat/run-length semantics for opaque pixels; only skip-runs are RLE'd).

An earlier "압축" (compressed) mode treated `type` as a repeat count instead of an alpha value. It was removed — real S32 data has non-`0x00`/`0xFF` type bytes (variable alpha), so that interpretation desyncs `pixelIndex` and corrupts the image (confirmed against `sample/Helmet01_I.S32`). The alpha-value interpretation above is the correct/only format.

`sample/` contains real `.S32` fixtures (`armor02_I.S32`, `CoinIcon.S32`, `creature_i.S32`, `Element01_I.S32`, `Helmet01_I.S32`, `Ring01_I.S32`, `Weapon02_F.S32`) for manual testing.

`s32-hex` is a raw hex dump excerpt of an `.S32` file's compressed-pixel region (offset `0x4C0`-`0x64F`), useful as a reference for manually verifying decoder output byte-by-byte.

## Code structure (all in `index.html`)

Everything lives in one `<script>` block, in read order:

1. `handleFileSelect` — file input → `FileReader` → `parseS32File`.
2. `parseS32File` — reads header, builds `startPositions` (with the `+3660` offset baked in) and `compressedPixelCounts` arrays, then loops images calling `decompressPixels` → `createImageData` → `addImageToContainer`.
3. `decompressPixels` — the core RLE decoder per the format spec above.
4. `createImageData` — writes decoded RGBA pixels into an offscreen `<canvas>`, returns a data URL.
5. `addImageToContainer` — renders one numbered, checkbox-selectable thumbnail into `#imageContainer`.
6. `exportSelectedImages` / `exportAllImages` / `downloadImage` — trigger PNG downloads via synthetic `<a download>` clicks, staggered `DOWNLOAD_INTERVAL_MS` apart to avoid the browser blocking a burst of same-tick downloads.

`parseS32File` validates buffer size and header sanity (throws/shows a user-facing error via `showError` on garbage input) and reports load status (`showInfo`) — see `statusMessage` element.
