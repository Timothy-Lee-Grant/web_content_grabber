/* Job Grabber — self-contained HTML -> Markdown converter.
 * Walks a DOM subtree and emits clean Markdown. No external dependencies.
 * Exposes window.jgHtmlToMarkdown(rootElement) -> string
 */
(function () {
  "use strict";

  var SKIP = {
    script: 1, style: 1, noscript: 1, svg: 1, iframe: 1, canvas: 1,
    nav: 1, footer: 1, header: 1, aside: 1, form: 1, button: 1,
    select: 1, input: 1, textarea: 1, video: 1, audio: 1
  };

  function collapse(s) {
    return s.replace(/\s+/g, " ");
  }

  function isHidden(el) {
    if (!el || !el.getAttribute) return false;
    if (el.getAttribute("aria-hidden") === "true") return true;
    if (el.hidden) return true;
    var style = el.getAttribute("style") || "";
    if (/display\s*:\s*none/i.test(style) || /visibility\s*:\s*hidden/i.test(style)) return true;
    return false;
  }

  function inline(node) {
    return collapse(processChildren(node)).trim();
  }

  function processChildren(node) {
    var out = "";
    var kids = node.childNodes;
    for (var i = 0; i < kids.length; i++) {
      out += processNode(kids[i]);
    }
    return out;
  }

  function listToMd(node, ordered) {
    var items = [];
    var idx = 1;
    var kids = node.childNodes;
    for (var i = 0; i < kids.length; i++) {
      var c = kids[i];
      if (c.nodeType === 1 && c.tagName.toLowerCase() === "li") {
        if (isHidden(c)) continue;
        var content = processChildren(c).trim().replace(/\n{2,}/g, "\n");
        if (!content) continue;
        var marker = ordered ? idx + ". " : "- ";
        var pad = ordered ? "   " : "  ";
        var lines = content.split("\n");
        var rendered = lines
          .map(function (l, j) { return j === 0 ? marker + l : pad + l; })
          .join("\n");
        items.push(rendered);
        idx++;
      }
    }
    return items.join("\n");
  }

  function tableToMd(node) {
    var rows = [];
    var trs = node.querySelectorAll("tr");
    for (var i = 0; i < trs.length; i++) {
      var cells = trs[i].querySelectorAll("th,td");
      if (!cells.length) continue;
      var row = [];
      for (var j = 0; j < cells.length; j++) {
        row.push(inline(cells[j]).replace(/\|/g, "\\|").replace(/\n/g, " "));
      }
      rows.push(row);
    }
    if (!rows.length) return "";
    var header = rows[0];
    var md = "| " + header.join(" | ") + " |\n";
    md += "| " + header.map(function () { return "---"; }).join(" | ") + " |\n";
    for (var k = 1; k < rows.length; k++) {
      md += "| " + rows[k].join(" | ") + " |\n";
    }
    return md;
  }

  function processNode(node) {
    if (node.nodeType === 3) {
      return collapse(node.textContent);
    }
    if (node.nodeType !== 1) return "";

    var tag = node.tagName.toLowerCase();
    if (SKIP[tag]) return "";
    if (isHidden(node)) return "";

    switch (tag) {
      case "h1": return "\n\n# " + inline(node) + "\n\n";
      case "h2": return "\n\n## " + inline(node) + "\n\n";
      case "h3": return "\n\n### " + inline(node) + "\n\n";
      case "h4": return "\n\n#### " + inline(node) + "\n\n";
      case "h5": return "\n\n##### " + inline(node) + "\n\n";
      case "h6": return "\n\n###### " + inline(node) + "\n\n";
      case "p": {
        var p = inline(node);
        return p ? "\n\n" + p + "\n\n" : "";
      }
      case "br": return "  \n";
      case "hr": return "\n\n---\n\n";
      case "strong":
      case "b": {
        var bt = inline(node);
        return bt ? "**" + bt + "**" : "";
      }
      case "em":
      case "i": {
        var it = inline(node);
        return it ? "*" + it + "*" : "";
      }
      case "code": {
        if (node.closest && node.closest("pre")) return processChildren(node);
        var ct = node.textContent.trim();
        return ct ? "`" + ct + "`" : "";
      }
      case "pre": {
        var code = node.textContent.replace(/\n+$/, "");
        return "\n\n```\n" + code + "\n```\n\n";
      }
      case "a": {
        var label = inline(node);
        if (!label) return "";
        var href = (node.getAttribute("href") || "").trim();
        if (!href || /^javascript:/i.test(href) || href.charAt(0) === "#") return label;
        return "[" + label + "](" + href + ")";
      }
      case "ul": return "\n\n" + listToMd(node, false) + "\n\n";
      case "ol": return "\n\n" + listToMd(node, true) + "\n\n";
      case "li": return processChildren(node);
      case "blockquote": {
        var q = inline(node);
        if (!q) return "";
        return "\n\n" + q.split("\n").map(function (l) { return "> " + l; }).join("\n") + "\n\n";
      }
      case "table": return "\n\n" + tableToMd(node) + "\n\n";
      case "img": {
        var alt = (node.getAttribute("alt") || "").trim();
        var src = (node.getAttribute("src") || "").trim();
        if (!src) return "";
        return "![" + alt + "](" + src + ")";
      }
      default:
        return processChildren(node);
    }
  }

  // Section labels that job boards render inline as bold; promote to headings.
  var LABELS = [
    "About the job", "About the role", "About this role", "About the position",
    "Overview", "Summary", "The role", "Job description",
    "Responsibilities", "Key responsibilities", "What you'll do",
    "What you will do", "What you'll be doing", "Duties",
    "Qualifications", "Required Qualifications", "Minimum Qualifications",
    "Basic Qualifications", "Preferred Qualifications", "Other Requirements",
    "Requirements", "Skills", "Experience",
    "Benefits", "Perks", "Compensation", "What we offer", "Nice to have"
  ];

  function promoteLabels(md) {
    for (var i = 0; i < LABELS.length; i++) {
      var label = LABELS[i];
      var esc = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      // **Label** (with optional trailing colon / glued text) -> ### Label
      var re = new RegExp("\\*\\*\\s*" + esc + "\\s*:?\\s*\\*\\*\\s*:?\\s*", "gi");
      md = md.replace(re, "\n\n### " + label + "\n\n");
    }
    return md;
  }

  function postProcess(md) {
    md = promoteLabels(md);
    // Bold label glued directly to following sentence: "**X**As ..." -> break.
    md = md.replace(/\*\*([^*\n]{2,80})\*\*(?=[A-Z])/g, "**$1**\n\n");
    // Inline " - " enumerations after a sentence -> real bullet lines.
    md = md.replace(/([.\w])\s-\s(?=[A-Z][a-z])/g, "$1\n- ");
    return md;
  }

  function htmlToMarkdown(root) {
    if (!root) return "";
    var md = processNode(root);
    md = md.replace(/[ \t]+\n/g, function (m) {
      // preserve markdown hard breaks (two trailing spaces) but trim other trailing space
      return m.indexOf("  \n") === 0 ? "  \n" : "\n";
    });
    md = postProcess(md);
    md = md.replace(/\n{3,}/g, "\n\n").trim();
    return md;
  }

  window.jgHtmlToMarkdown = htmlToMarkdown;
})();
