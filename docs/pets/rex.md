<sub>[← Mole](mole.md) · **Rex** · [Back to GitGremlin →](../../README.md)</sub>

<p align="center">
  <img src="../../assets/pets/rex/portrait.png" alt="Rex's head: a cream tin toy dog with round headlamp eyes, a black nose and a long floppy red ear" width="96" />
</p>

<h1 align="center">Rex</h1>

<p align="center"><b>A wind-up tin toy dog that sniffs your public GitHub repos for leaked secrets.</b><br />API keys, tokens, private keys, database passwords, <code>.env</code> files: anything that should never have been pushed. Rex barks the moment it finds one.</p>

<p align="center">
  <img src="../images/rex-poses.png" alt="Rex's poses: idle, walking, sniffing the ground, barking with its jaw dropped open, eating a tin bone, happy, sitting and asleep" width="100%" />
  <br /><sub>Idle · walk · sniffing (scanning your repos) · bark (a leak!) · eating a bone · happy · sitting · asleep</sub>
</p>

## At a glance

| | |
|---|---|
| **Species** | Wind-up tin toy dog: a cream tin barrel body with a red saddle stripe and rivets, a brass wind-up key on its back that turns as it moves, long floppy red ears, round headlamp eyes, little red shoes and a coil-spring tail |
| **Job** | Reads your **public** GitHub repos (current files and recent commits) and reports anything secret that's in them |
| **Feeds on** | Plugged leaks: when a leak is gone from a repo, Rex crunches a tin bone |
| **Needs** | Your GitHub account, linked once in **General → GitHub account** (or the GitHub CLI). No extra permissions: public repos only |
| **Panel page** | GitGremlin panel → **Rex** |

## Contents

