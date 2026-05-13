# ROAM — Google Play submission playbook

App Store submission complete ✓. This doc is now Play-only.

## Artifacts in hand

| Artifact | Path | Notes |
|---|---|---|
| Android AAB | `android/app/build/outputs/bundle/release/app-release.aab` | 8.5MB, signed |
| Keystore | `~/.appstoreconnect/private_keys/roam-release.keystore` | **Back this up to 1Password** — losing it means you can never update the Android app |
| Keystore creds | `~/.appstoreconnect/private_keys/roam-android-signing.env` | Random 24-char password — back up too |
| Test account | `appreview@go-roam.uk` / `RoamApple2026Demo` | Use the same one for Play reviewers if they ask |

## 1. Create the app (2 min)

1. **https://play.google.com/console** → **Create app**
2. **App name:** ROAM
3. **Default language:** English (United Kingdom)
4. **App or game:** App
5. **Free or paid:** Free
6. Accept declarations → **Create app**

## 2. Dashboard task list (work top-down)

Play Console shows a checklist on the Dashboard. Fill each:

1. **App access** — "All functionality is available without special access" (or, if a reviewer asks for a login, paste `appreview@go-roam.uk` / `RoamApple2026Demo`)
2. **Ads** — No
3. **Content rating** — run the questionnaire. ROAM = no violence / no nudity / no gambling / has user-generated content + social features. Result should be **Everyone / PEGI 3**.
4. **Target audience and content** — Age **13+**. Not directed at children.
5. **News app** — No
6. **COVID-19 contact tracing** — No
7. **Data safety** — mirror what you put in App Store App Privacy:
   - **Name, email** — collected, linked to user, App functionality, not shared, encrypted in transit, user can request deletion
   - **Approximate + precise location** — collected, App functionality, not shared
   - **Photos** (user uploads) — collected, App functionality
   - **App interaction / Other user-generated content** (reviews, tips) — collected, App functionality + Analytics
8. **Government apps** — No
9. **Financial features** — No
10. **Health** — No

## 3. Store listing (10 min)

Left sidebar → **Grow → Store presence → Main store listing**.

- **App name:** ROAM
- **Short description** (80 char): `Discover places near you. Save what you love. Plan your weekend.`
- **Full description:** reuse your App Store description (max 4000 char). Promo line: *"Stop scrolling. Start roaming. Discover places nearby, save your favourites, plan your weekend."*
- **App icon** (512×512 PNG): pull from `android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png` and upscale, or reuse your iOS icon
- **Feature graphic** (1024×500 PNG): **required** — make this in Canva (search "Google Play feature graphic"). ROAM wordmark + tagline on the cream/forest palette. ~5 min.
- **Phone screenshots:** upload 2–8. The iOS screenshots you took on the simulator are fine — Play accepts any aspect ratio between 9:16 and 16:9. The 1320×2868 iOS ones will work as-is.

## 4. Upload the AAB to Internal testing (3 min)

Left sidebar → **Test and release → Testing → Internal testing**

1. **Create new release**
2. Upload `android/app/build/outputs/bundle/release/app-release.aab`
3. **Release name:** 1.0
4. **Release notes:** *"Initial release of ROAM — discover, save, and plan your weekend adventures."*
5. **Save** → **Review release** → **Start rollout to Internal testing**

No Google review required for this track — testers can install immediately. Add yourself (or your email) as a tester under the Testers tab and verify everything works on a real Android device before promoting.

## 5. Promote to Production (when internal testing passes)

Left sidebar → **Test and release → Production**

1. **Create new release**
2. **Promote from Internal testing** → select the 1.0 release you just uploaded
3. **Release notes:** same as above
4. **Countries / regions:** add **United Kingdom** (and any others you want)
5. **Save** → **Review release** → **Start rollout to Production**

Google review takes ~3–7 days for a first-time app.

## 6. Backup checklist — do this NOW

- [ ] Copy `~/.appstoreconnect/private_keys/roam-release.keystore` → 1Password attachment
- [ ] Copy `~/.appstoreconnect/private_keys/roam-android-signing.env` → 1Password secure note
- [ ] Verify Play App Signing is enrolled (Play Console handles this by default for new apps — it lets Google rotate the upload key if you ever lose this keystore)
