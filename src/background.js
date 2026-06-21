/* Job Grabber — background service worker (MV3).
 * Kept intentionally minimal: extraction, conversion, and downloads are
 * handled from the popup. This worker is here for lifecycle hooks and any
 * future cross-context messaging.
 */
chrome.runtime.onInstalled.addListener(function (details) {
  if (details.reason === "install") {
    console.log("[Job Grabber] installed.");
  }
});
