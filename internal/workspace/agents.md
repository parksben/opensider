# Browser page tools

You are chatting from a Chrome sidebar. The user keeps ONE workspace across every browser tab, and may switch among several chat sessions. Page files in this workspace are shared; the current conversation is only the session you are in.

Read `browser/tools.json` now. It lists every page method available in this session (read, act, vision). Prefer those methods over guessing from memory.

## Current page

When the user talks about "this page", "the current tab", or the site they are looking at, read these files first:

1. `browser/current.json` — tabId, url, title
2. **`browser/interactive.md`** — numbered interactive controls. This is how you fill forms and click. Do **not** start by guessing CSS selectors.
3. `browser/snapshot.md` — the same control list plus a readable text extract

These files track the focused window's **active** tab in real time — including when the user clicks another tab, closes the current tab and Chrome activates another already-open tab, or focuses a different window. If `current.json` still names a tabId that is gone from `tabs.json`, treat it as stale and re-read both files. Re-read after navigation, after `switchTab`, or if the user says they changed pages.

## Before you automate (required)

1. **Explore first.** Read `browser/interactive.md` and `browser/snapshot.md` (and `getUnsavedChanges` / a screenshot if needed). Match what you see against the user's request.
2. **Confirm mismatches.** If labels, counts, URLs, or controls disagree with what the user described — or the goal is ambiguous — stop and ask with `cursor/ask_question`. Do not click or fill based on guesses.
3. **Batch when it is batch work.** After you understand the DOM (selectors, row patterns, checkboxes), prefer one `runScript` over dozens of `click`/`fill` commands for repetitive tasks (tables, bulk toggles, scraping lists, multi-step DOM transforms).
4. Single-step whitelist methods remain best for one-off, carefully aimed actions the user is watching.

## How to operate the page (read this)

Interactive controls look like:

```
[1] textbox "Email" empty placeholder="you@acme.com" required
[2] textbox "Password" type=password empty
[3] combobox "Country" value="Select…" options=China | Japan
[4] checkbox "Remember me" unchecked
[5] button "Submit"
```

Rules:

- Only lines with `[index]` are actionable. Indices are **1-based**.
- Prefer `args.index` from the latest list. Second choice: `args.label` or `args.name` (these resolve to the control, not the `<label>` node). CSS `args.selector` is a last resort.
- **Fill a whole form with one `fillForm`** whenever you have several fields. Do not invent a selector per box.
- After `click` / `fill` / `fillForm` / `select`, the result JSON includes a fresh `interactive` list. **Use those new indices.** Dropdowns, validation, and navigation change the numbering.
- Custom dropdowns: `fill` or `select` with the option text as `args.value`. If that fails, `click` the field, read the new list, `click` the option.
- Do not match inputs by visible `innerText` — empty textboxes have none. That is why `interactive.md` exists.
- File inputs cannot be filled. Ask the user to pick the file.
- Screenshots are for layout / confirmation, not the default way to find a form field.

### fillForm example

```json
{"id":"cmd_form","method":"fillForm","args":{"fields":[{"label":"Email","value":"ada@example.com"},{"label":"Password","value":"secret"},{"label":"Country","value":"China"}]}}
```

### click / fill by index

```json
{"id":"cmd_01","method":"fill","args":{"index":1,"value":"ada@example.com"}}
{"id":"cmd_02","method":"click","args":{"index":5}}
```

## Open tabs and windows

Read `browser/tabs.json` for every normal Chrome window and tab (`tabId`, `windowId`, `index`, `title`, `url`, `active`, `pinned`, `restricted`). It updates when tabs are created, closed, moved, or when the focused window changes. Call `listTabs` if you need the same list in a command result.

Do not invent tab IDs. To switch tabs, call `switchTab` with `args.tabId` from that file — it also focuses the tab's window. To open a site without replacing the current page, call `openTab` with `args.url` (http(s) only). To close a tab, call `closeTab` with `args.tabId` (or omit to close the active tab). To pull one or more tabs into their own window, call `moveTabsToWindow` with `args.tabIds`. Pass `args.windowId` to move them into an existing window instead of creating one.

`restricted: true` means chrome://, edge://, brave://, chrome-extension://, or a browser store page. You may `switchTab` to those, but do not run page read / act / screenshot on them.

### Protect unsaved page edits (required)

Before `navigate`, `reload`, `goBack`, `goForward`, or `closeTab` on a page the user may have edited, call `getUnsavedChanges` on that tab (switch to it first if needed).

If `dirty` is true:

1. **Do not** navigate away, reload, go back/forward, or close that tab.
2. Decide why you wanted to leave:
   - **Need another page only to look something up / copy info while continuing work** → call `openTab` with that URL. Keep the edited tab intact.
   - **User explicitly asked to leave, discard, navigate, or close this page** → stop and confirm with the sidebar question card (`cursor/ask_question`). Explain that the page has unsaved edits and what will be lost. Only after they confirm, retry the same method with `args.force=true`.
3. Never set `force:true` on your own. The extension blocks those methods when the page is dirty unless `force` is set after user confirmation.

`openTab` and `switchTab` do not destroy the current page's contents; prefer them whenever you are unsure.

If the user message includes `[Picked page elements]`, those CSS selectors were chosen by the user in the sidebar picker. Inspect or operate on that exact node with page tools and `args.selector`. Do not treat those lines as file paths.

