/* Job Grabber — popup logic */
(function () {
  "use strict";

  var $ = function (id) { return document.getElementById(id); };

  var state = { title: "", company: "", location: "", url: "" };

  var LIB_FILES = ["src/lib/htmlToMarkdown.js", "src/lib/extractor.js"];

  // ---------- helpers ----------
  function setStatus(msg, kind) {
    var el = $("status");
    el.textContent = msg || "";
    el.className = "status" + (kind ? " " + kind : "");
  }

  function getTab() {
    return chrome.tabs.query({ active: true, currentWindow: true })
      .then(function (tabs) { return tabs[0]; });
  }

  function isInjectable(url) {
    return /^https?:\/\//i.test(url || "");
  }

  function slug(s) {
    return (s || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60);
  }

  function yamlValue(v) {
    v = (v || "").trim();
    if (v === "") return '""';
    // Quote if it contains YAML-significant characters or could be misread.
    if (/[:#\[\]{}&*!|>'"%@`,]/.test(v) || /^[-?]/.test(v) || /^\s|\s$/.test(v)) {
      return JSON.stringify(v);
    }
    return v;
  }

  function buildFrontmatter() {
    return [
      "---",
      "title: " + yamlValue(state.title),
      "company: " + yamlValue(state.company),
      "location: " + yamlValue(state.location),
      "source_url: " + yamlValue(state.url),
      "captured_at: " + new Date().toISOString(),
      "---"
    ].join("\n");
  }

  function buildDocument() {
    var heading = "";
    if (state.title) {
      heading = "# " + state.title + (state.company ? " — " + state.company : "") + "\n\n";
    }
    var body = $("md").value.trim();
    return buildFrontmatter() + "\n\n" + heading + body + "\n";
  }

  function refreshFrontmatterPreview() {
    $("fmPreview").textContent = buildFrontmatter();
  }

  function applyResult(data) {
    state.title = data.title || "";
    state.company = data.company || "";
    state.location = data.location || "";
    state.url = data.url || "";
    $("fTitle").value = state.title;
    $("fCompany").value = state.company;
    $("fLocation").value = state.location;
    $("md").value = data.markdown || "";
    refreshFrontmatterPreview();
  }

  function injectLibs(tabId) {
    return chrome.scripting.executeScript({ target: { tabId: tabId }, files: LIB_FILES });
  }

  // ---------- actions ----------
  function runAuto() {
    setStatus("Extracting…");
    return getTab().then(function (tab) {
      if (!tab || !isInjectable(tab.url)) {
        setStatus("Can't run here — open a job posting (http/https page).", "err");
        return;
      }
      return injectLibs(tab.id)
        .then(function () {
          return chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: function () { return window.__jobGrabberExtractAuto(); }
          });
        })
        .then(function (results) {
          var result = results && results[0] && results[0].result;
          if (!result || !result.markdown) {
            setStatus("No content found. Try “Select element”.", "err");
            return;
          }
          applyResult(result);
          setStatus("Auto-extracted. Review, then Copy or Download.", "ok");
        });
    }).catch(function (e) {
      setStatus("Error: " + e.message, "err");
    });
  }

  function startManual() {
    return getTab().then(function (tab) {
      if (!tab || !isInjectable(tab.url)) {
        setStatus("Can't run here — open a job posting (http/https page).", "err");
        return;
      }
      return injectLibs(tab.id)
        .then(function () {
          return chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: function () { window.__jobGrabberStartPicker(); }
          });
        })
        .then(function () {
          setStatus("Click the job section on the page, then reopen this popup.");
          setTimeout(function () { window.close(); }, 400);
        });
    }).catch(function (e) {
      setStatus("Error: " + e.message, "err");
    });
  }

  function copyOut() {
    var text = buildDocument();
    navigator.clipboard.writeText(text).then(function () {
      setStatus("Copied to clipboard.", "ok");
    }).catch(function (e) {
      setStatus("Copy failed: " + e.message, "err");
    });
  }

  function downloadOut() {
    var text = buildDocument();
    var name = (slug(state.title) || "job") +
      (state.company ? "-" + slug(state.company) : "") + ".md";
    var blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    chrome.downloads.download({ url: url, filename: name, saveAs: false })
      .then(function () {
        setStatus("Downloaded " + name, "ok");
        setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
      })
      .catch(function (e) {
        setStatus("Download failed: " + e.message, "err");
        URL.revokeObjectURL(url);
      });
  }

  function setMode(manual) {
    $("modeManual").classList.toggle("active", manual);
    $("modeAuto").classList.toggle("active", !manual);
  }

  // ---------- wire up ----------
  function bind() {
    $("fTitle").addEventListener("input", function (e) { state.title = e.target.value; refreshFrontmatterPreview(); });
    $("fCompany").addEventListener("input", function (e) { state.company = e.target.value; refreshFrontmatterPreview(); });
    $("fLocation").addEventListener("input", function (e) { state.location = e.target.value; refreshFrontmatterPreview(); });

    $("btnCopy").addEventListener("click", copyOut);
    $("btnDownload").addEventListener("click", downloadOut);
    $("btnReextract").addEventListener("click", function () { setMode(false); runAuto(); });

    $("modeAuto").addEventListener("click", function () { setMode(false); runAuto(); });
    $("modeManual").addEventListener("click", function () { setMode(true); startManual(); });
  }

  function init() {
    bind();
    // If a manual capture is pending from a previous picker session, load it.
    chrome.storage.local.get("pendingCapture").then(function (obj) {
      if (obj && obj.pendingCapture) {
        applyResult(obj.pendingCapture);
        setMode(true);
        setStatus("Loaded your selected capture. Review, then export.", "ok");
        chrome.storage.local.remove("pendingCapture");
      } else {
        runAuto();
      }
    }).catch(function () { runAuto(); });
  }

  document.addEventListener("DOMContentLoaded", init);
})();
