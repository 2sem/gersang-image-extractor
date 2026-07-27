# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Single-page, no-build browser tool: `index.html` (Korean UI, "거상 이미지 Viewer" = "Gersang Image Viewer"). Parses `.S32` and `.AGF` sprite files (from the game 거상/Gersang) client-side, decompresses their pixel format, renders each frame to a `<canvas>`, and lets user export selected/all frames as PNG.

No build step, no package manager, no server. Deployed as-is via GitHub Pages (root `index.html` is the entry point — see commit `fit: enables github pages` which renamed `gersang-image-viewer.html` → `index.html`).

## Running / testing

Open `index.html` directly in a browser (or serve the folder statically). Test by loading a `.S32`/`.AGF` file from `sample/` via the file input. Debug via browser DevTools console — the parser logs verbose `[Log] ...` traces for header fields, per-frame bbox, and pixel-op decode.

There are no automated tests, linter, or build/lint/test commands — this is a plain static HTML/JS file.

## Sprite formats (see `prompt` for original S32 spec notes)

거상(Gersang)'s client used `.S32` (32-bit-with-alpha), then replaced it with `.AGF` — same pixel semantics, evolved container. Both share a 16-byte header (`u32 signature, u32 width, u32 height, u32 frameCount`) and a frame-offset table at the same fixed offset `0x4c0` (1216). All integers little-endian.

