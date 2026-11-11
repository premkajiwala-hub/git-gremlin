# GitGremlin

A Windows 11 desktop pet that roams your desktop and **gets hungry on days you haven't contributed on GitHub**.

Meet **Catbot**: a little 2D pixel-art robot cat with a white shell, orange ear tips and stripes, a striped cable tail, a collar bell that glows when it's well fed, and a dark face-screen whose glowing cyan eyes show how it feels (^ ^, — —, > <, x x, sad). Every frame is drawn in code and exported as PNGs you can repaint.

<!-- Screenshot / GIF placeholder: record Catbot on your desktop and save it as docs/screenshot.gif, then replace this comment with:
![Catbot on the desktop](docs/screenshot.gif) -->
> 📸 _Screenshot coming soon. Drop a GIF at `docs/screenshot.gif` and link it here._

## Features

- **Lives on your desktop.** By default Catbot sits just above the wallpaper: your app windows cover it and it shows wherever the desktop shows. Tick **Show on top of apps** in Settings to have it stay above everything instead.
- **Follows your cursor.** Move the mouse over the desktop and Catbot walks (or runs, if you're far away) after it. Once it reaches the cursor it stops and looks up at you. Turn this off with **Follow my cursor** in Settings.
- **Hover to read its mind.** Hover over Catbot and its message box pops up with today's contributions, its mood, your streak and the last 7 days as green squares, for as long as you hover.
- **Roams freely.** On its own it walks, runs, sneaks (crawls) and hops anywhere on the screen, sits, naps, gets curious, and walks between monitors. Prefer the classic look? Set **Where it wanders** to *Only along the bottom of the screen*, and it walks on the taskbar's top edge.
- **Window hopping.** Sometimes it jumps onto the top edge of the window you're working in and walks along it. If that window moves, closes or minimises, it falls.
- **Pixel-art animations (2D, side view):** idle with blinks and tail sway, walk, run, crawl, sit, jump, eat (head dips, cube crumbs), happy hops with pixel hearts, hungry droop, starving flop, dangling while dragged, squash on landing, and a red flash with x x eyes when flicked hard. Always drawn in whole device pixels, so it stays crisp.
- **Click-through.** The overlay ignores the mouse everywhere except over Catbot, so you can still click everything underneath it.
- **Robot speech bubbles.** A little terminal in Catbot's colours: orange header with its name and a mood LED, a scanlined screen and cyan text that types itself out.
- **Linked to your GitHub account.** Its mood follows today's square on your GitHub contribution chart: no contributions today = hungry, and the greener the square, the happier and livelier it gets. New contributions feed it.

## Requirements

- Windows 10 or 11 (x64)
- [Node.js](https://nodejs.org/) 24 (23.6+ works; `npm run textures` needs Node's built-in TypeScript type stripping)
- A GitHub account

## Run it in dev mode

```bash
npm install
npm start
```

Catbot appears on your desktop and a catbot icon appears in the system tray. Right-click the tray icon for everything else.

> npm 11+ may block install scripts. If `npm install` says `koffi` or `electron-winstaller` scripts were blocked, run `npm install-scripts approve koffi electron-winstaller` and `npm rebuild`. (They're already listed in `allowScripts` in `package.json`.)

While `npm start` runs, two dev pages are available in a browser:

- <http://localhost:5173/preview.html>: a fake desktop with buttons to feed Catbot, set today's contribution level (starving, 0, 1 "Less" … 4 "More"), toggle the not-linked state, move the "window" it's standing on and switch movement modes. Hover, click, drag and cursor-following all work there.
- <http://localhost:5173/sheet.html?k=6>: every animation frame, enlarged (`k` = zoom), with its eyes and bell.

## Linking your GitHub account

Catbot reads your **GitHub contribution chart**, the green squares on your profile, and today's square sets its mood. It isn't tied to any one repo: every commit, PR, issue and review that counts on your profile counts for Catbot.

Linking always goes through GitHub's own sign-in:

1. Tray → **Settings...** → GitHub → **Sign in with GitHub**.
2. GitGremlin shows a one-time code (already copied to your clipboard) and opens <https://github.com/login/device>.
3. Paste the code on GitHub and approve **GitGremlin**. It asks only for `read:user`: read-only access to your profile.
4. Settings switches to your avatar, name and @username, and Catbot says hello.

This is GitHub's OAuth **device flow**, the same one the GitHub CLI and VS Code use. Your password never touches the app, and the resulting token is stored encrypted on your PC (Windows DPAPI via Electron `safeStorage`). **Sign out** in Settings forgets it. To revoke access completely, remove GitGremlin under GitHub → Settings → Applications → *Authorized OAuth Apps*.

Already signed in with the [GitHub CLI](https://cli.github.com/) (`gh auth login`)? Settings also offers **Use my GitHub CLI login instead**. That uses gh's GitHub-authenticated login, and only when you choose it.

Nothing is linked until you do one of these; there's no "type a username" mode.

> **For forks / your own builds:** sign-in uses GitGremlin's GitHub OAuth App (Client ID in `src/shared/constants.ts`, a public identifier, not a secret). To use your own, register an OAuth App at GitHub → Settings → Developer settings → OAuth Apps with **Enable Device Flow** ticked and token expiry off, then set `GITHUB_CLIENT_ID` (or the `GITGREMLIN_GITHUB_CLIENT_ID` environment variable).

The chart is re-read every 3 minutes, when your PC wakes or unlocks, and from **Refresh GitHub now** in the tray. When today's count goes up, Catbot eats: a golden commit cube appears, its head dips, crumbs fly, "+N CONTRIBUTIONS", then a happy hop with hearts.

## How Catbot's mood works

It follows today's square on your chart, exactly like GitHub's *Less → More* scale:

| Today on your chart | Mood | What Catbot does |
|---|---|---|
| ⬛ 0 contributions | **Hungry** | Dimmed, sad eyes, ears and tail droop, half speed, sits a lot, "NO CONTRIBUTIONS TODAY... FEED ME COMMITS" |
| ⬛ 0 today **and** yesterday | **Starving** | Flops over, twitches, bell dark; now and then crawls to the focused window and taps on it |
| 🟩 level 1 ("Less") | Fed, calm | ^ ^ eyes, bell lit, unhurried walk, plenty of sitting |
| 🟩 level 2 | Fed, content | Normal speed; wanders, runs now and then, hops onto windows |
| 🟩 level 3 | Happy | Faster, springy walk, more running and hopping, beams > < half the time, little happy dances |
| 🟩 level 4 ("More") | Ecstatic | Fastest, zoomies, lots of hops and dances, beaming > < all the time |

The levels are GitHub's own (they're relative to your usual activity), so Catbot matches the colour you see on your profile. "Today" is your PC's local date; if GitHub's calendar hasn't reached that date yet, its latest day is used. A new day starts hungry until you contribute again.

State (last chart data, pet position, settings, encrypted token) is saved to `%APPDATA%\GitGremlin\state.json`.
## Playing with Catbot

| Do this | Catbot does this |
|---|---|
| Move the cursor over the desktop | Follows it, and stops once it reaches the cursor |
| Hover over it | Stops, faces you and shows its message box (today's contributions, mood, streak, last 7 days, a random line) until you move away |
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
| GitHub | **Sign in with GitHub** (or use your GitHub CLI login); shows the linked account, last 7 days, today's count and streak; **Refresh now**, **Sign out** | not linked |
| Start with Windows | Launch at sign-in | Off |

Catbot is awake the whole time the app runs: there are no sleep hours. Quit from the tray to stop it.

Tray menu: Refresh GitHub now · Feed now (debug) · Hide for 1 hour · Show pet · Settings... · Start with Windows · Quit

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
- **GitHub:** the contribution calendar comes from the GitHub GraphQL API (`viewer.contributionsCollection.contributionCalendar`), using the token from **Sign in with GitHub** or, if you chose it, the GitHub CLI's login. It's polled every 3 minutes. This is the only network access the app makes.

```
src/main/       overlay windows, z-order, tray, GitHub contributions + mood, state, settings, Win32 helper
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
- GitHub can take a few minutes to show a pushed commit on your chart, and only contributions GitHub counts appear there (for example, commits to a fork's default branch or with an email not linked to your account don't count). Commits you haven't pushed don't feed Catbot.
- Offline, Catbot keeps the mood from the last successful check until it can refresh.
- "Start with Windows" in dev mode starts the built app from this folder (`electron <project>`), so run `npm run compile` once after pulling changes.
- Unsigned builds are blocked on PCs with Smart App Control (see [Smart App Control](#smart-app-control)).

## License

MIT, see [LICENSE](LICENSE). Catbot's art is original to this project, drawn in code.
