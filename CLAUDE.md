# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A browser extension (Manifest V3, plain JavaScript, no build step) for Crunchyroll's Bitmovin-based web player. It shows several **official** Crunchyroll subtitle tracks at once over the video, whatever dub is playing, by adding options to the player's own "Subtitles/CC" menu. See `README.md` for user-facing behaviour.

- `extension/` – the extension itself.
- `docs/images/` – pictures used by the README (rendered from design boards); `docs/design/` – icon SVG sources. The PNGs in `extension/icons/` are rendered from those SVGs (`*-small.svg` for 16/32 px).

## Commands

There is no build, lint or test runner in the repo.

- Syntax check: `node --check extension/content.js` (same for `parsers.js`, `renderer.js`, `background.js`).
- Run: `chrome://extensions` → Developer mode → Load unpacked → `extension/`; after every edit press the card's reload icon, then reload the Crunchyroll tab. Disable any other copy of the extension first or the two conflict.
- No automated tests are checked in. During development the logic was exercised with throwaway jsdom scripts (a fake player DOM + the native menu markup + stubbed `fetch`, loading the three scripts with `window.__crbsTest = {}` set first) and a static page that loads `parsers.js`/`renderer.js` to eyeball rendering. Recreate them rather than assuming they exist.

## Architecture

`manifest.json` injects `parsers.js` → `renderer.js` → `content.js` as content scripts with `"world": "MAIN"` at `document_start` (order matters; they share `window.__crbsParsers` / `window.__crbsRenderer`). `background.js` is an isolated service worker that only swaps the toolbar icon colour on crunchyroll.com tabs.

Data flow in `content.js` (single IIFE, state object `S`):

1. **Hooks** wrap `fetch` and `XMLHttpRequest` for same-origin calls only. A hit on `/playback/v3/<guid>/web/<device>/play` feeds `onPlay()`; the site's `Authorization: Bearer` header is remembered in memory (`S.auth`).
2. **Tracks.** The play JSON has `subtitles` (ASS), `captions` (VTT, dub CC) and `versions[]` (one guid per dub, `original:true` = ja-JP). A dub ships only its own language; every other language exists only on the original version. `loadOriginal()` therefore calls the original's play endpoint with a relative URL + the remembered header, merges its tracks (`getTracks()`: current dub wins on duplicates) and then DELETEs the extra playback token (with retries) so it does not count against the stream limit. It runs when the menu opens, or shortly after `onPlay` if a saved selection is missing.
3. **Parsing/rendering.** `trackData()` fetches a track's file and `parsers.js` returns `{info, cues}` with resolved ASS styles (colours, bold/italic, outline, alignment, margins, `\pos`, layers). Every 100 ms `tick()` picks the cues active at `video.currentTime` + the per-track offset and calls `renderer.draw()`, which positions an overlay over the *picture* rectangle of the `<video>`. Same-layer events stack; different layers overlap (each layer keeps its own vertical margin); different tracks stack in selection order.
4. **UI** lives only inside Crunchyroll's own menu: `ensureMenu()` finds `[data-testid="audio-text-track-menu"]` → the `role=menu` whose label contains "subtitle" → its scroll container, and appends nodes cloned from a native `menuitemradio` (so the Tailwind `kat:` classes style them). A gear in the heading unfolds size/position/per-track sync. State changes call `refreshMenu()`; the next tick re-renders. There is deliberately no separate panel, button or side menu.
5. **Burned-in subtitles.** Picking a language in the site's own menu makes it stream a manifest whose path is not `/clean/` (subtitles baked into the video). That cannot be hidden and shows as a ghost, so while our tracks are ticked `setNativeNone()` / `clearNativeSubtitle()` switch the site's choice to None (remembering/restoring it); soft `[CC]` text is hidden by styling the native `ul` layer instead.

Persistence is `localStorage` keys prefixed `crbs.` (`selected`, `style`, `offsets`, `nativeSub`).

## Gotchas

- Everything keyed to Crunchyroll's DOM (`data-testid` values, the `ul` subtitle layer as 3rd child of `.bitmovinplayer-container`, `#player-container`, the manifest URL shape) can change without notice; re-inspect the live page before assuming.
- The overlay must not get a `z-index` (it uses `isolation:isolate`); otherwise it paints over the seek bar.
- `window.__crbsTest` makes `content.js` skip the network hooks and expose `{S, onPlay, getTracks, noteManifest}`; keep it working, it is the only test seam.
- A browser without DRM support (for example an embedded preview pane) cannot play the video (error KAT-6005); use a real Chrome for anything that needs playback.

## Working with a Crunchyroll account

- Never type account credentials; the account owner logs in themselves.
- Do not capture or print the `Authorization` header. Verify the auth path by watching request statuses only; credential extraction must not be worked around.
- Opening a player spends a stream slot: pause/close test tabs, and undo any extension settings changed while testing (`crbs.selected` etc.).
