# GitGremlin

A Windows 11 desktop pet. **Mossy**, an original blocky little critter, lives on top of your whole desktop (taskbar and app windows included) and gets hungry when you don't commit code.

> Work in progress. Milestone 1 (desktop overlay with a placeholder cube) is done.

## Run it (dev)

```bash
npm install
npm start
```

Quit from the tray icon (right-click → Quit).

## How the overlay works

- One transparent, frameless, click-through window per monitor, covering the full display bounds (not just the work area), so the pet can stand on the taskbar.
- Windows lets the taskbar jump above other always-on-top windows when you click it, so GitGremlin pushes its overlays back to the top of the topmost band every 1.5 s (`SetWindowPos(HWND_TOPMOST)` via a tiny koffi FFI helper, no native compiler needed).
- The windows ignore the mouse everywhere except over the pet (`setIgnoreMouseEvents(true, { forward: true })` is toggled off while the cursor is over the pet).
- Overlays are tool windows: no taskbar button, not in Alt+Tab.

## License

MIT, see [LICENSE](LICENSE).
