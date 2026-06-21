# Implementation Plan V2 — Extraction & Metadata Quality

## Why

The v1 build works end-to-end but produces noisy output on single-page-app job
boards. Real-world test (LinkedIn `jobs/search-results` page) captured the entire
page — the 25-item results sidebar, footer, premium upsells, and "About the
company" boilerplate — with the actual job description buried ~290 lines down.
Metadata was also wrong: `company: linkedin` (hostname fallback) and an empty
`location`, with a title still carrying the ` | Microsoft | LinkedIn` suffix.

This plan fixes content selection, metadata, boilerplate stripping, and the
flattened structure of the description body. All changes are confined to
`src/lib/extractor.js` and `src/lib/htmlToMarkdown.js`; no manifest, permission,
or UI changes are required.

## Goals & success criteria

For the LinkedIn test page (and equivalents), after these changes the output should:

- Contain **only the selected job**, not the results list or other postings.
- Have `company: Microsoft` and `location: Redmond, WA (Hybrid)` (or close).
- Have a clean `title` with site/company suffixes stripped.
- Exclude premium upsells, "About the company," footer, and "People you can reach out to."
- Preserve the description's section structure (Overview / Responsibilities / Qualifications on their own lines).

## Change 1 — Site-aware content selectors

**File:** `extractor.js` → `pickContentNode()` and a new `KNOWN_SELECTORS` set.

Expand and reorder the known-selector list so the job-detail pane wins before any
density scan runs. Add the selectors that actually exist on the major boards:

- **LinkedIn:** `#job-details`, `.jobs-description__content`, `.jobs-box__html-content`, `.jobs-description-content__text`, `.show-more-less-html__markup`, `.description__text`
- **Indeed:** `#jobDescriptionText`
- **Greenhouse:** `#content`, `.job__description`, `.body`
- **Lever:** `[data-qa="job-description"]`, `.posting-description`, `.section-wrapper.page-full-width`
- **Workday:** `[data-automation-id="jobPostingDescription"]`
- **Ashby:** `.ashby-job-posting-right-pane`, `[class*="_descriptionText"]`
- **Generic:** `[class*="job-description"]`, `[class*="JobDescription"]`, `[id*="job-description"]`

Logic: iterate in priority order; accept the first match whose `textLen > 200`.
Only fall through to landmarks/density scan if none match.

**Acceptance:** on the LinkedIn page, `#job-details` (the "About the job" pane) is
selected and the results sidebar is never included.

## Change 2 — Penalize "list of cards" containers in the density scan

**File:** `extractor.js` → `pickContentNode()` generic branch + new helpers.

The density scan picked the whole-page wrapper because raw text length dominated.
Make the scorer reject list-like wrappers (search results, nav menus):

- Add `repeatedChildPenalty(el)` — count direct children sharing the same tag +
  similar class signature; if a container has many near-identical children
  (e.g. 10+ job cards), it's a list, not an article.
- Add `boilerplatePenalty(el)` — penalize blocks whose text matches phrases like
  "company alumni work here", "Posted N week(s) ago", "Try Premium", "job alerts".
- Revise score:
  `score = textLen * (1 - linkDensity) * (1 - repeatedChildRatio) / (1 + boilerplateHits)`
- Skip any candidate that contains another already-higher-scoring candidate
  (prefer the inner content block over its wrapper).

**Acceptance:** even with site-selectors disabled, the scan prefers the single
description block over the results list on the LinkedIn page.

## Change 3 — Better metadata extraction

**File:** `extractor.js` → `getMetadata()` plus new site-card readers.

**Title cleanup:** strip trailing site/company segments. Split `title` on `|`, `–`,
`—`, `·`; if the last segment looks like a site name (`LinkedIn`, `Indeed`,
`Glassdoor`, `Greenhouse`, etc.) drop it; if a middle segment matches the detected
company, drop it too. Result: `Software Engineer II - Copilot M365 Calendar`.

**Company:** resolution order —
1. JSON-LD `hiringOrganization.name`.
2. LinkedIn top-card: `.job-details-jobs-unified-top-card__company-name a`,
   `.topcard__org-name-link`, `.jobs-unified-top-card__company-name`.
3. A company segment parsed out of the title (the part dropped during cleanup).
4. `og:site_name` **only if** it isn't a known aggregator.
5. Hostname fallback — but **never** for known aggregators (linkedin, indeed,
   glassdoor, greenhouse, lever, ziprecruiter, etc.); leave blank instead of "linkedin".

