# Job Grabber

A Chrome extension that turns any job description page into a clean Markdown file with one click — so you can feed the role's details into your other projects as context.

## What it does

You're browsing job postings. You find one you care about. You click the Job Grabber icon, the extension extracts the job content, converts it to Markdown with useful metadata at the top, and lets you **copy it to the clipboard** and/or **download it as a `.md` file**. Drop that file into your other project and it now has rich context about the roles you're targeting.

## Features

- **Smart capture** — auto-detects the main job-description content on the page (strips nav, ads, footers, cookie banners). If it grabs the wrong thing, switch to **manual select** and click the exact element you want.
- **Preview before saving** — see the generated Markdown in the popup; edit it if needed before exporting.
- **Two ways out** — copy to clipboard and/or download a `.md` file named from the job title and company (e.g. `senior-backend-engineer-acme.md`).
- **Rich frontmatter** — every file starts with YAML metadata so downstream tools can parse it:

  ```yaml
  ---
  title: Senior Backend Engineer
  company: Acme Corp
  location: Remote (US)
  source_url: https://example.com/jobs/123
  captured_at: 2026-06-20T14:32:00Z
  ---
  ```

- **Works anywhere** — runs on any site, not tied to one job board.

## Install (development)

1. Clone or download this repo.
2. Open `chrome://extensions` in Chrome.
3. Turn on **Developer mode** (top-right).
4. Click **Load unpacked** and select this project folder.
5. Pin the extension so the icon is visible in the toolbar.

(A future Chrome Web Store listing is described in `DEPLOYMENT_PLAN.md`.)

## Usage

1. Open a job posting in your browser.
2. Click the **Job Grabber** toolbar icon.
3. Review the auto-extracted preview. If it looks wrong, click **Select element** and click the job section on the page.
4. Tweak the title/company fields if needed.
5. Click **Copy** or **Download** (or both).
6. Paste/move the `.md` into your target project.

## Output example

```markdown
---
title: Senior Backend Engineer
company: Acme Corp
location: Remote (US)
source_url: https://example.com/jobs/123
captured_at: 2026-06-20T14:32:00Z
---

# Senior Backend Engineer — Acme Corp

## About the role
We're looking for...

## Requirements
- 5+ years...
```

## Project layout

```
web_content_grabber/
├── manifest.json              # MV3 config
├── src/
│   ├── background.js          # minimal service worker (lifecycle hooks)
│   ├── popup.html             # toolbar UI
│   ├── popup.css              # popup styling (light/dark)
│   ├── popup.js               # popup logic: extract, frontmatter, copy, download
│   └── lib/
│       ├── htmlToMarkdown.js  # native HTML → Markdown converter (injected)
│       └── extractor.js       # content auto-detect, JSON-LD metadata, manual picker (injected)
├── icons/                     # 16/32/48/128 px
├── README.md
├── IMPLEMENTATION_PLAN.md
└── DEPLOYMENT_PLAN.md
```

> Implementation note: the content extraction and HTML→Markdown conversion are
> implemented natively in `src/lib/` rather than vendoring Readability/Turndown.
> This keeps the extension fully self-contained with **no remote or third-party
> code** — which is simpler and friendlier for Chrome Web Store review.

## Privacy

Everything runs locally in your browser. The extension reads page content only when you click it, and nothing is sent to any server.

## License

MIT (or your choice).
