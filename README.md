# GitGremlin

A Windows 11 desktop pet that roams your desktop and **gets hungry when you don't commit code**.

Meet **Catbot**: a little white robot cat with orange ears, a striped cable tail and a dark face-screen with glowing cyan eyes. It wanders, runs, sneaks and hops around your desktop, naps, gets curious about your cursor, and eats every commit you make.

<!-- Screenshot / GIF placeholder: record Catbot on your desktop and save it as docs/screenshot.gif, then replace this comment with:
![Catbot on the desktop](docs/screenshot.gif) -->
> 📸 _Screenshot coming soon. Drop a GIF at `docs/screenshot.gif` and link it here._

## Features

- **Lives on your desktop.** By default Catbot sits just above the wallpaper: your app windows cover it and it shows wherever the desktop shows. Tick **Show on top of apps** in Settings to have it stay above everything instead.
- **Roams freely.** It walks, runs, crawls (sneaks) and hops to random spots anywhere on the screen, and walks between monitors. Prefer the classic look? Set **Where it wanders** to *Only along the bottom of the screen*.
- **Sprite animations** from the catbot sheet: idle, walk left/right, sit, sleep (with Zs), jump, curious ("!" / "?"), happy (">\<" and sparkles) and hurt ("x x").
- **Click-through.** The overlay ignores the mouse everywhere except over Catbot, so you can still click everything underneath it.
- **Play with it.** Drag it, toss it (it hops, slides and bounces off screen edges), click it for a status report, wiggle your cursor near it and it may chase it.
- **Robot speech bubbles.** A little terminal in Catbot's colours: orange header with its name and a mood LED, a scanlined screen and cyan text that types itself out.
- **Feeds on commits.** Watches your local git repos and eats every new commit you author.

## Requirements

