import { chromium } from "playwright";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";
const temp = await fs.mkdtemp(path.join(os.tmpdir(), "lotus-0120-test-"));
const root = path.join(temp, "workspace");
await fs.mkdir(path.join(root, "Work", "Notes"), { recursive: true });
await fs.mkdir(path.join(root, "Personal", "Journal"), { recursive: true });
const alpha = "Work/Notes/Alpha.md",
  beta = "Work/Notes/Beta.md";
const initial =
  "---\ntags: [test]\n---\n# Reading layout\n\n- Leading text in a long bullet item that must wrap cleanly beneath its own text without returning to the left of the bullet marker. This continuation is deliberately long so it wraps over several lines in a narrow pane.\n- Another list item.\n  - Nested text that must also align with itself on every wrapped line and retain a distinct indentation from its parent list item even when the pane is narrow.\n\n10. Numbered item with a longer marker and sufficient words to wrap across several visual lines without the number colliding with the text beneath it. Continue this same item until it wraps.\n\n> [!note] Interpretation\n> This callout needs balanced bottom padding.\n\n| Field | Value |\n| --- | --- |\n| Example | 49% |\n| Other | 51% |\n\nContext paragraph 1: ordinary information that stays in place.\n\nContext paragraph 2: ordinary information that stays in place.\n\nContext paragraph 3: ordinary information that stays in place.\n\nContext paragraph 4: ordinary information that stays in place.\n\nContext paragraph 5: ordinary information that stays in place.\n\nContext paragraph 6: ordinary information that stays in place.\n\nContext paragraph 7: ordinary information that stays in place.\n\nContext paragraph 8: ordinary information that stays in place.\n\nContext paragraph 9: ordinary information that stays in place.\n\nContext paragraph 10: ordinary information that stays in place.\n\nContext paragraph 11: ordinary information that stays in place.\n\nContext paragraph 12: ordinary information that stays in place.\n\nContext paragraph 13: ordinary information that stays in place.\n\nContext paragraph 14: ordinary information that stays in place.\n\nContext paragraph 15: ordinary information that stays in place.\n\nContext paragraph 16: ordinary information that stays in place.\n\nFocus anchorword stays here. Another anchorword must not be highlighted.\n\n[Other note](../../Personal/Journal/Beta.md)\n\n[Website](example.com)\n\nTrailing paragraph 1.\n\nTrailing paragraph 2.\n\nTrailing paragraph 3.\n\nTrailing paragraph 4.\n\nTrailing paragraph 5.\n\nTrailing paragraph 6.\n\nTrailing paragraph 7.\n\nTrailing paragraph 8.\n\n";
