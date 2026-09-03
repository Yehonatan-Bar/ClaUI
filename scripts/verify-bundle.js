// Fail the build if webpack did not produce a usable extension bundle.
//
// This runs as part of the `vscode:prepublish` npm script, so it guards BOTH
// `vsce package` (local deploy) and `vsce publish` (marketplace) against
// shipping a .vsix whose dist/extension.js is missing or truncated. That is
// the exact failure mode that leaves an installed extension unable to
// activate ("Cannot find module ...dist/extension.js"), so we catch it here
// before anything is packaged or uploaded.

const fs = require("fs");
const path = require("path");

const bundlePath = path.join(__dirname, "..", "dist", "extension.js");

// The production bundle is well over 1 MB. Anything tiny means webpack did not
// finish emitting the bundle (partial build, interrupted process, etc.).
const minBytes = 200 * 1024;

// A string literal that survives minification (also asserted by
// verify-installed.ps1). Its presence confirms the real bundle, not a stub.
const sentinel = "claudeMirror.groups.create";

if (!fs.existsSync(bundlePath)) {
  console.error(
    `[verify-bundle] FAIL: ${bundlePath} does not exist. Webpack did not emit the extension bundle.`
  );
  process.exit(1);
}

const bundleSizeBytes = fs.statSync(bundlePath).size;
if (bundleSizeBytes < minBytes) {
  console.error(
    `[verify-bundle] FAIL: ${bundlePath} is only ${bundleSizeBytes} bytes ` +
      `(expected > ${minBytes}). This looks like a broken or partial build.`
  );
  process.exit(1);
}

const bundleContents = fs.readFileSync(bundlePath, "utf8");
if (!bundleContents.includes(sentinel)) {
  console.error(
    `[verify-bundle] FAIL: ${bundlePath} does not contain the sentinel ` +
      `"${sentinel}". The bundle is incomplete or corrupt.`
  );
  process.exit(1);
}

console.log(
  `[verify-bundle] OK: dist/extension.js present ` +
    `(${Math.round(bundleSizeBytes / 1024)} KB) and contains the expected sentinel.`
);
