(function (root) {
  "use strict";

  function clampSettings(value) {
    const input = value || {};
    return {
      destination: String(input.destination || "/Volumes/MyCloud/GooglePhotos"),
      downloadRoot: String(input.downloadRoot || "~/Downloads"),
      extractedFolder: String(input.extractedFolder || "Media"),
      keepArchives: input.keepArchives === true,
      batchSize: Math.min(500, Math.max(1, Number(input.batchSize) || 250)),
      clickDelayMs: Math.min(3000, Math.max(100, Number(input.clickDelayMs) || 350)),
      settleSeconds: Math.min(120, Math.max(2, Number(input.settleSeconds) || 8)),
      retryDelaySeconds: Math.min(300, Math.max(2, Number(input.retryDelaySeconds) || 10)),
      downloadTimeoutMinutes: Math.min(120, Math.max(2, Number(input.downloadTimeoutMinutes) || 20)),
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

  function retryAfterFailure(batchSize, failures, baseDelaySeconds) {
    return {
      batchSize: Math.max(1, Math.floor(batchSize / 2)),
      delaySeconds: Math.min(300, baseDelaySeconds * (2 ** Math.min(5, Math.max(0, failures - 1))))
    };
  }

  function batchAfterSuccess(batchSize, configuredMaximum) {
    return Math.min(configuredMaximum, Math.max(batchSize + 1, Math.floor(batchSize * 1.5)));
  }

  const api = {clampSettings, downloadState, photoId, retryAfterFailure, batchAfterSuccess};
  root.GPhotoPlanner = api;
  if (typeof module !== "undefined") module.exports = api;
})(typeof globalThis === "undefined" ? this : globalThis);