- Windows 10 or 11 (x64)
- [Node.js](https://nodejs.org/) 24 (23.6+ works; the asset scripts need Node's built-in TypeScript type stripping)
- [Git](https://git-scm.com/) on your `PATH`

## Run it in dev mode

```bash
npm install
npm start
```

Catbot appears on your desktop and a catbot icon appears in the system tray. Right-click the tray icon for everything else.

> npm 11+ may block install scripts. If `npm install` says `koffi` or `electron-winstaller` scripts were blocked, run `npm install-scripts approve koffi electron-winstaller` and `npm rebuild`. (They're already listed in `allowScripts` in `package.json`.)

## Feeding: adding repos

1. Right-click the tray icon → **Add repo...** (or open **Settings...** → **Add repo...**).
2. Pick any folder inside a git repository. GitGremlin checks it's a repo and watches its top-level folder.
3. Commit as usual. Within a minute Catbot eats it: it sits down with a golden commit cube, crumbs fly, then it does a happy dance.

Only commits **you** authored count: the author email must match `git config user.email` for that repo (override it in Settings). Existing history isn't food: only commits made after the repo was added, and less than 24 hours old, count. Every branch counts (`git log --all`), and amends and rebases aren't eaten twice.

Remove repos from the tray (**Remove repo ▸**) or in Settings.

## How hunger works

Catbot's "energy" is measured as hours without food. Each new commit removes some:

| | |
|---|---|
| Base meal per commit | 3 hours |
| Big-diff bonus | +1 hour per 10× lines changed (10 lines ≈ +1h, 100 ≈ +2h), **capped at +3h** so one giant commit can't fill it up |

Stages (all configurable in Settings):

| Stage | After | What Catbot does |
|---|---|---|
| Full | 0 h | Explores everywhere, runs, hops, gets curious, takes naps |
| Peckish | 2 h | Calmer; the occasional "snack time?" |
| Hungry | 4 h | Dimmed and desaturated, walks at half speed, sits a lot, "LOW BATTERY... FEED ME COMMITS" |
| Starving | 8 h | Lies flat with a dim screen, twitches, now and then crawls over to the focused window's edge and taps on it |

Hunger **pauses**:

- during quiet hours (default 23:00–08:00; Catbot sleeps),
- while the PC is locked or asleep,
- while **Pause hunger** is ticked in the tray,
- while GitGremlin isn't running.

State (hunger, last commit seen per repo, pet position, settings) is saved to `%APPDATA%\GitGremlin\state.json`.

## Playing with Catbot

| Do this | Catbot does this |
|---|---|
| Click it | Gets curious; its terminal shows energy, mood, time since your last commit and a random line |
| Move the cursor close | Sometimes turns to you with a "!" / "?" |
| Drag it | Dangles and sways with your mouse |
| Toss it | Hops, slides and bounces off the screen edges. Flick it hard for a red flash and an "x x" face |
| Wiggle the cursor near it | Sometimes chases your cursor for a few seconds |

## Settings

Tray → **Settings...**

| Setting | What it does | Default |
|---|---|---|
| Name | Shown in the speech bubble header and the tray | Catbot |
| Size | Catbot's height on screen (48–112 px, so it never gets too tiny or in the way) | 72 px |
| Walking speed | Running is ~2.4×, crawling ~0.45× | 45 px/s |
| Where it wanders | Anywhere on the screen, or only along the bottom (the taskbar's top edge) | Anywhere |
| Show on top of apps | Off: lives on the desktop, behind your windows. On: above every app and the taskbar | Off |
| Peckish / Hungry / Starving | Hours without commits before each stage | 2 / 4 / 8 h |
| Quiet hours | Hunger pauses and Catbot sleeps | On, 23:00–08:00 |
| Author email | Whose commits count; empty = each repo's `git config user.email` | (empty) |
| Watched repos | Add / remove repos (applies immediately) | none |
| Start with Windows | Launch at sign-in | Off |

Tray menu: Feed now (debug) · Add repo... · Remove repo ▸ · Pause hunger · Hide for 1 hour · Show pet · Settings... · Start with Windows · Quit

A second launch passes flags to the running app: `--feed` (debug snack), `--say "text"`, `--settings`.

## The art

Catbot's animations come from one sprite sheet, [`art/catbot-sheet.webp`](art/catbot-sheet.webp). [`scripts/slice-catbot.ts`](scripts/slice-catbot.ts) cuts it into aligned frames:

```bash
npm run sprites
```

- Frames land in [`assets/catbot/`](assets/catbot) as `<animation>-<n>.png`, all the same size, with feet on a shared ground line and the face-screen lined up so the body doesn't jitter. `frames.json` lists each animation's frames, frame rate and the anchor point.
- It also writes the tray icon (`assets/icon.png`) and installer icon (`build/icon.png`) from the catbot's head.
- The sheet must keep the same layout: three rows. Row 1: idle (4), walk right (6). Row 2: walk left (5), sit (4), sleep (4). Row 3: jump (5), curious (4), happy (3), hurt (2). The background must be transparent. Label pills are detected and dropped automatically.
- To tweak a single frame, edit its PNG in `assets/catbot/` directly (re-running the slicer overwrites them).

[`scripts/generate-textures.ts`](scripts/generate-textures.ts) (`npm run textures`) draws the two small extras: the golden commit cube (`food.png`, also used for crumbs) and the heart (`heart.png`).

## Build the installer

```bash
npm run build
```

This typechecks, bundles with electron-vite and runs electron-builder. The NSIS installer lands in `dist/GitGremlin-Setup-<version>.exe`. The first build downloads Electron and NSIS for electron-builder.

Every push to `main` also builds the installer on GitHub Actions ([`.github/workflows/build.yml`](.github/workflows/build.yml)). Download it from the run's **GitGremlin-Setup** artifact on the repo's **Actions** tab.

### Smart App Control

On PCs with Windows 11 **Smart App Control** turned on, the local build fails at the end with `spawn UNKNOWN`. electron-builder has to run the freshly built, unsigned installer stub to generate the uninstaller, and Smart App Control blocks it (you'll see "Smart App Control Block" in Event Viewer → Applications and Services Logs → Microsoft → Windows → CodeIntegrity → Operational). For the same reason, Smart App Control blocks any unsigned GitGremlin installer or `GitGremlin.exe` there, wherever it was built.

Your options:

- **Run it from source**: `npm start`. Dev mode runs the signed Electron binary, and **Start with Windows** works there too.
- **Build in CI**: use the GitHub Actions artifact on a PC without Smart App Control.
- **Code-sign the build** with a trusted certificate (see electron-builder's `win.signtoolOptions`).
- Turn Smart App Control off (Windows Security → App & browser control). Windows can't turn it back on without a reset, so this isn't recommended just for a desktop pet.

## How it works

- **One overlay window per monitor**, covering the full display: transparent, frameless, non-focusable, `skipTaskbar` and a tool window (not in Alt+Tab).
- **Layering:** in desktop mode the overlays are kept directly above the desktop window (`SetWindowPos(HWND_BOTTOM)`; Windows keeps the desktop itself pinned at the very bottom), re-checked every 0.6 s and following the desktop up when you use Show desktop (Win+D). In on-top mode they use `setAlwaysOnTop(true, 'screen-saver')` plus a `SetWindowPos(HWND_TOPMOST)` re-assert every 1.5 s, because Windows lets the taskbar jump back on top when you click it.
- **Click-through:** `setIgnoreMouseEvents(true, { forward: true })`, switched off only while the cursor is over Catbot.
- **Rendering:** a small pet-sized 2D canvas moves around the overlay (not a full-screen canvas). It draws at about 30 fps, skips frames when nothing changed, drops to 10 fps when idle and stops completely when hidden. The other monitors' overlays sleep until Catbot walks over.
- **Movement:** Catbot's position is a point on the "floor" (anywhere in the work area, or the taskbar's top edge in bottom-only mode) plus a height for hops and tosses, with gravity, bounce and friction.
- **Windows:** a small [koffi](https://koffi.dev/) FFI helper (prebuilt, no compiler) handles z-order, the focused window's bounds and the taskbar auto-hide state.
- **Git:** [simple-git](https://github.com/steveukx/git-js) runs `git log --all --no-merges --shortstat` every 60 s. No network access at runtime.

```
src/main/       overlay windows, z-order, tray, git watcher, hunger, state, settings, Win32 helper
src/preload/    the IPC bridge exposed to renderers
src/renderer/   sprite renderer, catbot brain (movement/behaviour), particles, speech bubbles, settings page
src/shared/     config types and constants
art/            the source sprite sheet
assets/         sliced catbot frames, particle sprites, tray icon
scripts/        sprite slicer and particle generator
```

## Known limitations

- **In desktop mode, app windows hide Catbot** (that's the point). It's still out there wandering. Minimise your windows or use Show desktop (Win+D) to see it, or turn on **Show on top of apps**.
- **Full-screen games and exclusive-fullscreen apps cover it even in on-top mode.** So do the Start menu, notification centre, Alt+Tab and Task View: Windows draws them in z-bands above every app's "always on top" windows.
- In on-top mode, after you click the taskbar it can cover Catbot for up to ~1.5 s, until the next re-assert.
- In desktop mode the taskbar covers the bottom of the screen, so Catbot stays inside the work area.
- The cursor's position is tracked even when an app window covers Catbot, so it may react to a cursor it can't "see".
- Dragging is limited to the monitor Catbot is on. Toss it, or let it walk, to change monitors. On mixed-DPI setups the hop between monitors can be a little jumpy.
- The overlays are 1 px shorter than each monitor, so Windows doesn't mistake them for a full-screen app (which can trigger Do Not Disturb or hide the taskbar).
- Hunger doesn't grow while GitGremlin is closed. Commits made while it was closed are eaten on the next start if they're less than 24 hours old.
- Watching a repo means running `git log` in it once a minute. Very large repos or network drives can make that slow.
- "Start with Windows" in dev mode starts the built app from this folder (`electron <project>`), so run `npm run compile` once after pulling changes.
- Unsigned builds are blocked on PCs with Smart App Control (see [Smart App Control](#smart-app-control)).

## License

MIT, see [LICENSE](LICENSE). The catbot sprite sheet was provided by the project owner for this project.
