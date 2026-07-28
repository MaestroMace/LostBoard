# LostBoard on Android (GrapheneOS Pixel 9)

LostBoard / T.R.I.A.D. DAW ships as a native Android APK. The web app is
wrapped with [Capacitor](https://capacitorjs.com/), so the whole DAW —
Tone.js audio engine, piano roll, mixer, everything — runs inside the app's
own WebView with no browser chrome and no server to point at.

- **App id:** `com.lostboard.triad`
- **App name:** LostBoard
- **Min Android:** 7.0 (API 24) · **Targets:** Android 16 (API 36)
- **Signing:** a bundled, non-secret personal key (`android/app/lostboard.keystore`)
  so every rebuild installs as an update instead of a conflicting new app.

## Getting the APK

You do **not** need to build anything yourself — GitHub Actions builds a
signed APK on every push to `main` / the feature branch.

### Option A — download a prebuilt APK (recommended, works on the phone)

1. On your Pixel 9, open the repo's **Releases** page and pick
   **"LostBoard APK (latest build)"** (tag `apk-latest`).
2. Download **`LostBoard.apk`**.
3. Tap the downloaded file. GrapheneOS will ask whether to let your browser
   (or Files app) install unknown apps — allow it, then confirm the install.

The same APK is also attached to each **Actions → Build Android APK → run →
Artifacts** entry (as `LostBoard-apk`), and mirrored to the `apk-build`
branch as `LostBoard.apk`.

### GrapheneOS notes

- Sideloading is supported out of the box; you only need to grant the
  installing app (Vanadium/your browser or the Files app) the one-time
  "install unknown apps" permission.
- The APK is signed with a stable key, so later builds install straight over
  the top. If you ever swap the key, uninstall the old copy first.
- First launch pulls a few display fonts over the network; after that the DAW
  runs fully offline. Audio starts after you tap **ACKNOWLEDGE & ENGAGE** on
  the boot screen (Android requires a tap before audio can play).

## Building the APK yourself

You need Node 18+, JDK 21, and the Android SDK (platform 36 + build-tools
36.0.0). Android Studio bundles all of the Android pieces.

```bash
npm ci
npm run build            # Vite -> dist/
npx cap sync android     # copy dist/ into the native project
cd android
./gradlew assembleRelease
```

The signed APK lands at:

```
android/app/build/outputs/apk/release/app-release.apk
```

Open `android/` in Android Studio (**File → Open**) if you'd rather build,
run on a device, or debug from there.

### Using your own signing key (optional)

The bundled key is fine for personal sideloading. To sign with a private key
instead — e.g. for wider distribution — set these before the Gradle build and
they override the bundled one without editing any files:

```bash
export LOSTBOARD_KEYSTORE=/path/to/your.keystore
export LOSTBOARD_KEYSTORE_PASSWORD=...
export LOSTBOARD_KEY_ALIAS=...
export LOSTBOARD_KEY_PASSWORD=...
```

## Regenerating the app icon / splash

Source art lives in `assets/` (`icon-foreground.svg`, `icon-background.svg`,
`icon-only.svg`, `splash.svg`). After editing, rasterize to PNG and run the
generator:

```bash
npx capacitor-assets generate --android
```

Then restore the direct (non-inset) adaptive-icon references in
`android/app/src/main/res/mipmap-anydpi-v26/ic_launcher*.xml` if the generator
overwrites them.
