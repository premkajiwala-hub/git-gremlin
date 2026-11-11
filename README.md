# GitGremlin

A Windows 11 desktop pet that roams your desktop and **gets hungry when you don't commit code**.

Meet **Catbot**: a blocky little robot cat with a white shell, orange ear tips and stripes, a striped cable tail, a collar bell that glows when it's well fed, and a dark face-screen whose glowing cyan eyes show how it feels (^ ^, — —, > <, x x, sad). It's built entirely in code: box parts with 16×16 pixel-art textures, rendered with three.js.

<!-- Screenshot / GIF placeholder: record Catbot on your desktop and save it as docs/screenshot.gif, then replace this comment with:
![Catbot on the desktop](docs/screenshot.gif) -->
> 📸 _Screenshot coming soon. Drop a GIF at `docs/screenshot.gif` and link it here._

## Features

- **Lives on your desktop.** By default Catbot sits just above the wallpaper: your app windows cover it and it shows wherever the desktop shows. Tick **Show on top of apps** in Settings to have it stay above everything instead.
- **Roams freely.** It walks, runs, sneaks (crawls) and hops anywhere on the screen, sits, naps, gets curious, and walks between monitors. Prefer the classic look? Set **Where it wanders** to *Only along the bottom of the screen*, and it walks on the taskbar's top edge.
- **Window hopping.** Sometimes it jumps onto the top edge of the window you're working in and walks along it. If that window moves, closes or minimises, it falls.
- **Blocky 3D pixel art.** Separate box parts on their own pivots (head, body, two ears, four legs, a five-segment tail, collar and bell), 16×16 nearest-filtered textures, flat per-face shading (top 100%, front 80%, sides 60%), an orthographic camera at a 3/4 angle.
- **Animations.** Idle look-around, blinks, ear twitches and tail sway; walking and running with diagonal leg pairs; crawling low; hopping; eating (head dips, cube crumbs); happy hops with pixel hearts; sleeping with drifting Zs; hungry droop; starving flop; dangling while dragged; squash on landing; a red flash and x x eyes when flicked hard.
- **Click-through.** The overlay ignores the mouse everywhere except over Catbot, so you can still click everything underneath it.
- **Play with it.** Hover over it and it stops and looks up at you. Click it for a status report. Drag and toss it. Wiggle your cursor near it and it may chase it.
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

**Preview page:** while `npm start` runs, open <http://localhost:5173/preview.html> in a browser for a fake desktop with buttons to feed Catbot, change its hunger stage, toggle quiet hours, move the "window" it's standing on and switch movement modes. Handy for tweaking the model or textures.

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
| Full | 0 h | Bell glows bright; explores everywhere, runs, hops onto windows, naps |
| Peckish | 2 h | Bell dims a little; the occasional "snack time?" |
| Hungry | 4 h | Head and ears droop, tail hangs, sad eyes, half walking speed, sighs, "LOW BATTERY... FEED ME COMMITS" |
| Starving | 8 h | Bell goes dark; flops on its side, twitches, now and then crawls over to the focused window's edge and taps on it |

Hunger **pauses**:

- during quiet hours (default 23:00–08:00; Catbot sleeps),
- while the PC is locked or asleep,
- while **Pause hunger** is ticked in the tray,
- while GitGremlin isn't running.

State (hunger, last commit seen per repo, pet position, settings) is saved to `%APPDATA%\GitGremlin\state.json`.

## Playing with Catbot

| Do this | Catbot does this |
|---|---|
| Hover over it | Stops what it's doing and looks up at you |
| Click it | Its terminal shows energy, mood, time since your last commit and a random line |
| Move the cursor close | Sometimes tilts its head, curious |
| Drag it | Legs dangle and swing with your mouse; the tail streams behind |
| Toss it | Hops, slides and bounces off the screen edges; may land on a window. Flick it hard for a red flash and x x eyes |
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

## Repainting Catbot

All textures are 16×16 PNGs in [`assets/textures/`](assets/textures), drawn by [`scripts/generate-textures.ts`](scripts/generate-textures.ts). Edit them in Aseprite, Piskel or any pixel editor and restart the app (or rebuild the installer).

- Every box face shows the **top-left W×H texels** of its PNG, where W×H is the face size (1 texel = 1 model unit). The body is 24 long, so its side texture repeats. [`TEXTURES.txt`](assets/textures/TEXTURES.txt) lists the visible region of each file.
- `head_front.png` is the face-screen. The `eyes_*.png` files are transparent overlays drawn on it at full brightness, so the eyes glow: `eyes_idle` (^ ^), `eyes_blink` (— —, also sleeping), `eyes_happy` (> <), `eyes_hurt` (x x), `eyes_alert` (looking at you, curious, being carried) and `eyes_sad` (hungry, starving).
- `bell_on.png` / `bell_off.png` are the collar bell when fed and when starving.
- `food.png` is the commit cube Catbot eats (and its crumbs); `heart.png` and `zzz.png` are particle sprites.
- `assets/icon.png` and `build/icon.png` are the tray and installer icons.

To regenerate the originals (this **overwrites** your edits):

```bash
npm run textures
```

Tweak the palette at the top of the script to recolour Catbot. The shapes and proportions of the parts are in [`src/renderer/pet/model.ts`](src/renderer/pet/model.ts). [`docs/catbot-reference.webp`](docs/catbot-reference.webp) is the design reference the model was drawn from.

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
- **Click-through and hover:** `setIgnoreMouseEvents(true, { forward: true })` is switched off only while the cursor is over Catbot. The cursor position is polled ~10×/s (not only on mouse moves), so hovering and clicking work even when Catbot walks under a still cursor. In desktop mode `WindowFromPoint` checks that no app window covers Catbot at the cursor.
- **Rendering:** a small pet-sized WebGL canvas moves around the overlay (not a full-screen canvas). It renders at about 30 fps, skips frames when nothing changed, drops to 10 fps when idle and stops completely when hidden. The other monitors' overlays sleep until Catbot walks over.
- **Movement:** Catbot's position is a point on the "floor" (anywhere in the work area, the taskbar's top edge in bottom-only mode, or the top edge of the window it's standing on) plus a height for jumps, falls and tosses, with gravity, bounce and friction.
- **Windows:** a small [koffi](https://koffi.dev/) FFI helper (prebuilt, no compiler) handles z-order, the focused window's bounds, whether the window Catbot stands on moved, and the taskbar auto-hide state.
- **Git:** [simple-git](https://github.com/steveukx/git-js) runs `git log --all --no-merges --shortstat` every 60 s. No network access at runtime.

```
src/main/       overlay windows, z-order, tray, git watcher, hunger, state, settings, Win32 helper
src/preload/    the IPC bridge exposed to renderers
src/renderer/   three.js scene, Catbot model/brain/animations, particles, speech bubbles, settings page, dev preview
src/shared/     config types and constants
assets/         generated textures (PNG) and tray icon
scripts/        texture generator
docs/           design reference
```

## Known limitations

- **In desktop mode, app windows hide Catbot** (that's the point). It's still out there wandering. Minimise your windows or use Show desktop (Win+D) to see it, or turn on **Show on top of apps**.
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

MIT, see [LICENSE](LICENSE). Catbot's model and textures are original to this project.
