# GitGremlin

A Windows 11 desktop pet that lives on top of your whole desktop (taskbar and app windows included) and **gets hungry when you don't commit code**.

Meet **Mossy**: a squat, original, blocky critter with a mossy-green and stone-gray body, glowing amber pixel eyes and a two-cube antenna that lights up when it's well fed. It wanders along your taskbar, hops onto the window you're working in, and eats every commit you make.

<!-- Screenshot / GIF placeholder: record Mossy on your taskbar and save it as docs/screenshot.gif, then replace this comment with:
![Mossy on the taskbar](docs/screenshot.gif) -->
> 📸 _Screenshot coming soon. Drop a GIF at `docs/screenshot.gif` and link it here._

## Features

- **Lives on your desktop.** A transparent, click-through, always-on-top overlay on every monitor. Mossy walks on the top edge of the taskbar, and you can still click everything underneath it.
- **Blocky 3D pixel art.** three.js boxes with 16×16 nearest-filtered textures, flat per-face shading (top 100%, front 80%, sides 60%), an orthographic camera at a 3/4 angle.
- **Animations.** Idle look-around, blinks and antenna wiggles; walking; eating (head dips, cube crumbs); happy hops with pixel hearts; sleeping with drifting Zs; hungry droop; starving flop; dangling while dragged; squash on landing; a red flash when flicked hard.
- **Physics and play.** Drag it, throw it (gravity, bounce, friction), click it for a speech bubble, wiggle your cursor near it and it may follow you.
- **Explores.** Sometimes hops onto the top edge of the focused window and walks along it; falls if that window moves or closes. Walks between monitors.
- **Feeds on commits.** Watches your local git repos and eats every new commit you author.

## Requirements

