import { chromium } from "playwright";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";

const temp = await fs.mkdtemp(path.join(os.tmpdir(), "lotus-startup-"));
const executable = process.env.NOTUS_EXECUTABLE || path.resolve("src-tauri/target/release/lotus.exe");
const counts = (process.env.LOTUS_BENCH_COUNTS || "100,10000,50000").split(",").map(Number);
const results = [];
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, timeout = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try { const value = await fn(); if (value) return value; } catch { /* Wait for this isolated WebView. */ }
    await pause(50);
  }
  throw new Error("Timed out waiting for benchmark app");
}
for (const count of counts) {
  const home = path.join(temp, String(count));
  const root = path.join(home, "Vaults");
  await fs.mkdir(path.join(home, ".lotus-state"), { recursive: true });
  await fs.writeFile(path.join(home, ".lotus-state/layout.json"), JSON.stringify({ version: 1, moves: [] }));
  for (let start = 0; start < count; start += 250) {
    const folder = path.join(root, "Bench", `Folder${String(start / 250).padStart(4, "0")}`);
    await fs.mkdir(folder, { recursive: true });
    await Promise.all(Array.from({ length: Math.min(250, count - start) }, (_, i) => fs.writeFile(path.join(folder, `Note${String(start + i).padStart(6, "0")}.md`), `# Note ${start + i}\n\nBenchmark text.\n`)));
  }
  for (const mode of ["cold", "cached"]) {
    let browser;
    const launched = Date.now();
    const child = spawn(executable, [], { windowsHide: true, env: { ...process.env, NOTUS_ROOT: home, WEBVIEW2_USER_DATA_FOLDER: path.join(home, "webview"), WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: "--remote-debugging-port=9342" } });
    try {
      browser = await until(() => chromium.connectOverCDP("http://127.0.0.1:9342"));
      const page = await until(() => browser.contexts()[0]?.pages().find(page => /tauri.localhost/.test(page.url())));
      page.setDefaultTimeout(30000);
      const errors = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.waitForFunction(() => performance.getEntriesByName("lotus-vaults-ready").length > 0);
      await page.getByRole("button", { name: "Choose vault", exact: true }).click();
      await page.locator(".vault-option-name").filter({ hasText: "Bench" }).click();
      const expand = page.getByRole("button", { name: "Expand Folder0000", exact: true });
      await until(async () => await expand.count() || await page.getByRole("button", { name: "Collapse Folder0000", exact: true }).count());
      if (await expand.count()) await expand.click();
      const note = page.locator('.tree-row[data-path="Bench/Folder0000/Note000000.md"] .tree-select');
      await note.waitFor();
      await note.click();
      await page.locator(".cm-content").waitFor();
      await page.waitForFunction(() => performance.getEntriesByName("lotus-note-editable").length > 0);
      const timings = await page.evaluate(() => {
        const mark = name => performance.getEntriesByName(name).at(-1)?.startTime;
        return { timeOrigin: performance.timeOrigin, shell: mark("lotus-shell-ready"), workspace: mark("lotus-workspace-ready"), vaults: mark("lotus-vaults-ready"), editable: mark("lotus-note-editable"), noteRequest: mark("lotus-note-request") };
      });
      // Native note I/O while background indexing continues; do not rewrite user files.
      const native = await page.evaluate(async () => {
        const invoke = window.__TAURI_INTERNALS__.invoke;
        const state = await invoke("workspace_bootstrap");
        const start = performance.now();
        const note = await invoke("read_note", { generation: state.generation, path: "Bench/Folder0000/Note000000.md" });
        await invoke("write_note", { generation: state.generation, path: note.path, content: note.content, revision: note.revision });
        let rejected = false;
        try { await invoke("write_note", { generation: state.generation + 1, path: note.path, content: "must not write", revision: note.revision }); } catch { rejected = true; }
        return { readSaveMs: performance.now() - start, obsoleteWriteRejected: rejected };
      });
      assert.equal(native.obsoleteWriteRejected, true);
      if (count === counts[0] && mode === "cold") {
        await page.evaluate(() => window.__TAURI_INTERNALS__.invoke("detach_note", { path: "Bench/Folder0000/Note000000.md", atCursor: false }));
        const detached = await until(() => browser.contexts()[0].pages().find(candidate => candidate.url().includes("?note=")));
        detached.on("pageerror", error => errors.push(error.message));
        await detached.locator(".cm-content").waitFor({ timeout: 15000 });
        assert.equal(await detached.evaluate(() => performance.getEntriesByName("lotus-vaults-ready").length), 0, "Detached note must not scan directories");
        native.detachedNoteWithoutScan = true;
      }
      assert.deepEqual(errors, []);
      results.push({ count, mode, processToShellMs: Math.round(timings.timeOrigin + timings.shell - launched), webviewToShellMs: Math.round(timings.shell), vaultsMs: Math.round(timings.vaults), firstNoteMs: Math.round(timings.editable - timings.noteRequest), ...native });
      console.log(JSON.stringify(results.at(-1)));
    } finally {
      await browser?.close().catch(() => {});
      child.kill();
      await new Promise(resolve => { if (child.exitCode !== null) resolve(); else child.once("exit", resolve); });
      await pause(500);
    }
  }
}
await fs.mkdir("artifacts", { recursive: true });
await fs.writeFile("artifacts/startup-benchmark.json", JSON.stringify({ executable, fixture: temp, results }, null, 2));
console.log(`Disposable fixture retained for inspection: ${temp}`);
