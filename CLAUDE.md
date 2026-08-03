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

1. `handleFileSelect` — reads the picked file via `loadFile(file, displayLabel)` (async, `file.arrayBuffer()` → `parseSpriteFile`).
2. `parseSpriteFile` — reads the shared header, reads `signature` to dispatch to `readS32Sprite` or (`await`) `readAGFSprite`, then loops `sprite.frameCount` calling `sprite.getFrame(i)` → `renderFrameCanvas` → `addImageToContainer`. Both readers return the same shape: `{width, height, frameCount, getFrame(i) => {pixels, isBlank, x, y, w, h}}`, so the render loop, skip-blank filtering, and status/button-disable logic are format-agnostic.
3. `readS32Sprite` — reads the offset/record-count tables, `getFrame(i)` calls `decompressPixels` directly against the file's `DataView` (data is uncompressed).
4. `readAGFSprite` (async) — reads the offset/bbox tables and trailer, `await inflateZlib(...)` once up front for the whole frame-data region, then `getFrame(i)` slices the decompressed buffer per-frame and calls `decompressPixels` against a `DataView` over that buffer.
5. `inflateZlib` — wraps the browser-native `DecompressionStream('deflate')` in a `Blob`/`Response` round-trip to inflate a zlib byte stream; no external library.
6. `decompressPixels` — the core RLE decoder per the format spec above; shared by both readers.
7. `renderFrameCanvas` — writes decoded RGBA pixels into an offscreen `<canvas>`, composited at `(offsetX, offsetY)` so AGF's trimmed per-frame bounding box lands in the right place on the full canvas (S32 frames always pass `offsetX=offsetY=0` and fill the whole canvas). Returns the canvas itself (not a data URL) so callers can also read back raw RGBA via `getImageData` — used for GIF frame capture.
8. `addImageToContainer` — renders one numbered, checkbox-selectable thumbnail into `#imageContainer`; also wires a click handler so tapping anywhere on the card (image or padding) toggles its checkbox without double-firing when the checkbox/label itself is clicked, plus shift+click range selection (see below).
9. `exportSelectedImages` / `exportAllImages` / `downloadImage` — trigger PNG downloads via synthetic `<a download>` clicks, staggered `DOWNLOAD_INTERVAL_MS` apart to avoid the browser blocking a burst of same-tick downloads — unless `#animationModeToggle` is checked, in which case both export buttons call `exportAnimationAsGif` instead (see below).

`parseSpriteFile` validates buffer size and header sanity (throws/shows a user-facing error via `showError` on garbage input) and reports load status (`showInfo`) — see `statusMessage` element.

Many sprite files have mostly-empty frame slots (e.g. `sample/S32/Helmet01_I.S32` has 99 fully-transparent frames out of 100). `#skipBlankToggle` (checked by default) hides frames where a reader's `getFrame` set `isBlank` (no painted pixel-ops); `currentBuffer` caches the last-loaded `ArrayBuffer` so toggling it re-runs `parseSpriteFile` without re-picking the file.

Shift+click range selection: `itemCheckboxes[i]` holds the i-th rendered thumbnail's checkbox in display order (`addImageToContainer`'s `itemIndex` param, passed as `renderedCount` at render time — both reset at the top of `parseSpriteFile`), and `lastClickedItemIndex` is the anchor. Clicking any item updates the anchor; shift+clicking another calls `fillRange` to force-check everything between the two (inclusive), via the checkbox, label, or card/image click. Important gotcha: this does **not** call `preventDefault()` on the click — doing so on a checkbox makes the browser revert `.checked` to its pre-click value after all listeners finish, silently undoing any programmatic assignment made during the same handler. Instead, the native/manual toggle for the just-clicked item is left to happen normally, and the range-fill runs as a separate step afterward.

### Animation (GIF) mode

`#animationModeToggle` treats the currently-shown frames (same set skip-blank would show) as an animation sequence instead of independent items. When checked, `parseSpriteFile`'s render loop also captures each shown frame's full-canvas RGBA (`canvas.getContext('2d').getImageData(...)`) into `currentAnimationFrames`, and its already-rendered data URL into `currentAnimationFrameDataUrls`. Both arrays are built in the same order `.image-item`s are added to the DOM, so a checkbox's position among `.image-item input[type="checkbox"]` is directly usable as an index into either array (`getSelectedFrameIndices`).

Some AGF files bundle multiple animations (idle, walk, attack, ...) as one frame sequence, so selection matters: `startGifPreview(dataUrls, isSelection)` cycles `#gifPreviewImage.src` through whatever list it's given on a `setInterval` (`GIF_PREVIEW_INTERVAL_MS`) — no GIF encoding involved, just flipping through already-rendered PNGs, so the preview is instant regardless of file size. `updateGifPreviewForSelection` decides which list: checked frames if any are checked, otherwise every shown frame. It's called after `parseSpriteFile` finishes (fresh load — nothing checked yet, so "all"), from `toggleSelectAll`, and from both of `addImageToContainer`'s selection-toggle paths (the checkbox's native `change` event for direct checkbox/label clicks, and an explicit call after the manual `.checked` flip for card/image/padding clicks, since programmatically setting `.checked` doesn't fire `change`).

