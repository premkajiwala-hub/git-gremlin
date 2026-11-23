<sub>[← Rex](rex.md) · **Pelican** · [Back to GitGremlin](../../README.md)</sub>

<p align="center">
  <img src="../../assets/pets/pelican/portrait.png" alt="Pelican's head: a white pelican with a long yellow bill and an orange pouch" width="96" />
</p>

<h1 align="center">Pelican</h1>

<p align="center"><b>A pelican that opens the sites you build on your phone.</b><br />Start your dev server, scan Pelican's QR code with your phone, and see how your site looks on a small screen. No typing addresses.</p>

<p align="center">
  <img src="../images/pelican-poses.png" alt="Pelican's poses: standing, walking, looking up, gulping a fish, happy with hearts, fishing around, sitting and asleep" width="100%" />
  <br /><sub>Idle · walk · curious · gulping a fish · happy · fishing around · sitting · asleep</sub>
</p>

## At a glance

| | |
|---|---|
| **Species** | White pelican: black wingtips, a grey crest, a long yellow bill and a big orange pouch |
| **Job** | Gives every dev server on your PC a QR code, so your phone opens it in one scan |
| **Feeds on** | Fish |
| **Needs** | Your phone on the same Wi-Fi as your PC. Nothing to install on the phone |
| **Panel page** | GitGremlin panel → **Pelican** |

## Why

On your PC your site lives at `localhost:5173`. "localhost" means *this computer*, so your phone can't open that address. It needs your PC's address on the Wi-Fi, something like `http://192.168.1.5:5173`, which you'd have to look up and type into the phone by hand. Pelican does that part for you.

## How to use it

1. Start your project as usual (`npm run dev`, `python manage.py runserver`...). Mole spots it, and Pelican says `PORTFOLIO :5173 IS UP. WANT IT ON YOUR PHONE?`
2. **Right-click Pelican → Open portfolio :5173 on my phone**, or open Pelican's page in the panel. A QR code is waiting.
3. **Point your phone's camera at the QR code** and open the link. Your site opens on your phone.

Pelican's page lists every dev server, one row per port, each with **QR code** and **Copy link**.

## "Only this PC can open it"

Many dev tools only let the PC itself open the site by default. Pelican checks every port over your Wi-Fi address, and when one only answers on this PC, it shows the fix for your tool:

| Tool | Start it with |
|---|---|
| Vite, Astro, Nuxt | `npm run dev -- --host` |
| Next.js | `npm run dev -- -H 0.0.0.0` |
| Create React App | `HOST=0.0.0.0` before `npm start` |
| Angular | `ng serve --host 0.0.0.0` |
| Django | `python manage.py runserver 0.0.0.0:8000` |
| Flask | `flask run --host=0.0.0.0` |

Restart the server that way and the row turns to **your phone can open it**, with its QR code.

## If your phone can't open it

| What you see | What to do |
|---|---|
| The page never loads | Make sure the phone is on the **same Wi-Fi** as the PC (not mobile data, not a guest network). |
| Windows asked about network access for Node or Python | Click **Allow**. That's your dev server asking to be reachable on your Wi-Fi. |
| Still nothing | Your Wi-Fi may be set to **Public** in Windows, which blocks it. Set it to **Private**: **Settings → Network & internet → Wi-Fi → your network → Private network**. |
| Office, school or café Wi-Fi | Some networks stop devices from reaching each other. Use your home Wi-Fi or your phone's hotspot. |

## Privacy

Pelican doesn't send anything anywhere. It only reads which dev servers are running (from Mole) and this PC's Wi-Fi address, then draws the QR code. Your phone talks straight to your dev server, as it would if you typed the address yourself.

## Settings

GitGremlin panel → **Pelican**:

| Setting | What it does | Default |
|---|---|---|
| **On desktop** | Shows or hides Pelican | On |
| **Name**, **Size**, **Walking speed**, **Where it wanders**, **Follow my cursor** | Look and movement, as for every pet | Pelican, 64 px, 48 px/s, anywhere, off |

Tray → **Pelican** also has **Open my sites on my phone...**.

## Art and animations

Pelican is drawn entirely in code, in [`scripts/art/pelican.ts`](../../scripts/art/pelican.ts), and exported to [`assets/pets/pelican/`](../../assets/pets/pelican/):

| Animation | Used for |
|---|---|
| `idle`, `idle_sad` | Standing, bill level (or drooping) |
| `walk`, `walk_sad`, `run`, `crawl` | Waddling around on orange webbed feet |
| `eat`, `happy` | Gulping a fish (bill up, pouch bulging), then wings up |
| `rummage` | Bill down, fishing around |
| `wash` | Preening its chest feathers |
| `sit`, `sleep`, `curious` | Resting on its belly, asleep with its head tucked low, and looking up at your cursor |
| `jump_up`, `jump_down`, `dragged`, `hurt` | Hops, falls, being carried and being flicked hard |
| `starving`, `tap` | Shared with every pet (Pelican never starves) |

To regenerate just Pelican's art, run `npm run textures -- pelican`.

## Limitations

- **Same Wi-Fi only.** Your phone reaches your PC over the local network, not over the internet.
- **Dev servers Mole sees.** Pelican lists the dev servers Mole finds, so Mole needs to be running (it's on by default).
