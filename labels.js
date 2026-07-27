// Shared registry for the community-maintained catalog of what specific frames in
// specific sprite files actually depict, rendered as a static reference guide in
// index.html's sidebar. There is no such metadata inside .agf/.s32 files themselves —
// filenames are cryptic (e.g. "dress02_i.AGF"), so this is the only way to look up an
// actual item name. The guide is independent of any file you've loaded and its
// entries aren't clickable — it just tells you which filename to go open via the
// "파일 선택" picker.
//
// This file just declares the empty registry. Each cataloged sprite file gets its own
// small source file under indexes/ (nested however you like, e.g.
// indexes/Textures/Items/dress02_i.js mirroring the game's own asset folder layout) —
// small per-item files instead of one giant JSON avoids merge conflicts when multiple
// people contribute entries via separate PRs. scripts/build-indexes.py concatenates
// every indexes/**/*.js into a single generated indexes.js, which is the one file
// index.html actually loads — so the page needs exactly one fixed <script> tag no
// matter how many items get cataloged; nothing in index.html or a manifest needs
// editing when you add an entry.
//
// labels.js and the generated indexes.js load via plain <script src="..."> tags (see
// index.html's <head>) rather than fetch()/XHR — browsers block fetch() of local files
// under file://, which would break this when index.html is opened directly
// (double-clicked) instead of served over http(s). A <script src> resource load works
// identically either way, so this keeps that "no server needed" property intact.
//
// To add an entry:
//   1. Create indexes/<some path>.js containing:
//        GERSANG_LABELS["<exact filename>"] = {
//            name: "<friendly name for the whole file, e.g. '의복2'>",
//            items: {
//                "<frameIndex>": "<item name>",
//                ...
//            }
//        };
//      Frame index is the same 1-based number shown under each thumbnail. Only add
//      a frame once you actually know what it is — unlabeled frames simply won't
//      show up, which is expected and fine. `name` is optional.
//   2. Run `python3 scripts/build-indexes.py` to regenerate indexes.js.
//   3. Commit both the new file under indexes/ and the regenerated indexes.js.
const GERSANG_LABELS = {};