**Location:** resolution order —
1. JSON-LD `jobLocation.address`.
2. LinkedIn top-card: `.job-details-jobs-unified-top-card__primary-description-container`,
   `.topcard__flavor--bullet`, `.jobs-unified-top-card__bullet`.
3. Leave blank if unknown (don't guess).

**Acceptance:** `company: Microsoft`, `location: Redmond, WA (Hybrid)`, clean title.

## Change 4 — Strip boilerplate from the captured node

**File:** `extractor.js` → new `stripBoilerplate(clone)` run before conversion.

Work on a **clone** of the selected node (never mutate the live page). Remove:

- Elements matching junk selectors: `[class*="premium"]`, `[class*="upsell"]`,
  `[class*="similar-jobs"]`, `[class*="people-also"]`, `footer`, `[role="navigation"]`,
  `.jobs-company__box`, `[class*="about-the-company"]`.
- Elements whose visible text matches boilerplate phrases ("Try Premium for $0",
  "Get job alerts", "People you can reach out to", "Are these results helpful",
  "About the company", "© 20").
- Trailing "About the company" section: cut everything after a heading matching
  `/about the company/i` within the captured node.

Then convert the cleaned clone with `jgHtmlToMarkdown`.

**Acceptance:** none of the v1 footer/upsell/"about the company" lines appear in output.

## Change 5 — Restore description structure

**File:** `htmlToMarkdown.js` → `processNode()` handling for `strong`/`b` and a
post-process pass.

LinkedIn renders section labels as inline `<strong>Overview</strong>` immediately
followed by body text, producing `**Overview**As a…`. Improvements:

- When a `<strong>`/`<b>` is the first child of its block and is followed by more
  content, treat it as a sub-heading: emit `\n\n**Label**\n\n` (label on its own line).
- Post-process: insert a newline between a bold run and an immediately adjacent
  non-space character (`/\*\*(\w)/` → `** \1` guard), and before inline list
  dashes that got glued to text (` - ` mid-line following a sentence).
- Detect known labels (`Overview`, `Responsibilities`, `Qualifications`,
  `Required Qualifications`, `Preferred Qualifications`, `Other Requirements`,
  `Benefits`) and promote them to `### ` headings.

**Acceptance:** Overview / Responsibilities / Qualifications appear as their own
headed sections with readable bullet lists.

## Out of scope (intentionally)

- No new permissions or `host_permissions`.
- No background-script changes.
- No popup UI changes (the existing manual picker already covers cases where
  auto-detect still guesses wrong).
- No network calls or third-party libraries.

## Build phases

1. **Selectors + metadata (Changes 1 & 3)** — highest impact; fixes both the
   wrong-node and wrong-metadata problems. ~0.5 day.
2. **Boilerplate strip (Change 4)** — clone + clean pass. ~0.5 day.
3. **Density-scan hardening (Change 2)** — repeated-child and boilerplate
   penalties for sites without known selectors. ~0.5 day.
4. **Structure restore (Change 5)** — strong-as-heading + post-process. ~0.5 day.

## Testing & verification

**Regression harness (no browser needed):** extend the existing Node + DOM-mock
test to cover the new logic:

- Title cleanup: `"Eng | Microsoft | LinkedIn"` → `"Eng"`, company `"Microsoft"`.
- Aggregator guard: hostname `linkedin.com` never yields `company: linkedin`.
- `stripBoilerplate` removes nodes matching junk selectors/phrases.
- `repeatedChildPenalty` scores a 20-card list below a single article block.
- `strong`-leading label becomes its own line / `###` heading.

**Manual matrix:** re-capture the same LinkedIn job (both the search-results URL
and the dedicated `/jobs/view/<id>` URL), plus one each on Indeed, Greenhouse,
Lever, Workday, and a plain careers page. Confirm: single-job content, correct
company/location, clean title, no boilerplate, readable sections.

**Gate:** all regression assertions pass and the LinkedIn output meets every
success criterion above before marking V2 done.

## Risk notes

- Job-board class names change over time; selectors may need periodic updates.
  The density scan (Change 2) is the resilience layer when selectors miss, and
  the manual picker remains the always-available fallback.
- Boilerplate phrase matching is locale-specific (English). Acceptable for v1;
  note as a future i18n enhancement.