Actual GIF encoding only happens in `exportAnimationAsGif(useSelection)`, called when either export button is clicked while animation mode is on — `exportSelectedImages` passes `true` (checked frames only, error if none checked), `exportAllImages` passes `false` (always every shown frame, regardless of selection). It runs `encodeAnimatedGif` (a from-scratch GIF89a encoder — no external library, consistent with the rest of this tool):
- `collectColorHistogram` + `medianCutQuantize` — frequency-weighted median-cut color quantization across *all* frames combined, producing one shared global palette (≤255 colors, 1 slot reserved for a transparent index) rather than per-frame local color tables.
- `makeNearestColorFn` — brute-force nearest-color lookup per pixel against that palette (fast enough at this scale — up to ~100 frames × ~3600px was well under a second in testing).
- `createBitWriter` + `lzwEncode` — GIF-flavored variable-width LZW compression of each frame's palette-index stream.
- `encodeAnimatedGif` assembles the actual GIF89a byte stream by hand (Logical Screen Descriptor, Global Color Table, `NETSCAPE2.0` looping extension, then a Graphic Control Extension + Image Descriptor + LZW sub-blocks per frame) at `GIF_FRAME_DELAY_CS` (10 centiseconds = 100ms, matching the preview's pace).

Alpha < 128 maps to the transparent palette index; there's no partial-alpha support in GIF, so translucent edge pixels get hard-thresholded. Validated by decoding exported GIFs with Pillow (correct frame count/size/loop/duration) and visually inspecting frames.

Visual design: warm charcoal/amber theme (CSS variables in the `<style>` block), light/dark via `prefers-color-scheme`, card-based gallery grid, checkerboard backdrop behind the GIF preview to show transparency. Pure CSS — no DOM structure the JS depends on was changed for it.

### Sidebar layout

Page layout is a flex `.app-shell`: the sidebar (`#sidebar`, `.collapsed` by default), a slim `#sidebarToggle` button that toggles the sidebar's `.collapsed` class (width/opacity transition to 0) — it lives *outside* the collapsible `<aside>` so it's always clickable even when the sidebar itself is width:0 — and `<main class="main-content">` holding everything that used to be direct children of `<body>` (h1, toolbar, GIF preview, gallery, footer) — unchanged otherwise.

### Item-name search (static label catalog guide)

There's no metadata inside `.agf`/`.s32` files describing what an item actually is — filenames are cryptic (`dress02_i.AGF`). The sidebar is a **static reference guide** built from a community-maintained label catalog: `labels.js` declares an empty `GERSANG_LABELS` registry, and each cataloged sprite file gets its own small source file under `indexes/` (nested however — e.g. `indexes/Textures/Items/dress02_i.js` mirrors the game's own asset folder layout) that does `GERSANG_LABELS["dress02_i.AGF"] = { name: "의복2", items: { "22": "복희의 의복", "23": "츠쿠요미 의복" } }`. `name` (a friendly display name for the whole file) is optional; `items` maps 1-based frame index → item name.

Those small per-item files are for editing (low merge-conflict diffs across separate PRs); `scripts/build-indexes.py` concatenates every `indexes/**/*.js` file into one generated `indexes.js`, which is the single file `index.html` actually loads via a fixed `<script src="indexes.js">` tag. It also regex-extracts each file's `GERSANG_LABELS["..."] = ` assignment key(s) and appends a `GERSANG_LABELS["..."].folder = "<indexes/-relative dir>";` line per key (e.g. `"Textures/Items"` for `indexes/Textures/Items/dress02_i.js`) — contributors never set `.folder` themselves. This means adding a new catalog entry never touches `index.html` (no manifest to maintain either) — the two-step workflow is: (1) create/edit a file under `indexes/`, (2) run `python3 scripts/build-indexes.py` and commit the regenerated `indexes.js` alongside it. See `labels.js`'s header comment for the exact steps. Both `labels.js` and the generated `indexes.js` load via plain `<script src>` tags rather than `fetch()`/XHR — browsers block `fetch()` of local files under `file://`, which would break this when `index.html` is opened directly instead of served over http(s); `<script src>` resource loading isn't subject to that restriction.

The catalog also surfaces in the gallery itself: `addImageToContainer`'s `getCatalogItemName(frameIndex)` looks up `GERSANG_LABELS[currentFileName]?.items[frameIndex]` and, when present, renders it as a small `.item-name` div under that frame's thumbnail (nothing shown when uncataloged) — same data as the sidebar guide, just surfaced next to the frame you're already looking at instead of requiring a cross-reference trip to the sidebar.

**Important: this guide is not tied to any locally picked file, and its entries never load a file.** `renderLabelGuide(query)` renders directly from `GERSANG_LABELS`, always as a collapsible tree grouped by `.folder` (`groupGuideRowsByFolder` + `renderGuideGroup`/`buildGuideFolderNode`/`buildGuideFileNode`) mirroring `indexes/`'s own directory layout — folder headers only toggle a `.collapsed` class on their children (CSS `display:none`), they never load anything. With `query` empty (page load, or the search box cleared) the tree holds the full catalog; typing filters the rows fed into the same grouping logic, so a match still renders under its parent folders instead of losing that context. Matching, both cases: matching item names, the file's `name`, or the filename itself. When a query matches at the item level, only those matching items show under their file (precise search); when it only matches via filename/`name` (no item content matched), every item in that file is shown for context. Results are tagged with a `[인벤토리]`/`[필드]` badge (`getFileTypeBadge`, from the `_I`/`_F` filename suffix convention — a naming convention only, not something the format encodes).

Each `.guide-frame` row IS clickable, but only for one purpose: `jumpToGalleryFrame(filename, frameIndex)` scrolls to and briefly flashes (`.jump-flash`, a 1.2s CSS keyframe pulse) the matching `.image-item[data-frame-index]` — but only when `currentFileName === filename` and that frame is actually rendered (not hidden by skip-blank). Otherwise it just calls `showInfo` with which file to go open, or that the frame isn't currently shown — it never calls `loadFile`. (An earlier version of this feature mirrored a locally-picked folder via `webkitdirectory` with click-to-load; that was removed because the sidebar's purpose is a global reference guide, not a per-session file browser — neither the folder *grouping* nor this jump-to-frame behavior loads anything on its own, they only act on a file the user already opened themselves.)
