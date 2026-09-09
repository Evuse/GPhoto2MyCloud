const test = require("node:test");
const assert = require("node:assert/strict");
const {clampSettings, downloadState, photoId} = require("../extension/planner.js");

test("settings have safe defaults", () => {
  assert.deepEqual(clampSettings(), {
    destination: "/Volumes/MyCloud/GooglePhotos", downloadRoot: "~/Downloads",
    extractedFolder: "Media", keepArchives: false, batchSize: 250,
    clickDelayMs: 350, settleSeconds: 8, verifyCopies: true
  });
});

test("numeric settings stay inside supported limits", () => {
  const settings = clampSettings({batchSize: 9999, clickDelayMs: 1, settleSeconds: 999});
  assert.equal(settings.batchSize, 500);
  assert.equal(settings.clickDelayMs, 100);
  assert.equal(settings.settleSeconds, 120);
});

test("download state exposes errors before completion", () => {
  assert.equal(downloadState({state: "complete", error: "NETWORK_FAILED"}), "error");
  assert.equal(downloadState({state: "complete"}), "complete");
});

test("photo ids are stable across account and query URL variants", () => {
  assert.equal(photoId("https://photos.google.com/u/1/photo/AF1QipExample?key=value"), "AF1QipExample");
  assert.equal(photoId("/photo/AF1QipExample"), "AF1QipExample");
  assert.equal(photoId("https://photos.google.com/u/0/search/cats"), null);
});
