# Deployment Plan — Job Grabber

This covers everything from running the extension locally to publishing it on the Chrome Web Store. For personal use you may never need to go past Stage 1.

## Stage 0 — Prerequisites

- Google Chrome (or any Chromium browser: Edge, Brave, Arc).
- The project folder with a valid `manifest.json` and icon files (16, 32, 48, 128 px).
- For store publishing only: a **Chrome Web Store developer account** (one-time **$5 USD** registration fee).

## Stage 1 — Local development (unpacked)

Use this the entire time you're building, and indefinitely if it's just for you.

1. Open `chrome://extensions`.
2. Enable **Developer mode** (top-right toggle).
3. Click **Load unpacked** → select the project folder.
4. The extension appears with an ID; pin it to the toolbar.
5. After code changes, click the **reload (↻)** icon on the extension card. Reload the target web page too if you changed the content script.

**Debugging**
- Popup: right-click the popup → **Inspect**.
- Service worker: on the extension card click **service worker** → opens DevTools for `background.js`.
- Content script: use the normal page DevTools console (look for your script's logs).

## Stage 2 — Pre-release checklist

Run this before packaging any version:

- [ ] Loads with no errors on the `chrome://extensions` card.
- [ ] Manual test matrix passes (LinkedIn, Indeed, Greenhouse, Lever, Workday, plain careers page).
- [ ] Auto-detect produces clean Markdown; manual picker works (hover/click/ESC).
- [ ] Copy and Download both work; filename slug is sensible.
- [ ] Frontmatter is valid YAML and parses in your target project.
- [ ] Graceful message on restricted pages (`chrome://`, Web Store, PDFs).
- [ ] `manifest.json` version number bumped (semver, e.g. `1.0.0`).
- [ ] No `console.log` noise or dead code left in.
- [ ] Permissions are minimal (`activeTab`, `scripting`, `downloads` — no broad host perms).

## Stage 3 — Package for distribution

For a personal/shared build without the store:

1. Bump `version` in `manifest.json`.
2. Remove dev-only files (notes, `.map` files if any).
3. Zip the folder contents (the files, not an enclosing folder):
   ```bash
   cd web_content_grabber
   zip -r ../job-grabber-v1.0.0.zip . -x "*.git*" "*.DS_Store" "*.md"
   ```
4. The `.zip` can be shared and loaded via **Load unpacked** (after unzip) by anyone with Developer mode on.

> Note: unpacked/sideloaded extensions show a "Developer mode extensions" warning on Chrome startup. To avoid that and get auto-updates, publish to the Web Store (Stage 4).

## Stage 4 — Chrome Web Store publishing (optional)

Only needed if you want easy install, auto-updates, or to share publicly.

**4.1 One-time setup**
- Register at the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole) and pay the **$5** fee.
- Set up the developer account details (and verify a contact email).

**4.2 Prepare store assets**
- Production `.zip` (from Stage 3).
- Icon 128×128.
- At least one **1280×800** or **640×400** screenshot of the popup in action.
- Short description (≤132 chars) and a detailed description.
- A **privacy policy** URL (even a simple page) — required because the extension reads page content. State clearly that all processing is local and nothing is transmitted.
- Justification text for each permission (review now requires this).

**4.3 Submit**
1. In the dashboard click **Add new item**, upload the `.zip`.
2. Fill listing details, category (Productivity), screenshots, privacy disclosures.
3. Complete the **Privacy practices** tab: declare data usage (none collected/transmitted), justify `activeTab`, `scripting`, `downloads`.
4. Choose visibility: **Unlisted** (link-only — good for personal use) or **Public**.
5. Submit for review.

**4.4 Review & publish**
- Review typically takes a few hours to a few business days. Extensions using minimal permissions usually clear faster.
- If rejected, the email cites the reason (commonly: permission justification or privacy policy). Fix and resubmit.
- Once approved it goes live at your chosen visibility.

## Stage 5 — Updates

1. Make changes, bump `version` in `manifest.json` (must be higher than the published one).
2. Re-run the Stage 2 checklist.
3. Re-zip and upload the new package in the dashboard → **Package** → upload → submit.
4. Chrome auto-updates installed copies within a few hours of approval.

## Rollback

- Local: keep previous `.zip` builds; unzip and Load unpacked to revert.
- Store: you can't truly "un-publish" a version retroactively, but you can immediately upload a fixed higher version, or **unpublish** the item to stop new installs.

## Recommendation for your use case

Since this is for your own job-targeting workflow, **Stage 1 (Load unpacked)** is all you need — fast, free, fully private, no review. Only go to Stage 4 if you want it on multiple machines with auto-updates or want to share it.
