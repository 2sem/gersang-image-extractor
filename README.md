# 거상 이미지 Viewer (Gersang Image Viewer)

A single-page, no-build browser tool that extracts sprite frames from 거상(Gersang)'s `.S32` and `.AGF` asset files and exports them as PNGs. Everything runs client-side — pick a file, it decodes and renders in the browser, no server involved.

**Live:** https://2sem.github.io/gersang-image-extractor/ (GitHub Pages, `index.html` is the entry point).

<video src="docs/demo.mp4" controls poster="docs/screenshot.png" width="900">
  Your browser doesn't support inline video — <a href="docs/demo.mp4">download the demo</a> instead.
</video>

## Features

- Loads `.S32` and `.AGF` sprite files and renders every frame as a thumbnail.
- Auto-detects which format a file is (by its signature byte, not the extension).
- Hides fully-transparent ("blank") frames by default — many sprite files have dozens of unused frame slots — with a toggle to show them.
- Select individual frames (click anywhere on a thumbnail, or its checkbox), shift+click to select a range, or use "전체 선택/해제" to select all.
- Export selected frames, or all frames, as PNGs (downloads are staggered so the browser doesn't block a burst of simultaneous downloads).
- "애니메이션(GIF)로 보기" — for files that are actually an animation sequence (walk cycle, attack, etc.) rather than a grid of distinct items: shows a live preview by cycling through the shown (or selected) frames, and exporting produces a single animated `.gif` instead of individual PNGs.

## How it works

There's no build step and no dependencies — one HTML file with an inline `<script>`. The pipeline for any file is:

1. Read the file into an `ArrayBuffer` (`FileReader`).
2. Read the 16-byte header to get the format signature, canvas width/height, and frame count.
3. Dispatch on signature to the S32 or AGF reader, each of which returns the same shape: `{ width, height, frameCount, getFrame(i) }`. `getFrame(i)` decodes one frame on demand into an RGBA pixel buffer plus its position within the canvas.
4. For each frame (skipping blanks if the toggle is on), paint the pixel buffer onto an offscreen `<canvas>` at the right position and get a PNG data URL from it.
5. Render each data URL as a numbered, checkbox-selectable thumbnail.

The two formats share the exact same per-pixel encoding — the only real difference is the container around it (see below), which is why one small, shared pixel decoder (`decompressPixels`) handles both.

## Sprite format

This format has no public specification. The S32 side was reverse-engineered here and cross-checked against a third-party reference decoder, [hallazzang/gosang](https://github.com/hallazzang/gosang) (`sprite32alpha.go`), which independently confirms the layout below. The AGF side has no known public reference — it was reverse-engineered directly against real client assets by comparing S32 and AGF versions of the same game items and decoding to real, visually-correct PNGs.

All integers are little-endian.

### Shared header

Both formats start with the same 16-byte header, and both put the frame-offset table at the same fixed file offset:

| Offset | Field | Type |
|---|---|---|
| `0x000` (0) | `signature` | `u32` |
| `0x004` (4) | `width` | `u32` — full canvas width |
| `0x008` (8) | `height` | `u32` — full canvas height |
| `0x00C` (12) | `frameCount` | `u32` |
| `0x4C0` (1216) | frame-offset table | `u32[frameCount]` |

The signature tells you which format (and which variant) you're looking at:

| Signature | Format |
|---|---|
| `0x09` | 8-bit palette sprite (legacy `.spr` — not supported by this tool) |
| `0x0F` | 32-bit sprite, no alpha (not supported by this tool) |
| `0x19` (25) | **S32** — 32-bit sprite with alpha |
| `0x23` (35) | **AGF** — successor to S32 |

### S32 (`signature = 0x19`)

- `0x970` (2416): `u32[frameCount]` — number of 4-byte pixel-op records per frame.
- Both the offset table and the record-count table reserve a fixed **1200-byte block** (room for 300 frame slots) regardless of the file's actual `frameCount` — that's why every offset in this format is a fixed constant rather than something computed from `frameCount`.
- `0xE24` / `0xE28` (3620/3624): a sprite-level width/height field, separate from the per-frame width/height in the main header. Present in every file but unused by any decoder (confirmed unused in the reference implementation too) — looks like leftover metadata from the original authoring tool.
- `0xE4C` (3660): frame pixel-op data begins here, **stored uncompressed**. Each frame's data starts at `offsetTable[i] + 0xE4C` and is `recordCountTable[i]` records long. Every frame always covers the *full* canvas — there's no per-frame trimming.

### AGF (`signature = 0x23`)

AGF keeps S32's header and offset-table location, but replaces everything downstream of that with a leaner, dynamically-sized layout and adds two real improvements: per-frame trimming and whole-file compression.

- `2416`: `{ u16 x, u16 y, u16 w, u16 h }[frameCount]` — a **per-frame bounding box** within the canvas. Unlike S32, AGF frames are trimmed to their actual visible content instead of always encoding the full canvas. This table happens to sit at the same numeric offset as S32's record-count table, but holds completely different data — don't confuse the two formats' tables just because the address matches.
- Right after that table, a fixed **48-byte trailer**:

  | u32 # | Meaning |
  |---|---|
  | 0 | decompressed frame-data size (bytes) |
  | 1 | `width × 10` |
  | 2 | `height × 10` |
  | 3 | 0 |
  | 4 | `width` |
  | 5 | `height` |
  | 6 | `width × 10` (repeated) |
  | 7 | `height × 10` (repeated) |
  | 8 | 0 |
  | 9 | 0 |
  | 10 | flag (0 or 1, purpose unconfirmed) |
  | 11 | **compressed frame-data size (bytes)** |

- Immediately after the trailer: a **single zlib (RFC 1950) stream**, `trailer[11]` bytes long, covering *every* frame's pixel-op data concatenated together (not one stream per frame). Inflating it yields a buffer `trailer[0]` bytes long.
- The frame-offset table read from `0x4C0` gives each frame's byte offset **into that decompressed buffer** (not into the file) — same addressing idea as S32's `+0xE4C`, just relative to the start of the inflated data instead of a file offset.
- There's no explicit per-frame size table (unlike S32's record-count table). A frame's length is inferred from the *next* frame's offset: `offsets[i+1] - offsets[i]`, or `decompressedSize - offsets[last]` for the final frame. This is the same trick `gosang`'s own 8-bit and no-alpha 32-bit sprite readers use, since those formats don't store an explicit size either.
- This tool inflates the stream with the browser-native `DecompressionStream('deflate')` — no external compression library needed.

Net effect: AGF files are usually much smaller than their S32 equivalents (compression + trimming blank canvas area), though a file can end up *larger* if its AGF version simply has more real frame content than the old S32 one did (several sample assets do — the S32 versions had many blank frame slots that were later filled in).

### Shared pixel-op format

Once you have a frame's raw bytes — S32's uncompressed slice, or AGF's slice of the inflated buffer — both formats decode identically. Each pixel-op record is 4 bytes: `[alpha, red, green, blue]`.

- **Skip run**: `alpha == 0 && green == 0 && blue == 0`. `red` holds the number of consecutive fully-transparent pixels to advance over (rendered as `0,0,0,0`).
- **Painted pixel**: anything else. Paints exactly *one* pixel using the record's own `alpha`, `red`, `green`, `blue`. There's no run-length repeat for painted pixels — only transparent runs are compressed this way.

Records are consumed in raster order (left-to-right, top-to-bottom) filling a `width × height` (S32) or `bboxWidth × bboxHeight` (AGF) buffer.

An earlier version of this tool had a second decode mode that misread `alpha` as a run-length repeat count instead of a literal alpha value. It was removed after confirming (against `sample/S32/Helmet01_I.S32`) that real files contain type bytes other than `0x00`/`0xFF`, which that interpretation decodes into visibly corrupted, striped output. The alpha-value interpretation above is the only correct one.

## Animation (GIF) export

Some sprite files are a grid of unrelated items (rings, gems, scrolls); others are frames of one animation (a character's walk cycle). "애니메이션(GIF)로 보기" is for the latter case.

- **Preview is free**: checking the box just cycles `<img>`'s `src` through the same full-quality frame images already rendered for the thumbnail grid, on a 100ms interval. No encoding happens yet, so it's instant regardless of file size.
- **Select a sub-animation**: some AGF files bundle multiple animations (idle, walk, attack, ...) as one long frame sequence. Check specific frames and the preview switches to cycling just those, in order — useful for isolating one animation out of a bundle before exporting.
- **Encoding happens on export**: "선택한 이미지 내보내기" builds the GIF from only the checked frames (erroring if none are checked); "전체 내보내기" always uses every currently-shown frame regardless of selection. Either way it runs a from-scratch GIF89a encoder (median-cut color quantization + LZW compression, written by hand — no external library) and downloads one `.gif` file instead of per-frame PNGs.
- GIF is a hard 256-color format with binary (not partial) transparency, so this is lossy: colors are quantized to a shared palette (≤255 colors + 1 transparent index) across all frames, and pixels with alpha below 128 become fully transparent. Fine for pixel-art game sprites; not lossless.
- Tested up to ~100 frames at 60×60 — encoding took well under a second.

## Sample files

`sample/S32/` and `sample/AGF/` hold real client assets, same item names across both formats, for manual testing and comparison. `sample/Palette/imjin2.pal` (a 256-entry RGB palette, 768 bytes) and `sample/Shaders/Brightness.cso` (a compiled Direct3D shader) came from the same asset dump but are **not used by this tool** — the palette belongs to the legacy 8-bit `.spr` format this tool doesn't support, and the shader implements a real-time brightness-tint rendering effect, not part of static PNG extraction.

`s32-hex` is a raw hex dump excerpt of an S32 file's pixel-op region, useful as a manual byte-by-byte reference.

## Development

No build step, no package manager. Open `index.html` directly in a browser to run it. See `CLAUDE.md` for guidance aimed at AI coding agents working in this repo.

## Author

현무 서버 !무쌍거상! (자동, 자동마저, 자동타저)

## Questions / Contact

- In-game (거상, 현무 서버): 자동, 자동마저, 자동타저
- KakaoTalk open chat "게임도우미": https://open.kakao.com/o/g2o1jY9d

  <img src="docs/kakao-qr.jpeg" alt="게임도우미 KakaoTalk open chat QR code" width="200">