- [Getting started](#getting-started)
- [What Rex sniffs out](#what-rex-sniffs-out)
- [Current files and history](#current-files-and-history)
- [When Rex sniffs](#when-rex-sniffs)
- [Fixing a leak](#fixing-a-leak)
- [Not a secret?](#not-a-secret)
- [Safety and privacy](#safety-and-privacy)
- [Rex at work](#rex-at-work)
- [Settings](#settings)
- [Art and animations](#art-and-animations)
- [Limitations](#limitations)

## Getting started

1. Sign in with GitHub in **General → GitHub account** (Rex's page has the same button until you're signed in). It's the same sign-in Catbot uses, so if you're already signed in, there's nothing to do.
2. About a minute after GitGremlin starts, Rex sniffs every public repo you own. After that it sniffs once a day, and shortly after you push.
3. Open GitGremlin → **Rex** to see what it found, or click **Sniff now**.

## What Rex sniffs out

| Kind | Examples | |
|---|---|---|
| **Keys and tokens** | AWS access and secret keys, GitHub tokens, OpenAI and Anthropic keys, Stripe, SendGrid, Slack tokens and webhooks, Discord webhooks, Telegram bot tokens, npm tokens, Twilio and Mailgun keys, Google API keys | high |
| **Private keys** | `-----BEGIN ... PRIVATE KEY-----` blocks, `id_rsa`, `.pem` and `.key` files with private keys, keystores (`.jks`, `.keystore`, `.p12`, `.pfx`) | high |
| **Database settings** | Database URLs with a password (`postgres://`, `mysql://`, `mongodb+srv://`, `redis://`...), connection strings with `Password=`, `DB_PASSWORD`, `MYSQL_PASSWORD` and friends (including `wp-config.php`) | high |
| **Files that shouldn't be pushed** | `.env` files with values (not `.env.example`), `.git-credentials`, `.netrc`, `.pypirc`, `.npmrc` with a token, service-account and Firebase admin JSON files, Terraform state | high |
| **Database files** | `.sqlite`, `.db`, `dump.rdb`, and `.sql` dumps that contain data | check |
| **Hard-coded passwords** | `password = "..."`, `api_key: "..."`, `client_secret` and similar, when the value looks real; Django `SECRET_KEY`; passwords inside URLs | check |

**high** means it's almost certainly a real secret. **check** means it might be harmless (a Firebase web key, a sample database), so take a look. In test code (`tests/`, `e2e/`, `fixtures/`, `*.test.*`, `*.spec.*`), Rex only reports **high** finds: made-up test passwords there are skipped, but a real key format is a leak wherever it is.

Rex skips obvious placeholders such as `your_api_key_here`, `${DB_PASSWORD}`, `process.env.X`, `<password>`, `changeme` and AWS's documented example key. It also skips lock files, minified files, `node_modules` and build output.

## Current files and history

For each public repo, Rex reads:

- **Every file on the default branch**, as one download (a repo that hasn't changed since last time isn't downloaded again).
- **The last 30 commits** on the default branch (you can choose none, 30 or 100), looking only at the lines each commit added.

A secret you deleted is still on GitHub in the commit that added it, so Rex shows those too, marked **deleted, still in history**, with the commit and its age.

## When Rex sniffs

- **Once a day**, a full sweep of every public repo.
- **After you push:** when Syncy sees commits reach GitHub, Rex waits a minute, then sniffs just those repos (when they're public repos of your account).
- **Sniff now**, any time, from its page, its right-click menu or the tray.

## Fixing a leak

Each leak has **Open on GitHub**, which jumps to the exact file and line. Then:

1. **Revoke or rotate the secret first**, wherever it was issued (AWS, Stripe, GitHub, your database host...). It has been public, so treat it as stolen. This is the step that keeps you safe.
2. **Remove it from the repo.** Move it to an environment variable or a secrets manager, and add the file (like `.env`) to `.gitignore`.
3. **Old commits keep it.** Rotating makes the old value useless; rewriting history (for example with `git filter-repo`) only tidies up.

On its next sniff, Rex sees the leak is gone and crunches a bone:

> `LEAK PLUGGED IN API! CRUNCH.`

## Not a secret?

Test passwords, sample data and public Firebase web keys can be fine. **Not a secret** tells Rex to stop barking about that exact value. It appears under **Marked not a secret**, where **Watch again** undoes it.

## Safety and privacy

- **Public repos only.** Rex lists your repos with GitHub's public listing and reads nothing private, even if your GitHub CLI login could.
- **Read-only.** Rex only sends GET requests. It never commits, opens issues or changes a repo.
- **Secrets never leave GitHub's copy.** Rex keeps only a masked preview (like `AKIA••••••••OP`) and a fingerprint. The secret itself is never saved, shown in full, or sent anywhere.
- **Your token** is your one GitHub sign-in (shared with Catbot), stored encrypted on your PC. Rex asks GitHub for nothing new.
- **Gentle on GitHub.** A sweep of a few repos takes a few dozen requests out of your 5,000 per hour. If the limit runs out, Rex stops and tries again later.

## Rex at work

| What Rex is doing | What you see on the desktop |
|---|---|
| Sniffing your repos | Nose to the ground, puffs of dust, wind-up key turning |
| Found a new leak | Barks (jaw open, sound waves), says what and where |
| A leak got fixed | Eats a tin bone and hops with hearts |
| All clean | Wags its spring tail, scratches behind its ear, naps |

**Hover** over Rex for its report:

```
GUARDING 3 PUBLIC REPOS
LEAKS FOUND: 2
- API: .ENV FILE WITH VALUES
- SHOP: STRIPE LIVE KEY
LAST SNIFF: 2H AGO

> RIGHT-CLICK ME TO SEE THEM.
```

## Settings

GitGremlin panel → **Rex**:

| Setting | What it does | Default |
|---|---|---|
| **On desktop** | Shows or hides Rex (and pauses its sniffing) | On |
| **Recent commits to check** | None, the last 30 or the last 100 commits per repo | Last 30 |
| **Sniff after I push** | Rescan a repo a minute after Syncy sees you push it | On |
| **Daily sweep** | Sniff every public repo once a day | On |
| **Include my forks** | Also sniff forks (they mostly hold other people's code) | Off |
| **Name**, **Size**, **Walking speed**, **Where it wanders**, **Follow my cursor** | Look and movement, as for every pet | Rex, 64 px, 50 px/s, anywhere, off |

Tray → **Rex** also has **Sniff my repos now** and **Show leaked secrets...**.

## Art and animations

Rex is drawn entirely in code, in [`scripts/art/rex.ts`](../../scripts/art/rex.ts), and exported to [`assets/pets/rex/`](../../assets/pets/rex/):

| Animation | Used for |
|---|---|
| `idle`, `idle_sad` | Standing, tail wagging |
| `walk`, `walk_sad`, `run`, `crawl` | Getting around |
| `rummage` | Nose to the ground, sniffing: scanning your repos |
| `bark` | Its nutcracker jaw drops open, with sound waves: a leak |
| `eat`, `happy`, `wash` | Crunching a tin bone after a fix, a happy hop, scratching behind its ear |
| `sit`, `sleep`, `curious` | Resting and reacting to your cursor |
| `jump_up`, `jump_down`, `dragged`, `hurt` | Hops, falls, being carried and being flicked hard |
| `starving`, `tap` | Shared with every pet: wound down and tipped over (Rex never starves, so it doesn't use them) |

| Overlay | |
|---|---|
| `eyes_*.png` | Pupils inside its headlamp eyes: idle, blink, happy, hurt, alert, sad |
| `food.png` | A tin bone |

To regenerate just Rex's art, run `npm run textures -- rex`.

## Limitations

- **Public repos you own.** Private repos, and repos of organisations you belong to, aren't sniffed.
- **The default branch and its recent commits.** Other branches, older history, issues, pull requests, gists and GitHub Actions logs aren't read.
- **Pattern matching, not magic.** Rex knows the formats of common keys and the usual names for passwords. A secret in an unusual format, or split across lines, can slip past. A test password can look real.
- **Repos over 150 MB are skipped**, and so are files over 1 MB and binary files (except risky ones it can spot by name, like keystores and database files).
- **Rotate, don't just delete.** Rex can't tell whether a key still works, or whether you've rotated it.

---

<sub>[← Mole](mole.md) · [Back to GitGremlin](../../README.md)</sub>
