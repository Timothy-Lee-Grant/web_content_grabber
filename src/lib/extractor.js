/* Job Grabber — content extraction + metadata + manual element picker.
 * Runs in the page (injected via chrome.scripting.executeScript).
 * Depends on window.jgHtmlToMarkdown (htmlToMarkdown.js).
 * Exposes:
 *   window.__jobGrabberExtractAuto()  -> { title, company, location, url, markdown }
 *   window.__jobGrabberStartPicker()  -> starts click-to-select; stores result in chrome.storage.local
 */
(function () {
  "use strict";

  function clean(s) {
    return (s || "").replace(/\s+/g, " ").trim();
  }

  function metaContent(selector) {
    var el = document.querySelector(selector);
    return el ? clean(el.getAttribute("content")) : "";
  }

  function getJsonLdJob() {
    var scripts = document.querySelectorAll('script[type="application/ld+json"]');
    for (var i = 0; i < scripts.length; i++) {
      var data;
      try {
        data = JSON.parse(scripts[i].textContent);
      } catch (e) {
        continue;
      }
      var list = [];
      if (Array.isArray(data)) list = data;
      else if (data && data["@graph"]) list = data["@graph"];
      else list = [data];
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

    if (!title) title = metaContent('meta[property="og:title"]');
    if (!title) {
      var h1 = document.querySelector("h1");
      if (h1) title = clean(h1.innerText || h1.textContent);
    }
    if (!title) title = clean(document.title);

    if (!company) company = metaContent('meta[property="og:site_name"]');
    if (!company) {
      // hostname as a weak fallback, e.g. "boards.greenhouse.io" -> "greenhouse"
      try {
        var host = location_host();
        if (host) company = host;
      } catch (e) {}
    }

    return {
      title: title,
      company: company,
      location: location,
      url: window.location.href
    };
  }

  function location_host() {
    var parts = window.location.hostname.replace(/^www\./, "").split(".");
    if (parts.length >= 2) return parts[parts.length - 2];
    return parts[0] || "";
  }

  // ---- content node selection ----

  // Known job-board containers, tried first.
  var KNOWN_SELECTORS = [
    '[data-automation-id="jobPostingDescription"]', // Workday
    "#jobDescriptionText",                           // Indeed
    ".show-more-less-html__markup",                  // LinkedIn (public)
    ".description__text",                            // LinkedIn
    ".jobs-description__content",                    // LinkedIn (logged in)
    ".job-description",
    "#job-description",
    ".posting-description",                          // Lever
    ".section-wrapper.page-full-width",              // Lever
    '[class*="JobDescription"]',
    '[class*="jobDescription"]',
    "article[role='article']"
  ];

  function linkDensity(el) {
    var total = (el.innerText || el.textContent || "").length || 1;
    var linkLen = 0;
    var links = el.querySelectorAll("a");
    for (var i = 0; i < links.length; i++) {
      linkLen += (links[i].innerText || links[i].textContent || "").length;
    }
    return linkLen / total;
  }

  function textLen(el) {
    return clean(el.innerText || el.textContent || "").length;
  }

  function pickContentNode() {
    // 1) known selectors
    for (var i = 0; i < KNOWN_SELECTORS.length; i++) {
      var el = document.querySelector(KNOWN_SELECTORS[i]);
      if (el && textLen(el) > 150) return el;
    }
    // 2) semantic landmarks
    var landmarks = document.querySelectorAll("article, main, [role='main']");
    var bestLandmark = null, bestLandmarkScore = 0;
    for (var j = 0; j < landmarks.length; j++) {
      var s = textLen(landmarks[j]) * (1 - linkDensity(landmarks[j]));
      if (s > bestLandmarkScore) { bestLandmarkScore = s; bestLandmark = landmarks[j]; }
    }
    if (bestLandmark && bestLandmarkScore > 300) return bestLandmark;

    // 3) generic density scan
    var blocks = document.querySelectorAll("article, main, section, div");
    var best = document.body, bestScore = 0;
    for (var k = 0; k < blocks.length; k++) {
      var b = blocks[k];
      var paras = b.querySelectorAll("p, li");
      if (paras.length < 2) continue;
      var len = textLen(b);
      if (len < 200) continue;
      var score = len * (1 - linkDensity(b));
      if (score > bestScore) { bestScore = score; best = b; }
    }
    return best;
  }

  // ---- public: auto extract ----
  window.__jobGrabberExtractAuto = function () {
    var meta = getMetadata();
    var node = pickContentNode();
    var markdown = window.jgHtmlToMarkdown(node);
    meta.markdown = markdown;
    return meta;
  };

  // ---- public: manual picker ----
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

    function onKey(e) {
      if (e.key === "Escape") { cleanup(); }
    }

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
      meta.markdown = window.jgHtmlToMarkdown(el);
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
})();
