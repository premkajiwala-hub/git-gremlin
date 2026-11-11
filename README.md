# GitGremlin

A Windows 11 desktop pet that roams your desktop and **gets hungry when you don't commit code**.

Meet **Catbot**: a little 2D pixel-art robot cat with a white shell, orange ear tips and stripes, a striped cable tail, a collar bell that glows when it's well fed, and a dark face-screen whose glowing cyan eyes show how it feels (^ ^, — —, > <, x x, sad). Every frame is drawn in code and exported as PNGs you can repaint.

<!-- Screenshot / GIF placeholder: record Catbot on your desktop and save it as docs/screenshot.gif, then replace this comment with:
![Catbot on the desktop](docs/screenshot.gif) -->
> 📸 _Screenshot coming soon. Drop a GIF at `docs/screenshot.gif` and link it here._

## Features

- **Lives on your desktop.** By default Catbot sits just above the wallpaper: your app windows cover it and it shows wherever the desktop shows. Tick **Show on top of apps** in Settings to have it stay above everything instead.
- **Follows your cursor.** Move the mouse over the desktop and Catbot walks (or runs, if you're far away) after it. Once it reaches the cursor it stops and looks up at you. Turn this off with **Follow my cursor** in Settings.
- **Hover to read its mind.** Hover over Catbot and its message box pops up with its energy, mood and time since your last commit, for as long as you hover.
- **Roams freely.** On its own it walks, runs, sneaks (crawls) and hops anywhere on the screen, sits, naps, gets curious, and walks between monitors. Prefer the classic look? Set **Where it wanders** to *Only along the bottom of the screen*, and it walks on the taskbar's top edge.
- **Window hopping.** Sometimes it jumps onto the top edge of the window you're working in and walks along it. If that window moves, closes or minimises, it falls.
- **Pixel-art animations (2D, side view):** idle with blinks and tail sway, walk, run, crawl, sit, sleep (curled up with Zs), jump, eat (head dips, cube crumbs), happy hops with pixel hearts, hungry droop, starving flop, dangling while dragged, squash on landing, and a red flash with x x eyes when flicked hard. Always drawn in whole device pixels, so it stays crisp.
- **Click-through.** The overlay ignores the mouse everywhere except over Catbot, so you can still click everything underneath it.
- **Robot speech bubbles.** A little terminal in Catbot's colours: orange header with its name and a mood LED, a scanlined screen and cyan text that types itself out.
- **Feeds on commits.** Watches your local git repos and eats every new commit you author.

## Requirements

- Windows 10 or 11 (x64)
- [Node.js](https://nodejs.org/) 24 (23.6+ works; `npm run textures` needs Node's built-in TypeScript type stripping)
- [Git](https://git-scm.com/) on your `PATH`

## Run it in dev mode

```bash
npm install
npm start
```

Catbot appears on your desktop and a catbot icon appears in the system tray. Right-click the tray icon for everything else.

> npm 11+ may block install scripts. If `npm install` says `koffi` or `electron-winstaller` scripts were blocked, run `npm install-scripts approve koffi electron-winstaller` and `npm rebuild`. (They're already listed in `allowScripts` in `package.json`.)

While `npm start` runs, two dev pages are available in a browser:

- <http://localhost:5173/preview.html>: a fake desktop with buttons to feed Catbot, change its hunger stage, toggle quiet hours, move the "window" it's standing on and switch movement modes. Hover, click, drag and cursor-following all work there.
- <http://localhost:5173/sheet.html?k=6>: every animation frame, enlarged (`k` = zoom), with its eyes and bell.

## Feeding: adding repos

1. Right-click the tray icon → **Add repo...** (or open **Settings...** → **Add repo...**).
2. Pick any folder inside a git repository. GitGremlin checks it's a repo and watches its top-level folder.
3. Commit as usual. Within a minute Catbot eats it: a golden commit cube appears, its head dips, crumbs fly, then it does a happy hop with hearts.

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
| Full | 0 h | Bell glows; explores everywhere, runs, hops onto windows, naps |
| Peckish | 2 h | The occasional "snack time?" |
| Hungry | 4 h | Bell goes dark, sprite dims, head and ears droop, tail hangs, sad eyes, half walking speed, "LOW BATTERY... FEED ME COMMITS" |
| Starving | 8 h | Flops over on the floor, twitches, now and then crawls over to the focused window's edge and taps on it |

Hunger **pauses**:

- during quiet hours (default 23:00–08:00; Catbot sleeps),
- while the PC is locked or asleep,
- while **Pause hunger** is ticked in the tray,
- while GitGremlin isn't running.

State (hunger, last commit seen per repo, pet position, settings) is saved to `%APPDATA%\GitGremlin\state.json`.

## Playing with Catbot

| Do this | Catbot does this |
|---|---|
| Move the cursor over the desktop | Follows it, and stops once it reaches the cursor |
| Hover over it | Stops, faces you and shows its message box (energy, mood, last commit, a random line) until you move away |
| Click it | Looks up alert and shows the message box again with a fresh line |
| Drag it | Legs dangle, tail hangs |
| Toss it | Hops, slides and bounces off the screen edges; may land on a window. Flick it hard for a red flash and x x eyes |

## Settings

Tray → **Settings...**

| Setting | What it does | Default |
|---|---|---|
| Name | Shown in the speech bubble header and the tray | Catbot |
| Size | Catbot's height on screen (48–112 px). It snaps to the nearest crisp whole-pixel scale | 72 px |
| Walking speed | Running is ~2.4×, crawling ~0.45× | 45 px/s |
| Where it wanders | Anywhere on the screen, or only along the bottom (the taskbar's top edge) | Anywhere |
| Follow my cursor | Walks after the cursor while you move it over the desktop | On |
| Show on top of apps | Off: lives on the desktop, behind your windows. On: above every app and the taskbar | Off |
| Peckish / Hungry / Starving | Hours without commits before each stage | 2 / 4 / 8 h |
| Quiet hours | Hunger pauses and Catbot sleeps | On, 23:00–08:00 |
| Author email | Whose commits count; empty = each repo's `git config user.email` | (empty) |
| Watched repos | Add / remove repos (applies immediately) | none |
| Start with Windows | Launch at sign-in | Off |

Tray menu: Feed now (debug) · Add repo... · Remove repo ▸ · Pause hunger · Hide for 1 hour · Show pet · Settings... · Start with Windows · Quit

A second launch passes flags to the running app: `--feed` (debug snack), `--say "text"`, `--settings`.

## Repainting Catbot

[`scripts/generate-textures.ts`](scripts/generate-textures.ts) draws Catbot in code (a little puppet: head with face-screen, ears, body, four legs, a segmented tail, collar and bell, posed per frame) and writes:

| File | What it is |
|---|---|
| `assets/catbot/<animation>-<n>.png` | 50×38 side-view frames, facing right (mirrored at runtime for left): `idle`, `idle_sad`, `walk`, `walk_sad`, `run`, `crawl`, `sit`, `sleep`, `starving`, `jump_up`, `jump_down`, `dragged`, `eat`, `happy`, `hurt`, `tap`, `curious` |
| `assets/catbot/eyes_*.png` | 8×6 face-screen expressions drawn over each frame at full brightness: `idle` (^ ^), `blink` (— —, also sleeping), `happy` (> <), `hurt` (x x), `alert` (looking at you), `sad` |
| `assets/catbot/bell_on.png` | The lit collar bell, drawn over the frame while Catbot is fed |
| `assets/catbot/frames.json` | Frame lists, frame rates, the feet anchor, and where the screen and bell sit in each frame |
| `assets/textures/food.png`, `heart.png`, `zzz.png` | The commit cube (and its crumbs), hearts and Zs |
| `assets/icon.png`, `build/icon.png` | Tray and installer icons |

Edit any PNG in Aseprite, Piskel or another pixel editor and restart the app (or rebuild the installer). If you move the face-screen or bell in a frame, update its `screen` / `bell` position in `frames.json`. To regenerate everything from code (this **overwrites** your edits):

```bash
npm run textures
```

Tweak the palette, the part shapes in `drawHead` / `drawBody` / `drawLeg` / `drawTail`, or the poses in `ANIMS` at the top of the script. [`docs/catbot-reference.webp`](docs/catbot-reference.webp) is the design reference Catbot was drawn from.

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
- **Cursor, hover and click-through:** `setIgnoreMouseEvents(true, { forward: true })` is switched off only while the cursor is over Catbot. The cursor position is also polled ~10×/s, so hover and following work even when Catbot walks under a still cursor. In desktop mode `WindowFromPoint` checks that no app window covers the spot, so Catbot only follows or reacts to a cursor that's actually over the desktop.
- **Rendering:** a small pet-sized 2D canvas moves around the overlay (not a full-screen canvas). Frames are scaled by a whole number of device pixels, so they stay crisp at any Windows scaling. It renders at about 30 fps, skips frames when nothing changed, drops to 10 fps when idle and stops completely when hidden. The other monitors' overlays sleep until Catbot walks over.
- **Movement:** Catbot's position is a point on the "floor" (anywhere in the work area, the taskbar's top edge in bottom-only mode, or the top edge of the window it's standing on) plus a height for jumps, falls and tosses, with gravity, bounce and friction.
- **Windows:** a small [koffi](https://koffi.dev/) FFI helper (prebuilt, no compiler) handles z-order, the focused window's bounds, whether the window Catbot stands on moved, and the taskbar auto-hide state.
- **Git:** [simple-git](https://github.com/steveukx/git-js) runs `git log --all --no-merges --shortstat` every 60 s. No network access at runtime.

```
src/main/       overlay windows, z-order, tray, git watcher, hunger, state, settings, Win32 helper
src/preload/    the IPC bridge exposed to renderers
src/renderer/   2D sprite view, Catbot brain (movement/behaviour), particles, speech bubbles, settings page, dev pages
src/shared/     config types and constants
assets/         generated Catbot frames, particles and tray icon
scripts/        Catbot/texture generator
docs/           design reference
```

## Known limitations

- **In desktop mode, app windows hide Catbot** (that's the point), and it only follows the cursor while the cursor is over the visible desktop. Minimise your windows or use Show desktop (Win+D) to play, or turn on **Show on top of apps**.
- **Full-screen games and exclusive-fullscreen apps cover it even in on-top mode.** So do the Start menu, notification centre, Alt+Tab and Task View: Windows draws them in z-bands above every app's "always on top" windows.
- In on-top mode, after you click the taskbar it can cover Catbot for up to ~1.5 s, until the next re-assert.
- In desktop mode the taskbar covers the bottom of the screen, so Catbot stays inside the work area.
- Window hopping uses the **focused** window only, and skips maximised and full-screen windows (their top edge is the top of the screen).
- Dragging is limited to the monitor Catbot is on. Toss it, or let it walk, to change monitors. On mixed-DPI setups the hop between monitors can be a little jumpy.
- The overlays are 1 px shorter than each monitor, so Windows doesn't mistake them for a full-screen app (which can trigger Do Not Disturb or hide the taskbar).
- Hunger doesn't grow while GitGremlin is closed. Commits made while it was closed are eaten on the next start if they're less than 24 hours old.
- Watching a repo means running `git log` in it once a minute. Very large repos or network drives can make that slow.
- "Start with Windows" in dev mode starts the built app from this folder (`electron <project>`), so run `npm run compile` once after pulling changes.
- Unsigned builds are blocked on PCs with Smart App Control (see [Smart App Control](#smart-app-control)).

## License

MIT, see [LICENSE](LICENSE). Catbot's art is original to this project, drawn in code.
