<sub>[← Rex](rex.md) · **Pelican** · [Back to GitGremlin](../../README.md)</sub>

<p align="center">
  <img src="../../assets/pets/pelican/portrait.png" alt="Pelican's head: a white pelican with a long yellow bill and an orange pouch" width="96" />
</p>

<h1 align="center">Pelican</h1>

<p align="center"><b>A pelican that carries files from your PC to your phone.</b><br />Drop files on it, scan its QR code with your phone, and they download. No cable, no app, no account.</p>

<p align="center">
  <img src="../images/pelican-poses.png" alt="Pelican's poses: standing, walking, gulping a file, holding files in its mouth, happy with hearts, sorting its pouch, sitting and asleep" width="100%" />
  <br /><sub>Idle · walk · gulping a file · files in its mouth · happy · sorting its pouch · sitting · asleep</sub>
</p>

## At a glance

| | |
|---|---|
| **Species** | White pelican: black wingtips, a grey crest, a long yellow bill and a big orange pouch |
| **Job** | Sends files from your PC to your phone over your Wi-Fi, and opens your dev sites on your phone |
| **Feeds on** | Files: it gulps them into its pouch |
| **Needs** | Your phone on the same Wi-Fi as your PC. Nothing to install on the phone |
| **Panel page** | GitGremlin panel → **Pelican** |

## Contents

- [Sending files to your phone](#sending-files-to-your-phone)
- [On the phone](#on-the-phone)
- [The QR code works once](#the-qr-code-works-once)
- [Your sites on your phone](#your-sites-on-your-phone)
- [Safety and privacy](#safety-and-privacy)
- [If your phone can't open it](#if-your-phone-cant-open-it)
- [Settings](#settings)
- [Art and animations](#art-and-animations)
- [Limitations](#limitations)

## Sending files to your phone

1. **Drop files on Pelican** on your desktop: photos, PDFs, videos, anything. Drop as many as you like, even whole folders. Pelican gulps them into its pouch, and you'll see them sticking out of its mouth.
   You can also open the panel's **Pelican** page and drop them there, or click **Add files**.
2. **Click Pelican**: its page opens. Click **Show QR code**. (Or right-click Pelican → **Show QR code**, which opens the page with the code already showing.)
3. **Point your phone's camera at the QR code** and open the link.
4. On the phone, tap **Download all**. Every file comes in one ZIP. Or tap **Download** next to a single file.

When the phone has everything, Pelican says `DELIVERED!`, empties its pouch and switches the QR code off.

Changed your mind about a file? On Pelican's page, click **Remove** next to it, or **Empty pouch** to start over.

## On the phone

The page shows where the files come from (your PC's name), then:

- **Download all**, with how many files and how big they are together. They come as one ZIP. On iPhone it lands in the Files app, where a tap unzips it. On Android it goes to Downloads. Folders you dropped are kept inside the ZIP.
- Each file with its own **Download** button, if you only want some.
- A line that shows how far the download has got, then **All done!**

## The QR code works once

- **Only one phone:** the first phone that opens the link gets it. Anyone else who tries sees "This link was already used".
- **It switches off by itself** once that phone has downloaded every file.
- **It also switches off if nobody uses it for 30 minutes,** so your PC never stays open for sharing.
- **Stop sharing** on Pelican's page (or its right-click menu) switches it off straight away.

To send more files, drop them on Pelican and show a new QR code. If you add files before anyone has scanned the code, Pelican quietly makes a new code that includes them.

## Your sites on your phone

Building a website? Pelican's page lists every dev server Mole sees on your PC (`npm run dev`, Vite, Next.js, Django...), one row per port:

- **Your phone can open it:** click **QR code** and scan it. Your site opens on your phone, so you can see how it looks on a small screen.
- **Only this PC can open it:** many dev tools only allow the PC itself by default. Pelican tells you the fix for your tool, for example:

  | Tool | Start it with |
  |---|---|
  | Vite, Astro, Nuxt | `npm run dev -- --host` |
  | Next.js | `npm run dev -- -H 0.0.0.0` |
  | Create React App | `HOST=0.0.0.0` before `npm start` |
  | Django | `python manage.py runserver 0.0.0.0:8000` |
  | Flask | `flask run --host=0.0.0.0` |

  Pelican checks each port itself, so the row updates once you restart the server the right way.

## Safety and privacy

- **Nothing goes to the internet.** Files travel straight from your PC to your phone over your Wi-Fi.
- **Only while you share.** Pelican's little web server only runs while a QR code is showing, and it only listens on your Wi-Fi address.
- **Unguessable link.** Each QR code holds a random key that's practically impossible to guess.
- **Only what you dropped.** The phone can only download the files in the pouch, nothing else on your PC.
- **Your files stay where they are.** Pelican only reads them; it never moves, copies or changes them on your PC.

## If your phone can't open it

| What you see | What to do |
|---|---|
| The page never loads | Make sure the phone is on the **same Wi-Fi** as the PC (not mobile data, not a guest network). |
| Windows asked about network access | Click **Allow**. If you clicked Cancel, open GitGremlin again and allow it, or check **Windows Security → Firewall → Allow an app**. |
| Still nothing | Your Wi-Fi may be set to **Public** in Windows, which blocks it. Set it to **Private**: **Settings → Network & internet → Wi-Fi → your network → Private network**. |
| Office, school or café Wi-Fi | Some networks stop devices from reaching each other. Use your home Wi-Fi or your phone's hotspot. |
| "This link was already used" | Another device opened it first. Show a new QR code on the PC. |

## Settings

GitGremlin panel → **Pelican**:

| Setting | What it does | Default |
|---|---|---|
| **On desktop** | Shows or hides Pelican | On |
| **Name**, **Size**, **Walking speed**, **Where it wanders**, **Follow my cursor** | Look and movement, as for every pet | Pelican, 64 px, 48 px/s, anywhere, off |

Tray → **Pelican** also has **Add files...** and **Show QR code...**.

## Art and animations

Pelican is drawn entirely in code, in [`scripts/art/pelican.ts`](../../scripts/art/pelican.ts), and exported to [`assets/pets/pelican/`](../../assets/pets/pelican/):

| Animation | Used for |
|---|---|
| `idle`, `idle_sad` | Standing, bill level (or drooping) |
| `walk`, `walk_sad`, `run`, `crawl` | Waddling around on orange webbed feet |
| `eat` | Gulping files into its pouch: bill up, pouch bulging |
| `happy` | Wings up after a delivery |
| `rummage` | Bill down, sorting through its pouch (while it sends) |
| `wash` | Preening its chest feathers |
| `sit`, `sleep`, `curious` | Resting on its belly, asleep with its head tucked low, and looking up at your cursor |
| `jump_up`, `jump_down`, `dragged`, `hurt` | Hops, falls, being carried and being flicked hard |
| `starving`, `tap` | Shared with every pet (Pelican never starves) |

| Overlay | |
|---|---|
| `accent_on.png` | Files in its mouth (a PDF, a photo and a document), shown while the pouch has files |
| `eyes_*.png` | Expressions: idle, blink, happy, hurt, alert, sad |
| `food.png` | A file with a folded corner |

To regenerate just Pelican's art, run `npm run textures -- pelican`.

## Limitations

- **Same Wi-Fi only.** It doesn't send over the internet, so it can't reach a phone on mobile data or another network.
- **PC to phone only.** It doesn't receive files from the phone.
- **Files, not links.** Dropping a web link or text isn't supported yet.
- **Drop onto Pelican where you can see it.** In desktop mode, app windows cover the pets: drop onto Pelican on the visible desktop, or use the panel.
