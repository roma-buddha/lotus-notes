import fs from "node:fs/promises";
import assert from "node:assert/strict";
const manifest = JSON.parse(await fs.readFile("dist/.vite/manifest.json", "utf8"));
const seen = new Set();
function visit(key) {
  if (seen.has(key)) return;
  seen.add(key);
  for (const dependency of manifest[key].imports || []) visit(dependency);
}
visit("index.html");
let bytes = 0;
for (const key of seen) {
  assert.doesNotMatch(key, /editor|editTarget|AIChat|MarkdownView|mermaid|katex|mathSupport/i, `Unexpected startup dependency: ${key}`);
  bytes += (await fs.stat(`dist/${manifest[key].file}`)).size;
}
assert.ok(bytes < 600000, `Startup JavaScript grew to ${bytes} bytes`);
console.log(`Startup graph: ${seen.size} chunk(s), ${bytes} bytes; optional features remain lazy.`);
