// Shared registry for the community-maintained catalog of what specific frames in
// specific sprite files actually depict, used by index.html's sidebar search. There
// is no such metadata inside .agf/.s32 files themselves — filenames are cryptic
// (e.g. "armor_01_I.AGF"), so this is the only way to search by an actual item name.
//
// This file just declares the empty registry. Each cataloged item gets its own file
// under indexes/ (one file per sprite file, e.g. indexes/armor_01_I.js) that adds its
// entry to GERSANG_LABELS — small per-item files instead of one giant JSON avoids
// merge conflicts when multiple people contribute entries via separate PRs.
//
// All of these load via plain <script src="..."> tags (see index.html's <head>)
// rather than fetch()/XHR — browsers block fetch() of local files under file://,
// which would break this when index.html is opened directly (double-clicked)
// instead of served over http(s). A <script src> resource load works identically
// either way, so this keeps that "no server needed" property intact.
//
// To add an entry:
//   1. Create indexes/<something>.js containing:
//        GERSANG_LABELS["<exact filename>"] = { "<frameIndex>": "<name>", ... };
//      Filenames are matched case-insensitively against whatever files the user
//      loads. Frame index is the same 1-based number shown under each thumbnail.
//      Only add a frame once you actually know what it is — unlabeled frames
//      simply won't show a name in search results, which is expected and fine.
//   2. Add <script src="indexes/<something>.js"></script> in index.html's <head>,
//      right after the other indexes/*.js entries.
const GERSANG_LABELS = {};
