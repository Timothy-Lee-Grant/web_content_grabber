# Implementation Plan — Job Grabber

## 1. Goal & scope

Build a Manifest V3 Chrome extension that extracts a job description from the active tab, converts it to Markdown with YAML frontmatter, and lets the user copy it and/or download it as a `.md` file. Capture is auto-detect with a manual element-picker fallback. A preview step lets the user review/edit before export.

## 2. Tech choices

- **Manifest V3** (required for new Chrome extensions). Background logic runs in a service worker.
- **Vanilla JS** — no framework needed; keeps the bundle tiny and review-friendly.
- **Two bundled libraries** (vendored locally, no CDN — MV3 disallows remote code):
  - **Readability.js** (Mozilla) for main-content extraction.
  - **Turndown.js** for HTML → Markdown conversion.
- No build step required to start. (Optional later: a bundler if the code grows.)

## 3. Permissions (manifest.json)

- `activeTab` — read the current page only when the user clicks the icon. Avoids broad host permissions, which also speeds up store review.
- `scripting` — inject the content script on demand.
- `downloads` — save the generated `.md`.
- `clipboardWrite` — copy to clipboard (or use the `navigator.clipboard` API from the popup, which needs no permission when triggered by a user gesture).
- No `host_permissions` needed if using `activeTab` + `scripting.executeScript`.

## 4. Architecture & data flow

```
User clicks icon
   ↓
popup.js opens popup.html
   ↓ (sends "extract" message)
background.js → scripting.executeScript → content.js runs in page
   ↓
content.js:
   • auto mode: Readability parses document → main article node
   • manual mode: highlight-on-hover element picker; user clicks target
   • returns { html, title, company?, location?, url }
   ↓
popup.js:
   • Turndown converts html → markdown
   • build YAML frontmatter from metadata
   • render preview (editable textarea)
   ↓
User clicks Copy → navigator.clipboard.writeText
User clicks Download → background.js downloads.download({ blob, filename })
```

Conversion can run in either the content script or the popup; doing it in the popup keeps the content script lean. Decide during Phase 3.

## 5. Component responsibilities

**manifest.json** — declares MV3 config, service worker, popup, permissions, icons.

**content.js**
- `extractAuto()` — clone `document`, run Readability, return the article HTML + best-guess metadata.
- `extractManual()` — attach mouseover handler that outlines the hovered element; on click, capture that element's `outerHTML` and tear down listeners.
- Metadata heuristics: `<title>`, `og:title`, `<h1>`, JSON-LD `JobPosting` schema (`title`, `hiringOrganization.name`, `jobLocation`), and `<meta>` tags. JSON-LD is the highest-signal source — check it first.
- Respond to messages from popup/background.

**popup.html / popup.js**
- UI: mode toggle (Auto / Select element), editable fields (title, company, location), preview textarea, Copy + Download buttons, status line.
- Orchestrates extraction request, runs Turndown, assembles frontmatter, handles export actions.
- Filename slug: `slugify("{title}-{company}") + ".md"`, fallback to hostname + date.

**background.js (service worker)**
- Injects content script via `chrome.scripting.executeScript`.
- Handles `downloads.download` with a Blob URL.
- Relays messages where needed.

**lib/** — vendored `readability.js`, `turndown.js`.

## 6. Frontmatter format

```yaml
---
title: <job title>
company: <company or "">
location: <location or "">
source_url: <full page URL>
captured_at: <ISO 8601 timestamp>
---
```

Followed by `# {title} — {company}` and the converted body. Empty fields are kept (with blank values) so downstream parsers see a consistent schema.

## 7. Build phases

**Phase 0 — Scaffold (0.5 day)**
- Create folder structure, `manifest.json`, placeholder icons, empty popup that loads.
- Verify "Load unpacked" works and the popup opens.

**Phase 1 — Basic extraction (1 day)**
- Wire popup → background → content messaging.
- Implement `extractAuto()` with Readability; dump raw HTML to the popup to confirm the pipeline.

**Phase 2 — Markdown + frontmatter (1 day)**
- Integrate Turndown; render Markdown in the preview textarea.
- Add metadata heuristics (JSON-LD first, then og/meta/h1) and build frontmatter.

**Phase 3 — Export actions (0.5 day)**
- Copy-to-clipboard via `navigator.clipboard`.
- Download via `downloads.download`; implement filename slugifier.

**Phase 4 — Manual picker (1 day)**
- Hover-outline element selector, click-to-capture, ESC to cancel.
- Mode toggle in popup; re-run conversion on the picked node.

**Phase 5 — Polish (0.5–1 day)**
- Editable title/company/location fields feeding the frontmatter.
- Empty-state and error handling (no content found, restricted pages like `chrome://`).
- Icon set, popup styling, small UX touches.

## 8. Edge cases to handle

- Restricted pages (`chrome://`, Web Store, PDFs) — detect and show a friendly "can't run here" message.
- Single-page-app job boards (LinkedIn, Greenhouse, Lever, Workday) — content loads async; Readability runs on click so the DOM is already populated, but test each.
- Pages with no clear article — fall back to prompting manual selection.
- Very long descriptions — preview textarea scrolls; no truncation on export.
- Duplicate filenames — Chrome auto-appends `(1)`; acceptable.

## 9. Testing strategy

- **Manual matrix** — test on 6–8 real postings across LinkedIn, Indeed, Greenhouse, Lever, Workday, and a plain company careers page. Verify metadata accuracy and clean body output.
- **Manual picker** — confirm hover/click/ESC and accurate capture.
- **Export** — verify clipboard contents and that downloaded `.md` opens correctly with valid frontmatter.
- **Regression** — keep a short checklist (in DEPLOYMENT_PLAN) to re-run before each packaged release.
- **Verification gate** — before calling the build done, run the full matrix and confirm frontmatter parses (paste a sample into a YAML validator or your target project).

## 10. Future enhancements (out of scope for v1)

- Site-specific extractors for the top job boards.
- Auto-save directly into a chosen project folder (via File System Access API or native messaging).
- Tagging / categorization of saved jobs.
- Options page for default export behavior and filename template.
