/* Job Grabber — content extraction + metadata + manual element picker.
 * Runs in the page (injected via chrome.scripting.executeScript).
 * Depends on window.jgHtmlToMarkdown (htmlToMarkdown.js).
 * Exposes:
 *   window.__jobGrabberExtractAuto()  -> { title, company, location, url, markdown }
 *   window.__jobGrabberStartPicker()  -> click-to-select; stores result in chrome.storage.local
 */
(function () {
  "use strict";

  // Known job-aggregator names — never used as the "company".
  var AGGREGATORS = /(linkedin|indeed|glassdoor|greenhouse|lever|ziprecruiter|monster|dice|workday|myworkdayjobs|ashby|simplyhired|wellfound|angellist|angel\.co|jobvite|smartrecruiters|builtin)/i;
  var SITE_NAME = /^(linkedin|indeed|glassdoor|greenhouse|lever|ziprecruiter|monster|dice|workday|ashby|simplyhired|wellfound|angellist|jobs|careers)$/i;

  // ---------- small utils ----------
  function clean(s) {
    return (s || "").replace(/\s+/g, " ").trim();
  }

  function metaContent(selector) {
    var el = document.querySelector(selector);
    return el ? clean(el.getAttribute("content")) : "";
  }

  function textLen(el) {
    return clean(el && (el.innerText || el.textContent) || "").length;
  }

  function firstText(selectors) {
    for (var i = 0; i < selectors.length; i++) {
      var el = document.querySelector(selectors[i]);
      if (el) {
        var t = clean(el.innerText || el.textContent);
        if (t) return t;
      }
    }
    return "";
  }

  function hostnameToken() {
    var parts = window.location.hostname.replace(/^www\./, "").split(".");
    if (parts.length >= 2) return parts[parts.length - 2];
    return parts[0] || "";
  }

  // ---------- JSON-LD ----------
  function getJsonLdJob() {
    var scripts = document.querySelectorAll('script[type="application/ld+json"]');
    for (var i = 0; i < scripts.length; i++) {
      var data;
      try { data = JSON.parse(scripts[i].textContent); } catch (e) { continue; }
      var list = Array.isArray(data) ? data : (data && data["@graph"] ? data["@graph"] : [data]);
      for (var j = 0; j < list.length; j++) {
        var item = list[j];
        if (!item) continue;
        var type = item["@type"];
        if (type === "JobPosting" || (Array.isArray(type) && type.indexOf("JobPosting") !== -1)) {
          return item;
        }
      }
    }
    return null;
  }

  // ---------- metadata ----------
  var LINKEDIN_COMPANY = [
    ".job-details-jobs-unified-top-card__company-name a",
    ".job-details-jobs-unified-top-card__company-name",
    ".jobs-unified-top-card__company-name a",
    ".jobs-unified-top-card__company-name",
    ".topcard__org-name-link",
    ".topcard__flavor a",
    '[class*="topcard__org"]'
  ];
  var LINKEDIN_LOCATION = [
    ".job-details-jobs-unified-top-card__primary-description-container",
    ".jobs-unified-top-card__primary-description",
    ".jobs-unified-top-card__bullet",
    ".topcard__flavor--bullet",
    '[class*="topcard__flavor--bullet"]'
  ];

  // Split a page title into segments and recover job title + (maybe) company.
  function refineTitleCompany(rawTitle, company) {
    var raw = clean(rawTitle);
    var parts = raw.split(/\s*[|–—·•]\s*/)
      .map(function (s) { return s.trim(); })
      .filter(Boolean);
    if (parts.length <= 1) return { title: raw, company: company };

    var nonSite = parts.filter(function (p) { return !SITE_NAME.test(p); });
    var jobTitle = nonSite[0] || parts[0];
    var newCompany = company;
    if (!newCompany && nonSite.length >= 2) {
      var cand = nonSite[1];
      if (cand && cand.toLowerCase() !== jobTitle.toLowerCase() && !AGGREGATORS.test(cand)) {
        newCompany = cand;
      }
    }
    // If company is known, strip it from the title if it leaked in.
    if (newCompany) {
      jobTitle = jobTitle.replace(new RegExp("\\s*[-|]\\s*" + escapeRe(newCompany) + "\\s*$", "i"), "");
    }
    return { title: clean(jobTitle), company: newCompany };
  }

  function escapeRe(s) {
    return (s || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function getMetadata() {
    var job = getJsonLdJob();
    var title = "", company = "", location = "";

    if (job) {
      title = clean(job.title);
      if (job.hiringOrganization) {
        company = typeof job.hiringOrganization === "string"
          ? clean(job.hiringOrganization)
          : clean(job.hiringOrganization.name);
      }
      if (job.jobLocation) {
        var loc = Array.isArray(job.jobLocation) ? job.jobLocation[0] : job.jobLocation;
        if (loc && loc.address) {
          var a = loc.address;
          location = clean([a.addressLocality, a.addressRegion, a.addressCountry]
            .filter(Boolean).join(", "));
        }
      }
      if (!location && job.jobLocationType && /tele|remote/i.test(job.jobLocationType)) {
        location = "Remote";
      }
    }

    // Company: site top-card, then og:site_name (if not an aggregator).
    if (!company) company = firstText(LINKEDIN_COMPANY);
    if (!company) {
      var os = metaContent('meta[property="og:site_name"]');
      if (os && !AGGREGATORS.test(os)) company = os;
    }

    // Location: site top-card; take the part before the first separator dot.
    if (!location) {
      var locTxt = firstText(LINKEDIN_LOCATION);
      if (locTxt) location = clean(locTxt.split("·")[0]);
    }

    // Title fallbacks.
    if (!title) title = metaContent('meta[property="og:title"]');
    if (!title) {
      var h1 = document.querySelector("h1");
      if (h1) title = clean(h1.innerText || h1.textContent);
    }
    if (!title) title = clean(document.title);

    // Clean the title and possibly recover the company from it.
    var refined = refineTitleCompany(title, company);
    title = refined.title;
    company = refined.company;

    // Hostname fallback — but never for aggregator domains.
    if (!company) {
      var host = hostnameToken();
      if (host && !AGGREGATORS.test(host)) company = host;
    }

    return { title: title, company: company, location: location, url: window.location.href };
  }

  // ---------- content node selection ----------
  // Priority order: job-detail panes win before any density scan.
  var KNOWN_SELECTORS = [
    // LinkedIn
    "#job-details",
    ".jobs-description__content",
    ".jobs-description-content__text",
    ".jobs-box__html-content",
    ".show-more-less-html__markup",
    ".description__text",
    // Indeed
    "#jobDescriptionText",
    // Greenhouse
    "#content .job__description",
    ".job__description",
    // Lever
    '[data-qa="job-description"]',
    ".posting-description",
    ".section-wrapper.page-full-width",
    // Workday
    '[data-automation-id="jobPostingDescription"]',
    // Ashby
    ".ashby-job-posting-right-pane",
    '[class*="_descriptionText"]',
    // Generic
    '[class*="job-description"]',
    '[class*="JobDescription"]',
    '[id*="job-description"]'
  ];

  function linkDensity(el) {
    var total = textLen(el) || 1;
    var linkLen = 0;
    var links = el.querySelectorAll("a");
    for (var i = 0; i < links.length; i++) {
      linkLen += clean(links[i].innerText || links[i].textContent).length;
    }
    return Math.min(1, linkLen / total);
  }

  // Ratio of the largest group of similar direct children (list detector).
  function repeatedChildRatio(el) {
    var kids = el.children;
    if (!kids || kids.length < 4) return 0;
    var groups = {};
    for (var i = 0; i < kids.length; i++) {
      var c = kids[i];
      var cls = (c.className && c.className.toString ? c.className.toString() : "");
      var sig = c.tagName + "." + (cls.split(/\s+/)[0] || "");
      groups[sig] = (groups[sig] || 0) + 1;
    }
    var max = 0;
    for (var k in groups) { if (groups[k] > max) max = groups[k]; }
    return max / kids.length;
  }

  var BOILER_COUNT = [
    /company alumni work here/gi,
    /connections work here/gi,
    /school alumni work here/gi,
    /posted \d+ (hour|day|week|month)/gi,
    /try premium/gi,
    /get job alerts/gi,
    /early applicant/gi
  ];

  function boilerplateHits(el) {
    var txt = (el.innerText || el.textContent || "").toLowerCase();
    var hits = 0;
    for (var i = 0; i < BOILER_COUNT.length; i++) {
      var m = txt.match(BOILER_COUNT[i]);
      if (m) hits += m.length;
    }
    return hits;
  }

  function densityBest() {
    var blocks = document.querySelectorAll("article, main, section, div");
    var scored = [];
    for (var i = 0; i < blocks.length; i++) {
      var b = blocks[i];
      if (b.querySelectorAll("p, li").length < 2) continue;
      var len = textLen(b);
      if (len < 200) continue;
      var score = len *
        (1 - linkDensity(b)) *
        (1 - repeatedChildRatio(b)) /
        (1 + boilerplateHits(b));
      if (score > 0) scored.push({ el: b, score: score });
    }
    if (!scored.length) return document.body;
    scored.sort(function (a, b) { return b.score - a.score; });
    var best = scored[0];
    // Prefer the most specific (innermost) block among the top scorers.
    for (var j = 1; j < scored.length; j++) {
      var cand = scored[j];
      if (cand.el !== best.el && best.el.contains(cand.el) && cand.score >= best.score * 0.85) {
        best = cand;
      }
    }
    return best.el;
  }

  function pickContentNode() {
    for (var i = 0; i < KNOWN_SELECTORS.length; i++) {
      var el = document.querySelector(KNOWN_SELECTORS[i]);
      if (el && textLen(el) > 200) return el;
    }
    var landmarks = document.querySelectorAll("article, main, [role='main']");
    var bestLandmark = null, bestScore = 0;
    for (var j = 0; j < landmarks.length; j++) {
      var s = textLen(landmarks[j]) * (1 - linkDensity(landmarks[j])) * (1 - repeatedChildRatio(landmarks[j]));
      if (s > bestScore) { bestScore = s; bestLandmark = landmarks[j]; }
    }
    if (bestLandmark && bestScore > 300) return bestLandmark;
    return densityBest();
  }

  // ---------- boilerplate stripping (operates on a CLONE) ----------
  var JUNK_SELECTORS = [
    "script", "style", "noscript", "svg", "iframe",
    "footer", "nav", '[role="navigation"]',
    '[class*="premium" i]', '[class*="upsell" i]',
    '[class*="similar-jobs" i]', '[class*="similar_jobs" i]',
    '[class*="people-also" i]', '[class*="people-you" i]',
    '[class*="about-the-company" i]', '[class*="company-module" i]',
    '[class*="jobs-company" i]', '[class*="job-alert" i]',
    '[aria-label*="job alert" i]', '[class*="footer" i]'
  ];

  var PHRASE_RE = /(try premium|get job alerts|people you can reach out to|are these results helpful|about the company|see jobs where|1-month free trial|job search faster with premium|your feedback helps|millions of other members|early applicant|company alumni work here|connections work here|school alumni work here|©\s*20)/i;

  function removeAfter(node, root) {
    var cur = node;
    while (cur && cur !== root && cur.parentNode) {
      var sib = cur.nextSibling;
      while (sib) {
        var next = sib.nextSibling;
        sib.parentNode.removeChild(sib);
        sib = next;
      }
      cur = cur.parentNode;
    }
    if (node.parentNode) node.parentNode.removeChild(node);
  }

  function cutAboutCompany(root) {
    var heads = root.querySelectorAll("h1,h2,h3,h4,h5,h6,strong,b");
    for (var i = 0; i < heads.length; i++) {
      if (/^about the company\b/i.test(clean(heads[i].textContent))) {
        removeAfter(heads[i], root);
        return;
      }
    }
  }

  function stripBoilerplate(root) {
    // 1) junk selectors
    var junk = root.querySelectorAll(JUNK_SELECTORS.join(","));
    for (var i = junk.length - 1; i >= 0; i--) {
      if (junk[i].parentNode) junk[i].parentNode.removeChild(junk[i]);
    }
    // 2) cut trailing "About the company"
    cutAboutCompany(root);
    // 3) small phrase-matching blocks
    var blocks = root.querySelectorAll("p,div,section,li,a,button,span,h2,h3,h4");
    for (var j = blocks.length - 1; j >= 0; j--) {
      var el = blocks[j];
      if (!el.parentNode) continue;
      if (textLen(el) < 300 && PHRASE_RE.test(el.textContent || "")) {
        el.parentNode.removeChild(el);
      }
    }
    return root;
  }

  function toMarkdown(node) {
    var clone = node.cloneNode(true);
    stripBoilerplate(clone);
    return window.jgHtmlToMarkdown(clone);
  }

  // ---------- public: auto extract ----------
  window.__jobGrabberExtractAuto = function () {
    var meta = getMetadata();
    var node = pickContentNode();
    meta.markdown = toMarkdown(node);
    return meta;
  };

  // ---------- public: manual picker ----------
  window.__jobGrabberStartPicker = function () {
    if (window.__jgPickerActive) return;
    window.__jgPickerActive = true;

    var overlay = document.createElement("div");
    overlay.style.cssText =
      "position:fixed;pointer-events:none;z-index:2147483646;" +
      "background:rgba(37,99,235,0.18);border:2px solid #2563eb;border-radius:3px;" +
      "transition:top .04s,left .04s,width .04s,height .04s;box-sizing:border-box;";
    document.documentElement.appendChild(overlay);

    var hint = document.createElement("div");
    hint.textContent = "Click the job description to capture  ·  Esc to cancel";
    hint.style.cssText =
      "position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:2147483647;" +
      "background:#111827;color:#fff;padding:8px 14px;border-radius:6px;" +
      "font:13px -apple-system,Segoe UI,sans-serif;box-shadow:0 2px 10px rgba(0,0,0,.35);";
    document.documentElement.appendChild(hint);

    var current = null;

    function onMove(e) {
      var el = e.target;
      if (!el || el === overlay || el === hint) return;
      current = el;
      var r = el.getBoundingClientRect();
      overlay.style.top = r.top + "px";
      overlay.style.left = r.left + "px";
      overlay.style.width = r.width + "px";
      overlay.style.height = r.height + "px";
    }
    function onKey(e) { if (e.key === "Escape") cleanup(); }
    function onClick(e) {
      e.preventDefault();
      e.stopPropagation();
      var el = current;
      cleanup();
      if (el) capture(el);
    }
    function cleanup() {
      document.removeEventListener("mousemove", onMove, true);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("keydown", onKey, true);
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      if (hint.parentNode) hint.parentNode.removeChild(hint);
      window.__jgPickerActive = false;
    }
    function capture(el) {
      var meta = getMetadata();
      meta.markdown = toMarkdown(el);
      meta.manual = true;
      meta.ts = Date.now();
      try {
        chrome.storage.local.set({ pendingCapture: meta }, function () {
          toast("Captured! Open Job Grabber to export.");
        });
      } catch (err) {
        toast("Capture failed: " + err.message);
      }
    }
    function toast(msg) {
      var t = document.createElement("div");
      t.textContent = msg;
      t.style.cssText =
        "position:fixed;bottom:22px;left:50%;transform:translateX(-50%);z-index:2147483647;" +
        "background:#16a34a;color:#fff;padding:10px 16px;border-radius:6px;" +
        "font:14px -apple-system,Segoe UI,sans-serif;box-shadow:0 2px 12px rgba(0,0,0,.35);";
      document.documentElement.appendChild(t);
      setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 2800);
    }

    document.addEventListener("mousemove", onMove, true);
    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKey, true);
  };

  // Test hook — exposes pure helpers for the regression harness. Harmless in prod.
  if (typeof window !== "undefined") {
    window.__jgTest = {
      refineTitleCompany: refineTitleCompany,
      repeatedChildRatio: repeatedChildRatio,
      PHRASE_RE: PHRASE_RE,
      AGGREGATORS: AGGREGATORS,
      SITE_NAME: SITE_NAME
    };
  }
})();