- Windows 10 or 11 (x64)
- [Node.js](https://nodejs.org/) 24 (23.6+ works; `npm run textures` needs built-in TypeScript type stripping)
- [Git](https://git-scm.com/) on your `PATH`

## Run it in dev mode

```bash
npm install
npm start
```

Mossy appears on the taskbar of your primary monitor and a block icon appears in the system tray. Right-click the tray icon for everything else.

> npm 11+ may block install scripts. If `npm install` says `koffi` or `electron-winstaller` scripts were blocked, run `npm install-scripts approve koffi electron-winstaller` and `npm rebuild`. (They're already listed in `allowScripts` in `package.json`.)

## Feeding: adding repos

1. Right-click the tray icon → **Add repo...** (or open **Settings...** → **Add repo...**).
2. Pick any folder inside a git repository. GitGremlin checks it's a repo and watches its top-level folder.
3. Commit as usual. Within a minute Mossy eats it: food cube, crumbs, hearts.

Only commits **you** authored count: the author email must match `git config user.email` for that repo (override it in Settings). Existing history isn't food: only commits made after the repo was added, and less than 24 hours old, count. Every branch counts (`git log --all`), and amends and rebases aren't eaten twice.

Remove repos from the tray (**Remove repo ▸**) or in Settings.

## How hunger works

Hunger is measured as "hours without food". Each new commit removes some:

| | |
|---|---|
| Base meal per commit | 3 hours |
| Big-diff bonus | +1 hour per 10× lines changed (10 lines ≈ +1h, 100 ≈ +2h), **capped at +3h** so one giant commit can't fill it up |

Stages (all configurable in Settings):

| Stage | After | What Mossy does |
|---|---|---|
| Full | 0 h | Antenna glows bright, wanders, explores windows, takes naps |
| Peckish | 2 h | Antenna dims a little, the occasional "snack time?" |
| Hungry | 4 h | Head droops, walks at half speed, sighs, "feed me commits..." |
| Starving | 8 h | Flops on its side on the taskbar, twitches, now and then crawls over to tap the focused window's edge |

Hunger **pauses**:

- during quiet hours (default 23:00–08:00; Mossy sleeps),
- while the PC is locked or asleep,
- while **Pause hunger** is ticked in the tray,
- while GitGremlin isn't running.

State (hunger, last commit seen per repo, pet position, settings) is saved to `%APPDATA%\GitGremlin\state.json`.

## Playing with Mossy

| Do this | Mossy does this |
|---|---|
| Click it | Looks at you; a bubble shows its mood, food bar, time since your last commit and a random line |
| Drag it | Legs dangle and swing with your mouse |
| Throw it | Flies, bounces off screen edges, squashes on landing. Flick hard for a red flash |
| Wiggle the cursor near it | Sometimes follows your cursor for a few seconds |

## Tray menu

Feed now (debug) · Add repo... · Remove repo ▸ · Pause hunger · Hide for 1 hour · Show pet · Settings... · Start with Windows · Quit

**Settings** covers the pet's name, size (default 80 px tall), walking speed, hunger timings, quiet hours, the git author email and watched repos.

A second launch passes flags to the running app: `--feed` (debug snack), `--say "text"`, `--settings`.

## Repainting the textures

All textures are 16×16 PNGs in [`assets/textures/`](assets/textures). Edit them in Aseprite, Piskel or any pixel editor and restart the app (or rebuild the installer).

- Every box face shows the **top-left W×H texels** of its PNG, where W×H is the face size (1 texel = 1 model unit). The body is 28 long, so its side texture repeats. [`TEXTURES.txt`](assets/textures/TEXTURES.txt) lists the visible region of each file.
- `eyes_open.png` / `eyes_closed.png` are transparent overlays drawn at full brightness on the face, so the eyes glow. Blinking swaps them.
- `antenna_tip_on.png` / `antenna_tip_off.png` are the lit and unlit antenna bulb.
- `food.png` is the commit cube Mossy eats (and its crumbs); `heart.png` and `zzz.png` are particle sprites.

To regenerate the originals (this **overwrites** your edits):

```bash
npm run textures
```

The generator is [`scripts/generate-textures.ts`](scripts/generate-textures.ts). It's seeded, so the output is stable. Tweak the palettes at the top to recolour Mossy.

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

- **One overlay window per monitor**, covering the full display bounds (not the work area) so the pet can stand on the taskbar: transparent, frameless, non-focusable, `skipTaskbar` and a tool window (not in Alt+Tab).
- **Always on top:** `setAlwaysOnTop(true, 'screen-saver')`, plus a re-assert every 1.5 s with `SetWindowPos(HWND_TOPMOST, SWP_NOACTIVATE…)`, because Windows lets the taskbar jump back on top when you click it.
- **Click-through:** `setIgnoreMouseEvents(true, { forward: true })`, switched off only while the cursor is over the pet's bounding box.
- **Rendering:** a small pet-sized WebGL canvas moves around the overlay (not a full-screen canvas). It renders at about 30 fps, skips frames when nothing changed, drops to 10 fps when idle and stops completely when hidden. The other monitors' overlays sleep until the pet walks over.
- **Ground:** the taskbar's top edge from each display's work area. With an auto-hidden taskbar (or none) the pet walks on the bottom of the screen.
- **Windows:** a small [koffi](https://koffi.dev/) FFI helper (prebuilt, no compiler) reads the focused window's bounds, the taskbar auto-hide state and the topmost z-order.
- **Git:** [simple-git](https://github.com/steveukx/git-js) runs `git log --all --no-merges --shortstat` every 60 s. No network access at runtime.

```
src/main/       overlay windows, tray, git watcher, hunger, state, settings, Win32 helper
src/preload/    the IPC bridge exposed to renderers
src/renderer/   three.js scene, pet model/brain/animations, particles, speech bubbles, settings page
src/shared/     config types and constants
assets/         textures (PNG) and tray icon
scripts/        texture generator
```

## Known limitations

- **Full-screen games and exclusive-fullscreen apps cover the pet.** So do the Start menu, notification centre, Alt+Tab and Task View: Windows draws them in z-bands above every app's "always on top" windows, and no normal app can get above them.
- After you click the taskbar it can cover the pet for up to ~1.5 s, until the next topmost re-assert.
- The overlays are 1 px shorter than each monitor, so Windows doesn't mistake them for a full-screen app (which can trigger Do Not Disturb or hide the taskbar).
- Dragging is limited to the monitor the pet is on. Throw it, or let it walk, to change monitors. On mixed-DPI setups the hop between monitors can be a little jumpy.
- Window walking uses the **focused** window only, and ignores maximized and full-screen windows (their top edge is the top of the screen).
- Hunger doesn't grow while GitGremlin is closed. Commits made while it was closed are eaten on the next start if they're less than 24 hours old.
- Watching a repo means running `git log` in it once a minute. Very large repos or network drives can make that slow.
- "Start with Windows" in dev mode starts the built app from this folder (`electron <project>`), so run `npm run compile` once after pulling changes.
- Unsigned builds are blocked on PCs with Smart App Control (see [Smart App Control](#smart-app-control)).

## License

MIT, see [LICENSE](LICENSE). The creature, textures, font and all art are original to this project.