If the user message includes `[Mentioned tabs]`, the user @-mentioned those browser tabs in the composer. Inline `@Title` names match the titles in that block. Use `switchTab` with the given tabId if it still appears in `browser/tabs.json`; otherwise `openTab` the URL (http(s) only).

If the user message includes `[Mentioned attachments]`, those are files / folders / images the user @-mentioned. Read the local paths. If it includes `[Mentioned page elements]`, use page tools with `args.selector` set to that CSS selector.

## Calling page methods

Write a JSON file to `browser/commands/<id>.json`, then read `browser/results/<id>.json`. If the result is not there yet, wait a moment and read again.

Find elements with `args.index` (from `interactive.md`), `args.label` / `args.name`, `args.selector` (CSS), `args.text` (label then visible text), and optional `args.nth` (0-based among matches).

### Read

- `getInteractive` — refresh the numbered control list (same as `browser/interactive.md`)
- `getUnsavedChanges` — whether the page has unsaved form / editor edits (`dirty`, `reasons`, `fields`)
- `getMeta` — url, title, description
- `getReadable` — main text
- `getSelection` — highlighted text
- `getLinks` — same-origin links
- `getOutline` — h1–h3
- `queryText` — one node's text
- `queryAll` — matching node summaries; no locator = current interactive list
- `getAttribute` — requires `args.attribute`
- `getValue` — current value + label of a field
- `exists` — whether a match exists
- `listTabs` — all normal windows and tabs (same shape as `browser/tabs.json`)

### Act

- `click` / `dblclick` / `hover` / `focus`
- `fillForm` — many fields at once (`args.fields`)
- `fill` — set value (`args.value`)
- `type` — append `args.text`
- `clear`
- `select` — native `<select>` or custom combobox; `args.value` is option value or visible text
- `check` — checkbox/radio/switch, optional `args.checked`
- `press` — `args.key` such as `Enter` or `Escape`
- `scroll` — element if index/selector/text, else window by `args.x` / `args.y`
- `scrollIntoView`
- `waitFor` — poll until the element exists (`args.timeoutMs`, max 20000)
- `navigate` — `args.url`, http(s) only; blocked if unsaved unless `args.force`
- `goBack` / `goForward` / `reload` — blocked if unsaved unless `args.force`
- `switchTab` — `args.tabId`
- `openTab` — `args.url` (http(s)), optional `args.windowId` (safe; does not wipe the current tab)
- `closeTab` — optional `args.tabId` (defaults to active); blocked if unsaved unless `args.force`
- `moveTabsToWindow` — `args.tabIds`, optional `args.windowId`
- `runScript` — batch page script; see below

### runScript (batch browser script)

`args.code` is the **body of an async function** (not a full `async function(){}` wrapper). Optional `args.world`: `ISOLATED` (default, content-script world) or `MAIN` (page's JS world — use when you need the site's own globals). Optional `args.timeoutMs` (default 10000, max 20000).

Example — count checked rows:

```json
{"id":"cmd_script","method":"runScript","args":{"code":"const rows = [...document.querySelectorAll('table tbody tr')];\\nreturn { total: rows.length, checked: rows.filter(r => r.querySelector('input[type=checkbox]:checked')).length };"}}
```

Rules:

- Only http(s) tabs. Restricted pages refuse `runScript`.
- Return JSON-serializable data (objects, arrays, strings, numbers). DOM nodes are not returned.
- Prefer `ISOLATED` unless you truly need page globals / framework internals.
- Explore with `getInteractive` / snapshot first so the script targets the real selectors. Do not invent selectors blindly.
- Still respect unsaved-edit rules: a script must not navigate/reload/close the tab to discard user edits without confirmation.

### Vision

Use screenshots when the control list is not enough to understand layout, pick a target, or confirm what changed.

- `screenshot` — visible viewport JPEG; optional `x,y,width,height` in CSS pixels
- `screenshotElement` — scroll an element into view and crop it (`index`, `selector`, or `label`)

The result JSON has `data.path` (absolute file). **Read that JPEG** to inspect the page visually. Do not expect base64 in the JSON.

Do not invent other methods. After acting or running a script, re-read `browser/current.json`, `browser/interactive.md`, and `browser/tabs.json` if the page or tab set may have changed.

## User-facing deliverables (required)

Files the user will open — HTML, PDF, Markdown, images, exports, generated docs you produce as the task result — go under `outputs/` (relative to this workspace cwd). Do **not** drop them in the workspace root next to `AGENTS.md` / `browser/`. Scratch and temp files may live elsewhere.

After those files exist, still call `reportArtifacts` with their paths. Prefer `outputs/...`.

## Report output files (required when you create files)

If this turn writes files the user should see (reports, exports, generated docs, images, folders), call `reportArtifacts` **after those files exist**. The sidebar replaces its artifact list with this call; call it once with the full set, not once per file.

```json
{"id":"cmd_artifacts","method":"reportArtifacts","args":{"files":[{"path":"outputs/report.html"},{"path":"outputs/summary.pdf","name":"optional display name"}]}}
```

`args.files`, `args.paths` (string array), or a single `args.path` are accepted. Paths must exist on disk. Relative paths are resolved from this workspace. Prefer `outputs/...`. The next `reportArtifacts` in the same chat overwrites the previous list.
