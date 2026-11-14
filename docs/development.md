<sub>[← Back to GitGremlin](../README.md)</sub>

# Development guide

How GitGremlin is built, and how to work on it: run it from source, change the pets' art, build the installer, or add a new pet.

## Contents

- [Run it in dev mode](#run-it-in-dev-mode)
- [Project structure](#project-structure)
- [How it works](#how-it-works)
- [Pet art](#pet-art)
- [Adding a new pet](#adding-a-new-pet)
- [Building the installer](#building-the-installer)
- [Command-line flags](#command-line-flags)
- [npm scripts](#npm-scripts)

## Run it in dev mode

First follow steps 1–4 of the [installation guide](../README.md#installation). Then quit the installed GitGremlin from its tray icon (only one copy runs at a time) and run:

```bash
npm start
```

This starts electron-vite's dev server with hot reload for the renderer (the pets and the panel). After changing code in `src/main`, restart `npm start`.

While it runs, two dev pages are available in a browser:

| Page | What it's for |
|---|---|
| <http://localhost:5173/preview.html> | A fake desktop with both pets, and buttons to feed Catbot, change its contribution level, make Dusty scan and clean, and move the "window" they stand on |
| <http://localhost:5173/sheet.html?pet=dusty&k=6> | Every animation frame of a pet (`catbot` or `dusty`), enlarged (`k` = zoom) |

Typecheck everything with `npm run typecheck`.

## Project structure

```
src/
  main/           Electron main process
    index.ts        app start-up, IPC, wiring
    overlay.ts      one transparent overlay window per monitor, z-order
    hub-window.ts   the GitGremlin panel window
    tray.ts         the tray icon and menu
    store.ts        settings and state (%APPDATA%\GitGremlin\state.json)
    launcher.ts     Start menu shortcut, self-rebuild on launch
    native.ts       Win32 helpers (koffi FFI)
    junk.ts         Dusty's junk scanner and cleaner
    repos.ts        Syncy's repo finder and git checks
    github*.ts      GitHub sign-in and contribution calendar
    pets/           each pet's "purpose" service (catbot.ts, dusty.ts, syncy.ts)
  preload/        the IPC bridge exposed to the renderers
  renderer/       overlay (pets) and panel (hub.*) pages
    pet/            brain (movement, behaviour), personas, sprites, particles
    ui/             the pets' message box
  shared/         types, constants, formatting
assets/
  pets/<pet>/     generated frames, eyes, food, portrait, frames.json
  textures/       shared particles
scripts/
  art/            pixel-art toolkit, one drawing per pet, and the logo
docs/             pet guides, this guide, README images
```

## How it works

- **One overlay per monitor.** One transparent, frameless, non-focusable window per monitor is shared by all pets. It's hidden from the taskbar and Alt+Tab. Each pet is *owned* by one overlay, which runs its brain. When the pet walks onto another monitor, that monitor's overlay takes over.
- **Layering.**
  - Desktop mode: the overlays are kept just above the desktop with `SetWindowPos(HWND_BOTTOM)`, re-checked every 0.6 s.
  - On-top mode: they use `setAlwaysOnTop(true, 'screen-saver')`, plus a `HWND_TOPMOST` re-assert every 1.5 s.
- **Hover and click-through.** The overlay ignores the mouse (`setIgnoreMouseEvents(true, { forward: true })`) except while the cursor is over a pet. The cursor is also polled about 10 times a second. In desktop mode, `WindowFromPoint` checks that no app window covers the spot.
- **Rendering.** Each pet has its own small 2D canvas, scaled by whole device pixels so the pixel art stays crisp. It runs at about 30 fps, skips unchanged frames, drops to 10 fps when idle and stops when hidden.
- **Purpose services.** These run in the main process and send each pet a status: mood, level, report lines, an optional alert, and whether it's busy. The pet's brain turns that into behaviour, and its persona (`src/renderer/pet/personas.ts`) gives it its lines and habits.
- **Windows helpers.** A small [koffi](https://koffi.dev/) FFI module handles:
  - z-order;
  - the focused window (for window hopping);
  - the Recycle Bin (`SHQueryRecycleBinW` / `SHEmptyRecycleBinW`);
  - the taskbar.
- **Launching from source.** The Start menu shortcut runs `electron.exe <project folder>`. On start, [`launcher.ts`](../src/main/launcher.ts) rebuilds `out/` if the source is newer, then relaunches.
- **Network.** The only network access is the GitHub GraphQL API, for Catbot.

## Pet art

Every pet is drawn in code:
- [`scripts/art/pixel.ts`](../scripts/art/pixel.ts) is a tiny toolkit: an RGBA image, pattern stamping, auto-outlines, scaling and a PNG encoder.
- Each pet has its own drawing script in `scripts/art/<pet>.ts`.
- [`scripts/generate-textures.ts`](../scripts/generate-textures.ts) writes everything out:

| File | What it is |
|---|---|
| `assets/pets/<pet>/<animation>-<n>.png` | 50×38 side-view frames, facing right (mirrored at runtime) |
| `assets/pets/<pet>/eyes_*.png` | Expressions drawn over each frame: `idle`, `blink`, `happy`, `hurt`, `alert`, `sad` |
| `assets/pets/<pet>/accent_on.png` | Optional light drawn when content (Catbot's bell) |
| `assets/pets/<pet>/food.png` | What the pet eats |
| `assets/pets/<pet>/portrait.png` | The panel's picture |
| `assets/pets/<pet>/frames.json` | Animations, frame rates, the feet anchor, and where the eyes and accent sit in each frame |
| `assets/textures/heart.png`, `zzz.png` | Shared particles |
| `assets/icon.png`, `assets/icon.ico`, `build/icon.png` | Tray, Start menu and installer icons |

You can edit any PNG in a pixel editor (Aseprite, Piskel, ...) and restart the app. Or regenerate from code. This **overwrites** your edits, and needs Node.js 23.6+, which runs TypeScript directly:

```bash
npm run textures            # every pet
npm run textures -- syncy   # just one pet
```

The README images in `docs/images/` are rendered from the asset PNGs, so they always match what the app draws. Re-render them after changing the art:

```bash
npm run docs-images
```

## Adding a new pet

1. **Art:** write `scripts/art/<pet>.ts` returning a `PetArt` (see `catbot.ts` / `dusty.ts`), add it to `generate-textures.ts`, and run `npm run textures`.
2. **Identity:** add the id to `PetId` in `src/shared/types.ts`, then to `PET_IDS`, `PET_PURPOSE` and `DEFAULT_SETTINGS` in `src/shared/constants.ts`.
3. **Purpose:** write `src/main/pets/<pet>.ts`, which returns the pet's `PetStatus`. Wire it into `src/main/index.ts` (start-up, `status()`, and any panel IPC) and give it tray actions in `src/main/tray.ts`.
4. **Personality:** add a persona (lines, extra habits, bubble colours) to `src/renderer/pet/personas.ts`.
5. **Panel:** add a `<template id="<pet>Purpose">` to `src/renderer/hub.html` for its own settings, and a tray submenu entry in `src/main/tray.ts`.
6. **Docs:** add `docs/pets/<pet>.md` (copy an existing one) and a row in the README's pet table.

## Building the installer

```bash
npm run build
```

This typechecks, bundles with electron-vite and runs electron-builder. The NSIS installer lands in `dist/GitGremlin-Setup-<version>.exe`. Every push to `main` also builds it on GitHub Actions ([`build.yml`](../.github/workflows/build.yml)): download the **GitGremlin-Setup** artifact from the run on the **Actions** tab.

### Smart App Control

On PCs with Windows 11 **Smart App Control** turned on, a local build fails at the end with `spawn UNKNOWN`. electron-builder has to run the freshly built, unsigned installer stub, and Smart App Control blocks it. For the same reason, it blocks any unsigned GitGremlin installer or `GitGremlin.exe`.

Your options:
- **Install from source** with `npm run install-app`. This is what the [installation guide](../README.md#installation) does: it runs the signed Electron runtime.
- **Build in CI** and install the artifact on a PC without Smart App Control.
- **Code-sign** the build with a trusted certificate (see electron-builder's `win.signtoolOptions`).

## Command-line flags

A second launch passes these to the running app:

| Flag | Effect |
|---|---|
| `--settings` | Open the GitGremlin panel |
| `--feed [catbot\|dusty\|syncy]` | Give a pet a debug snack |
| `--scan` | Make Dusty scan now |
| `--check` | Make Syncy check your repos now |
| `--say "text"` | Make Catbot say something |
| `--install-shortcut` | Create or refresh the Start menu shortcut, then exit (used by `npm run install-app`) |

For example: `npx electron . --feed dusty`.

## npm scripts

| Script | What it does |
|---|---|
| `npm start` | Dev mode with hot reload |
| `npm run install-app` | Build and add GitGremlin to the Start menu |
| `npm run compile` | Build into `out/` |
| `npm run typecheck` | Type-check all code |
| `npm run textures` | Regenerate all pet art from code (`npm run textures -- syncy` for one pet, `-- icons` for just the logo) |
| `npm run docs-images` | Re-render the README images |
| `npm run build` | Build the Windows installer |

---

<sub>[← Back to GitGremlin](../README.md)</sub>
