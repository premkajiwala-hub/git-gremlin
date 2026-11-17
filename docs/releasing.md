<sub>[Back to GitGremlin](../README.md)</sub>

# Publishing an update

GitGremlin updates itself from GitHub. Pushing to `main` alone never reaches anyone: a copy of GitGremlin is offered an update only when **`updates.json` on `main` lists a newer version** and a **`v<version>` tag** exists for it. So README fixes and unfinished work can go to `main` any time.

## How copies update

Every 6 hours (and 20 seconds after start), GitGremlin reads `updates.json` from `main`. When it lists a version newer than the copy's `package.json` version:

1. A Windows notification says what's new: *"GitGremlin 0.4.0 is ready. 3 new pets: ..."*. It appears once per version.
2. **General → Updates** lists every release since the copy's version: new pets, features, fixes and package changes. The tray menu gets **Update to 0.4.0...**.
3. **Update now**:
   - **A git clone** fetches the tag and fast-forwards to it. It refuses if the folder has uncommitted changes or its own commits, so nobody's work is overwritten.
   - **A ZIP download** downloads the tag's archive and copies it over its files. It keeps the files it replaces, for a rollback.
   - If `package.json` or `package-lock.json` changed what's installed (a version bump alone doesn't count), GitGremlin quits, a small helper runs `npm install`, then starts it again. If `npm install` fails, the helper puts the old files back and starts the old version.
   - Otherwise GitGremlin simply restarts, and rebuilds itself on launch.
4. After the restart, **General → Updates** shows *"GitGremlin is now 0.4.0"* with what came in, plus a notification.

Copies installed with the Windows installer are pointed to GitHub instead. Copies run with `npm start` don't update themselves.

## Releasing a version

1. Bump the version in `package.json` and `package-lock.json`:

   ```powershell
   npm version 0.4.0 --no-git-tag-version
   ```

2. Add the release at the top of `updates.json`:

   ```json
   {
     "version": "0.4.0",
     "date": "2026-12-01",
     "title": "Three new pets",
     "pets": [{ "name": "Tortoise", "summary": "tells you why your PC is slow" }],
     "features": ["Update GitGremlin from the panel"],
     "fixes": ["..."]
   }
   ```

   `pets` should name pets that are new in this version. Keep each line short: it's shown in the notification and the panel.

3. Update the README (What's new) and commit everything.
4. Tag and push **the commit and the tag together**, so the tag exists the moment `updates.json` announces it:

   ```powershell
   git tag v0.4.0
   git push origin main v0.4.0
   ```

The CI build also runs on `v*` tags and uploads the installer as a build artifact.

## Testing an update locally

Set `GITGREMLIN_UPDATE_SOURCE` to a folder that stands in for GitHub, and `GITGREMLIN_USER_DATA` to a spare data folder:

| In the folder | Stands in for |
|---|---|
| `updates.json` | `updates.json` on `main` |
| `repo.git` | the GitHub repo (a bare clone with the tags) |
| `v0.4.0.tar.gz` | GitHub's archive of the tag (`git archive --format=tar.gz --prefix=git-gremlin-0.4.0/`) |
| `raw/v0.4.0/package.json`, `raw/v0.4.0/package-lock.json` | the files at the tag |