await fs.writeFile(path.join(root, alpha), initial);
await fs.writeFile(path.join(root, beta), "Beta text\n");
await fs.writeFile(
  path.join(root, "Personal/Journal/Beta.md"),
  "Other vault note\n",
);
await fs.writeFile(
  path.join(root, alpha),
  initial.replace(
    "# Reading layout",
    "Signed application: C:\\\\Users\\\\valer\\\\Downloads\\\\VeryLongDocumentName.pdf\n\n# Reading layout",
  ),
);
let browser, page, child, clipboardBefore;
const errors = [],
  checks = [];
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, label) {
  for (let i = 0; i < 100; i++) {
    if (await fn()) return;
    await pause(100);
  }
  throw Error(label);
}
async function menu(...labels) {
  for (const label of labels)
    await page.getByRole("menuitem", { name: label, exact: true }).click();
}
async function textRect(selector, needle) {
  return page.locator(selector).evaluate((el, needle) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const index = node.textContent.indexOf(needle);
      if (index >= 0) {
        const range = document.createRange();
        range.setStart(node, index);
        range.setEnd(node, index + needle.length);
        const r = range.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      }
    }
    throw Error("Text not found: " + needle);
  }, needle);
}
async function selectWord(
  needle,
  selector = '.primary-pane [aria-label="Note editor"]',
) {
  let r;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    r = await textRect(selector, needle);
    await page.mouse.move(r.x + 0.5, r.y + r.height / 2);
    await page.mouse.down();
    await page.mouse.move(r.x + r.width + 1, r.y + r.height / 2, {
      steps: 12,
    });
    await page.mouse.up();
    await pause(80);
    if (
      (await page.evaluate(() => window.getSelection()?.toString())) === needle
    )
      return r;
  }
  assert.equal(
    await page.evaluate(() => window.getSelection()?.toString()),
    needle,
    "Mouse selection: " + needle,
  );
  return r;
}
async function saved(note, predicate) {
  await until(async () => {
    try {
      return predicate(await fs.readFile(path.join(root, note), "utf8"));
    } catch (e) {
      if (e.code === "ENOENT") return false;
      throw e;
    }
  }, "File not saved: " + note);
}
try {
  child = spawn(
    process.env.NOTUS_EXECUTABLE ||
      path.resolve("src-tauri/target/debug/lotus.exe"),
    [],
    {
      windowsHide: true,
      env: {
        ...process.env,
        NOTUS_ROOT: root,
        WEBVIEW2_USER_DATA_FOLDER: path.join(temp, "webview"),
        WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: "--remote-debugging-port=9242",
      },
    },
  );
  await until(async () => {
    try {
      browser = await chromium.connectOverCDP("http://127.0.0.1:9242");
      return true;
    } catch {
      return false;
    }
  }, "Webview absent");
  await until(() => {
    page = browser
      .contexts()[0]
      .pages()
      .find((p) => /tauri.localhost|127.0.0.1:1420/.test(p.url()));
    return !!page;
  }, "Page absent");
  page.setDefaultTimeout(8000);
  page.on("pageerror", (e) => errors.push(e.message));
  clipboardBefore = await page.evaluate(() =>
    window.__TAURI_INTERNALS__.invoke("read_clipboard").catch(() => null),
  );

  await page
    .getByRole("button", { name: "Organize workspace", exact: true })
    .click();
  const org = page.getByRole("region", {
    name: "Workspace organizer",
    exact: true,
  });
  const searchBox = await org.getByLabel("Filter organizer").boundingBox(),
    heading = await org
      .locator(".organizer-area-group h3")
      .first()
      .boundingBox();
  assert.ok(
    searchBox.x <= heading.x + 2 && searchBox.y < heading.y,
    "Organizer search above its area groups",
  );
  await org.getByRole("button", { name: "Create vault", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Create vault", exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await org.getByRole("button", { name: "Expand all", exact: true }).click();
  await org
    .getByRole("button", { name: "Collapse all", exact: true })
    .waitFor();
  await org
    .locator(".explorer-vault summary")
    .filter({ hasText: "Work" })
    .click({ button: "right" });
  assert.deepEqual(
    await page.getByRole("menu").getByRole("menuitem").allTextContents(),
    ["Create folder", "Create note…", "Convert to folder…", "Vault settings"],
  );
  await page.keyboard.press("Escape");
  await page.locator('.organizer-note[title="' + alpha + '"]').click();
  const pane = page.locator(".primary-pane"),
    editor = page.locator('.primary-pane [aria-label="Note editor"]');
  await editor.waitFor();
  const pathLine = editor
    .locator(".code-aligned-left")
    .filter({ hasText: "Signed application" });
  assert.equal(await pathLine.count(), 1);
  assert.equal(
    await pathLine.evaluate((el) => getComputedStyle(el).textAlign),
    "left",
  );
  const nav = page.getByRole("navigation", { name: "Sidebar sections" });
  assert.equal(await nav.getByRole("button").count(), 5);
  assert.ok(
    (await nav.boundingBox()).y <
      (await page.locator(".files-toolbar").boundingBox()).y,
  );
  assert.ok(
    Math.abs(
      (await nav
        .locator("svg")
        .first()
        .evaluate((el) => el.getBoundingClientRect().width)) - 16,
    ) < 0.1,
  );
  assert.equal(
    await page.locator(".title-navigation").getByRole("button").count(),
    5,
  );
  await nav
    .getByRole("button", { name: "Find a note (Ctrl+P)", exact: true })
    .click();
  assert.equal(await page.locator(".file-tree .tree-row").count(), 0);
  assert.equal(await page.locator(".search-empty").count(), 1);
  await page
    .getByLabel("Find a note or folder", { exact: true })
    .fill("ordinary information");
  await page
    .locator(".note-search-results button")
    .filter({ hasText: "Alpha" })
    .waitFor();
  await page
    .getByLabel("Find a note or folder", { exact: true })
    .fill("Other vault note");
  await page
    .locator(".note-search-results button")
    .filter({ hasText: "Beta" })
    .click();
  assert.ok(
    (
      await page
        .getByRole("button", { name: "Choose vault", exact: true })
        .textContent()
    ).includes("Personal"),
  );
  assert.equal(
    await page
      .getByLabel("Find a note or folder", { exact: true })
      .inputValue(),
    "Other vault note",
  );
  await page
    .getByLabel("Find a note or folder", { exact: true })
    .fill("Signed application");
  await page
    .locator(".note-search-results button")
    .filter({ hasText: "Alpha" })
    .click();
  await until(
    async () =>
      (
        await page
          .getByRole("button", { name: "Choose vault", exact: true })
          .textContent()
      ).includes("Work"),
    "Opening a search result did not switch the current vault",
  );
  await nav.getByRole("button", { name: "Files", exact: true }).click();
  assert.ok(await page.locator('.tree-row[data-path="' + alpha + '"]').count());
  assert.equal(
    await page.getByRole("tab", { name: "Current note", exact: true }).count(),
    1,
  );
  await page
    .locator('.tree-row[data-path="' + alpha + '"]')
    .click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "Open in new tab", exact: true })
    .click();
  await page.getByRole("tab", { name: "Alpha", exact: true }).waitFor();
  await page
    .getByRole("tab", { name: "Alpha", exact: true })
    .click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "Close additional tabs", exact: true })
    .click();
  await until(
    async () =>
      (await page.getByRole("tab", { name: "Alpha", exact: true }).count()) ===
      0,
    "Additional tabs did not close",
  );
  checks.push(
    "Sidebar navigation, anchored Current note, close-additional-tabs, organizer areas and vault menu/create",
  );
  const list = editor.locator(".cm-hanging-list").first();
  const positions = await list.evaluate((el) => {
    const lines = new Map(),
      walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (n.parentElement.closest(".cm-live-list-marker")) continue;
      for (let i = 0; i < n.textContent.length; i++) {
        if (/\s/.test(n.textContent[i])) continue;
        const r = document.createRange();
        r.setStart(n, i);
        r.setEnd(n, i + 1);
        const b = r.getBoundingClientRect();
        if (b.width) {
          const y = Math.round(b.y);
          lines.set(y, Math.min(lines.get(y) ?? Infinity, b.x));
        }
      }
    }
    return [...lines.values()];
  });
  assert.ok(positions.length >= 2);
  assert.ok(
    Math.abs(positions[0] - positions[1]) < 3,
    "Wrapped list lines align: " + positions,
  );
  assert.ok(
    await editor
      .locator(".cm-callout-end")
      .evaluate((el) => parseFloat(getComputedStyle(el).paddingBottom) >= 16),
  );
  const table = page.locator(".editable-table");
  await table.scrollIntoViewIfNeeded();
  await table
    .getByRole("button", { name: "Select row 1", exact: true })
    .click();
  assert.equal(
    await page
      .locator(".editor > .cm-editor > .cm-scroller > .cm-cursorLayer")
      .evaluate((el) => getComputedStyle(el).display),
    "none",
  );
  const c1 = await table
    .locator('[data-row="1"][data-column="1"]')
    .boundingBox();
  const c2 = await table
    .locator('[data-row="2"][data-column="1"]')
    .boundingBox();
  await page.mouse.move(c1.x + 20, c1.y + 10);
  await page.mouse.down();
  await page.mouse.move(c2.x + 20, c2.y + 10, { steps: 8 });
  await page.mouse.up();
  assert.equal(await page.evaluate(() => window.getSelection().toString()), "");
  assert.equal(
    await table.locator('[data-column="0"].table-selected').count(),
    0,
  );
  assert.equal(
    await table.locator('[data-column="1"].table-selected').count(),
    2,
  );
  await page.screenshot({ path: "artifacts/lotus-0120-layout.png" });
  async function locate(needle) {
    for (let i = 0; i < 40; i++) {
      const line = editor
        .locator(".cm-line")
        .filter({ hasText: needle })
        .first();
      if (await line.count()) {
        await line.scrollIntoViewIfNeeded();
        return;
      }
      await pane.evaluate((el) => (el.scrollTop += 200));
      await pause(60);
    }
    throw Error("Cannot reveal " + needle);
  }
  await locate("Focus anchorword");
  let r = await selectWord("anchorword");
  assert.equal(await page.locator(".cm-selectionMatch").count(), 0);
  const originalY = r.y;
  for (const labels of [
    ["Format", "Bold"],
    ["Format", "Italic"],
    ["Format", "Highlight"],
    ["Text color", "Blue"],
    ["Format", "Clear formatting"],
  ]) {
    r = await selectWord("anchorword");
    const y = r.y;
    await page.mouse.click(r.x + 5, r.y + 5, { button: "right" });
    await menu(...labels);
    await pause(200);
    const after = await textRect(
      '.primary-pane [aria-label="Note editor"]',
      "anchorword",
    );
    assert.ok(
      Math.abs(after.y - y) < 1,
      "Formatting keeps passage in place " +
        labels +
        ": " +
        after.y +
        " vs " +
        y,
    );
  }
  assert.ok(
    Math.abs(
      (await textRect('.primary-pane [aria-label="Note editor"]', "anchorword"))
        .y - originalY,
    ) < 4,
  );
  r = await selectWord("anchorword");
  await page.mouse.click(r.x + 5, r.y + 5, { button: "right" });
  await menu("Insert", "Link", "Add link…");
  await page
    .getByLabel("Website or note path", { exact: true })
    .fill("../../Personal/Journal/Beta.md");
  await page.getByRole("button", { name: "Save link", exact: true }).click();
  await pause(150);
  assert.ok(
    Math.abs(
      (await textRect('.primary-pane [aria-label="Note editor"]', "anchorword"))
        .y - r.y,
    ) < 1,
    "Add link preserves position",
  );
  r = await selectWord("anchorword");
  await page.mouse.click(r.x + 5, r.y + 5, { button: "right" });
  await menu("Insert", "Link", "Remove link");
  await pause(150);
  assert.ok(
    Math.abs(
      (await textRect('.primary-pane [aria-label="Note editor"]', "anchorword"))
        .y - r.y,
    ) < 1,
    "Remove link preserves position",
  );
  checks.push(
    "Hanging lists, callout padding, no giant table caret, selection and formatting/link scroll stability",
  );
  await locate("Other note");
  const beforeTop = await pane.evaluate((el) => el.scrollTop);
  await editor
    .locator(".cm-note-link")
    .filter({ hasText: "Other note" })
    .click({ modifiers: ["Control"] });
  await until(
    async () =>
      (await page.locator(".primary-pane-wrap .note-title").inputValue()) ===
      "Beta",
    "Internal link opens tab",
  );
  assert.ok(
    (
      await page
        .getByRole("button", { name: "Choose vault", exact: true })
        .innerText()
    ).includes("Work"),
    "Link does not switch selected vault",
  );
  assert.equal(
    await page.getByRole("tab", { name: "Current note", exact: true }).count(),
    1,
  );
  await page.getByRole("tab", { name: "Current note", exact: true }).click();
  await pause(200);
  assert.ok(
    Math.abs((await pane.evaluate((el) => el.scrollTop)) - beforeTop) < 4,
    "Returning to tab restores position",
  );
  // Observe the immutable native bridge using a conditional debugger breakpoint.
  const websites = [];
  const debug = await page.context().newCDPSession(page);
  await debug.send("Debugger.enable");
  const bridge = await debug.send("Runtime.evaluate", {
    expression: "window.__TAURI_INTERNALS__.invoke",
  });
  await debug.send("Debugger.setBreakpointOnFunctionCall", {
    objectId: bridge.result.objectId,
    condition: 'arguments[0] === "open_external"',
  });
  debug.on("Debugger.paused", async (event) => {
    try {
      const result = await debug.send("Debugger.evaluateOnCallFrame", {
        callFrameId: event.callFrames[0].callFrameId,
        expression: "JSON.stringify(Array.from(arguments).slice(0,2))",
        returnByValue: true,
      });
      websites.push(JSON.parse(result.result.value)[1].url);
    } finally {
      await debug.send("Debugger.resume");
    }
  });
  await locate("Website");
  await editor
    .locator(".cm-note-link")
    .filter({ hasText: "Website" })
    .click({ modifiers: ["Control"] });
  await until(
    () => websites.length === 1,
    "Website dispatched through native bridge",
  );
  assert.deepEqual(websites, ["https://example.com/"]);
  await page
    .locator(".primary-pane-wrap")
    .getByRole("button", { name: "Lock note", exact: true })
    .click();
  await page.locator(".reading a").filter({ hasText: "Website" }).click();
  await until(() => websites.length === 2, "Locked website dispatched");
  await debug.detach();
  assert.equal(await page.locator(".error-banner").count(), 0);
  await page
    .locator(".primary-pane-wrap")
    .getByRole("button", { name: "Unlock note", exact: true })
    .click();
  checks.push(
    "Cross-vault links open tabs without vault changes; scroll return; browser bridge in editing and locked views",
  );
  await editor.waitFor();
  await saved(alpha, (t) => t.includes("Focus anchorword"));
  await fs.appendFile(path.join(root, alpha), "\nExternal update appeared.\n");
  await pane.evaluate((el) => (el.scrollTop = 1e6));
  await until(
    async () =>
      await editor
        .innerText()
        .then((t) => t.includes("External update appeared.")),
    "External edit refreshed",
  );
  await fs.mkdir(path.join(root, "Work", "Added outside"));
  await fs.writeFile(
    path.join(root, "Work", "Added outside", "New.md"),
    "Created externally\n",
  );
  await page.locator('.tree-row[data-path="Work/Added outside"]').waitFor();
  await fs.rename(
    path.join(root, "Work", "Notes"),
    path.join(root, "Work", "Renamed outside"),
  );
  await until(
    async () =>
      (await page.locator(".primary-pane-wrap .breadcrumb").count())
        ? await page
            .locator(".primary-pane-wrap .breadcrumb")
            .innerText()
            .then((t) => t.includes("Renamed outside"))
        : await page
            .locator(".primary-pane-wrap .note-heading")
            .innerText()
            .then((t) => t.includes("Renamed outside")),
    "Open note follows folder rename",
  );
  await page
    .locator('.tree-row[data-path="Work/Renamed outside/Alpha.md"]')
    .waitFor();
  await fs.rename(
    path.join(root, "Work", "Renamed outside", "Alpha.md"),
    path.join(root, "Work", "Renamed outside", "Moved.md"),
  );
  await until(
    async () =>
      (await page.locator(".primary-pane-wrap .note-title").inputValue()) ===
      "Moved",
    "Open tab follows note rename",
  );
  await fs.rm(path.join(root, "Work", "Added outside", "New.md"));
  await until(
    async () =>
      !(await page
        .locator('.tree-row[data-path="Work/Added outside/New.md"]')
        .count()),
    "Deleted file removed from tree",
  );
  await pane.evaluate((el) => (el.scrollTop = 0));
  await pause(100);
  await page.screenshot({ path: "artifacts/lotus-0120-final.png" });
  checks.push(
    "External edits/create/delete and stable-identity folder/note renames refresh open tabs and trees",
  );
  await editor.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.insertText(" LOCAL DRAFT");
  const changed = "Work/Renamed outside/Moved.md",
    disk = "External competing version.\n";
  await fs.writeFile(path.join(root, changed), disk);
  await until(
    async () =>
      (await page.locator(".error-banner").innerText()).includes("CONFLICT"),
    "External conflict detected",
  );
  assert.equal(await fs.readFile(path.join(root, changed), "utf8"), disk);
  assert.ok(
    (await editor.innerText()).includes("LOCAL DRAFT"),
    "Local draft retained",
  );
  await page
    .getByRole("button", { name: "Save recovery copy", exact: true })
    .click();
  await until(
    async () =>
      await page
        .locator(".primary-pane-wrap .note-title")
        .inputValue()
        .then((t) => t.includes("recovered")),
    "Recovery copy opened",
  );
  assert.equal(await fs.readFile(path.join(root, changed), "utf8"), disk);
  const recovery = (
    await fs.readdir(path.join(root, "Work/Renamed outside"))
  ).find((p) => p.includes("recovered"));
  assert.ok(
    (
      await fs.readFile(
        path.join(root, "Work/Renamed outside", recovery),
        "utf8",
      )
    ).includes("LOCAL DRAFT"),
  );
  const switchToDark = page.getByRole("button", {
    name: "Switch to dark theme",
    exact: true,
  });
  if (await switchToDark.count()) await switchToDark.click();
  await pane.evaluate((el) => (el.scrollTop = 0));
  await page.setViewportSize({ width: 760, height: 600 });
  await page.screenshot({ path: "artifacts/lotus-0120-dark-narrow.png" });
  const top = await page.locator(".title-navigation").boundingBox(),
    side = await page.locator(".sidebar").boundingBox();
  assert.ok(top.x + top.width <= side.x + side.width + 2);
  checks.push(
    "Conflicting external edits preserve both disk and local draft; recovery copy; dark/narrow navigation",
  );
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page
    .getByRole("button", { name: "Export / Import", exact: true })
    .click();
  assert.equal(
    await page.getByLabel("Include vaults, notes and attachments").isChecked(),
    true,
  );
  assert.equal(
    await page.getByLabel("Include Trash", { exact: true }).isChecked(),
    false,
  );
  await page.screenshot({ path: "artifacts/lotus-0120-transfer.png" });
  await page
    .getByRole("button", { name: "Close settings", exact: true })
    .click();
  await page.setViewportSize({ width: 1280, height: 840 });
  await page.getByRole("button", { name: "Choose vault", exact: true }).click();
  const picker = page.locator(".vault-picker-popup");
  assert.ok(
    Math.abs(
      (await picker.boundingBox()).x -
        (await page.locator(".sidebar").boundingBox()).width,
    ) < 2,
  );
  await page
    .getByRole("button", { name: "Settings for Work", exact: true })
    .click();
  assert.equal(await page.locator(".current-vault-area").count(), 0);
  assert.ok(
    (
      await page
        .getByRole("dialog", { name: "Vault settings", exact: true })
        .boundingBox()
    ).x >=
      (await picker.boundingBox()).x + (await picker.boundingBox()).width,
  );
  await page.screenshot({ path: "artifacts/lotus-0120-vaults.png" });
  await page.setViewportSize({ width: 760, height: 600 });
  await pause(150);
  const pop = await picker.boundingBox(),
    setting = await page
      .getByRole("dialog", { name: "Vault settings", exact: true })
      .boundingBox();
  assert.ok(pop.x >= (await page.locator(".sidebar").boundingBox()).width - 1);
  assert.ok(
    setting.x + setting.width <= 760 && setting.y + setting.height <= 600,
  );
  await page.screenshot({ path: "artifacts/lotus-0120-vaults-narrow.png" });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ root, checks, errors }, null, 2));
} catch (e) {
  if (page)
    await page
      .screenshot({ path: "artifacts/lotus-0120-failure.png" })
      .catch(() => {});
  console.error({ root, checks, errors });
  throw e;
} finally {
  if (page && typeof clipboardBefore === "string")
    await page
      .evaluate(
        (text) =>
          window.__TAURI_INTERNALS__.invoke("write_clipboard", { text }),
        clipboardBefore,
      )
      .catch(() => {});
  await browser?.close().catch(() => {});
  child?.kill();
}
