(function (root) {
  "use strict";

  function clampSettings(value) {
    const input = value || {};
    return {
      destination: String(input.destination || "/Volumes/MyCloud/GooglePhotos"),
      downloadRoot: String(input.downloadRoot || "~/Downloads"),
      extractedFolder: String(input.extractedFolder || "Media"),
      keepArchives: input.keepArchives === true,
      rangeSelection: input.rangeSelection !== false,
      batchSize: Math.min(500, Math.max(1, Number(input.batchSize) || 250)),
      clickDelayMs: Math.min(3000, Math.max(100, Number(input.clickDelayMs) || 350)),
      settleSeconds: Math.min(120, Math.max(2, Number(input.settleSeconds) || 8)),
      verifyCopies: input.verifyCopies !== false
    };
  }

  function downloadState(download) {
    if (!download) return "waiting";
    if (download.error) return "error";
    if (download.state === "complete") return "complete";
    return "downloading";
  }

  function photoId(href, base = "https://photos.google.com/") {
    try {
      return new URL(href, base).pathname.match(/\/photo\/([^/?#]+)/)?.[1] || null;
    } catch (_error) {
      return null;
    }
  }

  const api = {clampSettings, downloadState, photoId};
  root.GPhotoPlanner = api;
  if (typeof module !== "undefined") module.exports = api;
})(typeof globalThis === "undefined" ? this : globalThis);