Independently reverse-engineered here; the S32 side is cross-checked against the third-party reference decoder [hallazzang/gosang](https://github.com/hallazzang/gosang) (`sprite32alpha.go`), which confirms that layout. AGF has no known public reference — reverse-engineered directly against real client assets in `sample/AGF/`.

**S32** (`signature = 0x19`/25 — sibling formats `0x0F` 32-bit-no-alpha and `0x09` 8-bit-palette exist but aren't supported):
- At offset `0x4c0` (1216): `u32[frameCount]` frame data offset, relative to the frame-data base at `0xe4c`.
- At offset `0x970` (2416): `u32[frameCount]` pixel-op record count per frame.
- Both tables reserve a fixed 1200-byte block (300 frame slots) regardless of actual `frameCount` — that's why table offsets are constants, not derived from `frameCount`.
- At offset `0xe24`/`0xe28` (3620/3624): a separate sprite-level width/height field, distinct from the per-frame width/height in the main header and unused by the decoder (confirmed unused in the reference implementation too).
- Frame pixel-op streams begin at offset `0xe4c` (3660), stored uncompressed.

**AGF** (`signature = 0x23`/35):
- At offset `2416`: `{u16 x, u16 y, u16 w, u16 h}[frameCount]` — per-frame **bounding box** within the canvas (frames are trimmed to actual content, unlike S32 which always used the full canvas). This coincides numerically with S32's record-count-table offset but holds unrelated data — don't confuse the two.
- Right after that table: a 48-byte trailer — `u32 decompressedSize, u32 w×10, u32 h×10, u32 0, u32 w, u32 h, u32 w×10, u32 h×10, u32 0, u32 0, u32 flag, u32 compressedSize`.
- Then a **single zlib (RFC1950) stream** for the *entire* frame-data region (all frames concatenated) — `compressedSize` bytes long. The frame-offset table's values index into the *decompressed* buffer (same addressing convention as S32's `+0xe4c`, just relative to offset 0 of the inflated buffer instead of a file offset). Per-frame byte length is inferred from consecutive offset differences (`offsets[i+1] - offsets[i]`, or `decompressedSize - offsets[last]`) since there's no explicit per-frame size table — mirrors how `gosang`'s non-alpha sprite variants infer frame size.
- Inflated with the browser-native `DecompressionStream('deflate')` — no external library.

**Shared pixel-op format** (once S32 data or AGF's inflated buffer is in hand): each record is 4 bytes `[alpha, red, green, blue]`.
- `alpha == 0 && green == 0 && blue == 0`: skip run — `red` = number of fully-transparent pixels to advance over.
- otherwise: paints exactly one pixel using the record's own alpha (no repeat/run-length semantics for opaque pixels; only skip-runs are RLE'd).

An earlier "압축" (compressed) mode treated the type byte as a repeat count instead of an alpha value. It was removed — real S32 data has non-`0x00`/`0xFF` type bytes (variable alpha), so that interpretation desyncs `pixelIndex` and corrupts the image (confirmed against `sample/S32/Helmet01_I.S32`). `parseSpriteFile` validates the signature and rejects unsupported variants with a clear error instead of silently misdecoding them.

`sample/S32/` and `sample/AGF/` hold real fixtures per format for manual testing (same asset names across both — the AGF versions often have more real content per frame than their older S32 counterparts, since S32 files tend to have many blank frame slots). `sample/Palette/imjin2.pal` (256-entry RGB palette) and `sample/Shaders/Brightness.cso` (compiled D3D shader) are unrelated to AGF decoding — the palette belongs to the legacy 8-bit `.spr` format, and the shader is a real-time rendering effect; neither is needed to extract PNGs.

`s32-hex` is a raw hex dump excerpt of an `.S32` file's compressed-pixel region (offset `0x4C0`-`0x64F`), useful as a reference for manually verifying decoder output byte-by-byte.

## Code structure (all in `index.html`)

Everything lives in one `<script>` block, in read order:

1. `handleFileSelect` — file input → `FileReader` → `parseSpriteFile` (async).
2. `parseSpriteFile` — reads the shared header, reads `signature` to dispatch to `readS32Sprite` or (`await`) `readAGFSprite`, then loops `sprite.frameCount` calling `sprite.getFrame(i)` → `createImageData` → `addImageToContainer`. Both readers return the same shape: `{width, height, frameCount, getFrame(i) => {pixels, isBlank, x, y, w, h}}`, so the render loop, skip-blank filtering, and status/button-disable logic are format-agnostic.
3. `readS32Sprite` — reads the offset/record-count tables, `getFrame(i)` calls `decompressPixels` directly against the file's `DataView` (data is uncompressed).
4. `readAGFSprite` (async) — reads the offset/bbox tables and trailer, `await inflateZlib(...)` once up front for the whole frame-data region, then `getFrame(i)` slices the decompressed buffer per-frame and calls `decompressPixels` against a `DataView` over that buffer.
5. `inflateZlib` — wraps the browser-native `DecompressionStream('deflate')` in a `Blob`/`Response` round-trip to inflate a zlib byte stream; no external library.
6. `decompressPixels` — the core RLE decoder per the format spec above; shared by both readers.
7. `createImageData` — writes decoded RGBA pixels into an offscreen `<canvas>`, composited at `(offsetX, offsetY)` so AGF's trimmed per-frame bounding box lands in the right place on the full canvas (S32 frames always pass `offsetX=offsetY=0` and fill the whole canvas).
8. `addImageToContainer` — renders one numbered, checkbox-selectable thumbnail into `#imageContainer`; also wires a click handler so tapping anywhere on the card (image or padding) toggles its checkbox without double-firing when the checkbox/label itself is clicked.
9. `exportSelectedImages` / `exportAllImages` / `downloadImage` — trigger PNG downloads via synthetic `<a download>` clicks, staggered `DOWNLOAD_INTERVAL_MS` apart to avoid the browser blocking a burst of same-tick downloads.

`parseSpriteFile` validates buffer size and header sanity (throws/shows a user-facing error via `showError` on garbage input) and reports load status (`showInfo`) — see `statusMessage` element.

Many sprite files have mostly-empty frame slots (e.g. `sample/S32/Helmet01_I.S32` has 99 fully-transparent frames out of 100). `#skipBlankToggle` (checked by default) hides frames where a reader's `getFrame` set `isBlank` (no painted pixel-ops); `currentBuffer` caches the last-loaded `ArrayBuffer` so toggling it re-runs `parseSpriteFile` without re-picking the file.

Visual design: warm charcoal/amber theme (CSS variables in the `<style>` block), light/dark via `prefers-color-scheme`, card-based gallery grid. Pure CSS — no DOM structure the JS depends on was changed for it.
