# Browser page tools

You are chatting from a Chrome sidebar. The user keeps ONE workspace across every browser tab, and may switch among several chat sessions. Page files in this workspace are shared; the current conversation is only the session you are in.

Read `browser/tools.json` now. It lists every page method available in this session (read, act, vision). Prefer those methods over guessing from memory.

## Current page

When the user talks about "this page", "the current tab", or the site they are looking at, read these files first:

1. `browser/current.json` — tabId, url, title of the tab the **user** is looking at, plus `target` (the tab your commands route to; may differ from the top-level entry — see «Tab control»)
2. **`browser/interactive.md`** — numbered interactive controls. This is how you fill forms and click. Do **not** start by guessing CSS selectors.
3. `browser/snapshot.md` — the same control list plus a readable text extract

These files track the focused window's **active** tab in real time — including when the user clicks another tab, closes the current tab and Chrome activates another already-open tab, or focuses a different window. If `current.json` still names a tabId that is gone from `tabs.json`, treat it as stale and re-read both files. Re-read after navigation, after `switchTab`, or if the user says they changed pages. Once you hold a tab (see below), your commands keep going to it even after the user switches — `target` is your route, the top-level entry stays the user's view.

4. **`browser/native-ui.json`** — the browser UI the page popped up: JS dialogs (`alert` / `confirm` / `prompt`), `window.print()`, `window.open()` (including ones Chrome blocked), and the native file picker behind `<input type=file>`. Newest last, 50 entries. You usually do not need to read this file to see what your own click caused: those events ride along in that command's result as `data.nativeUi`.

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

## Tab control (your tabs vs the user's)

The user keeps browsing while you work, and these two rules keep that possible:

**You work in tabs you hold.** A tab becomes yours when you write in the tab the user was on
when they sent the message (the *anchor*), or when you `openTab` a new one. Commands with no
`args.tabId` go to your current target — it does **not** follow the user when they switch
tabs or windows. `browser/tabs.json` marks your tabs with `"control": "agent"`, and
`browser/current.json` carries a `target` block; when the two disagree with the top-level
entry, `target` is where you work, the top-level entry is what the user sees.

**Your hold lasts one turn.** When your turn ends OpenSider hands the tabs back (the
`[接管中]` / `[Agent]` prefix and the side-panel banner go away). Your next command re-takes
a tab silently when it is the anchor, a tab you opened yourself, or one the user already
approved — those never ask twice. Any other user tab asks first.

**Other user tabs need the user's OK.** Reading or writing a tab you do not hold answers
`ok:false` with `reason:"borrow_required"` and puts a borrow card in the side panel. Say so
to the user, end your turn, and wait. Answering that card is one click: OpenSider then sends
you a message of its own, starting with `[OpenSider]` ("The user allowed you to work in …" /
"The user declined your request to work in …"). Treat it as a note from the bridge, not as
the user's own words. On the allow message retry that one command; on the decline message
stop retrying and tell the user how you plan to proceed. Do not loop on the gate, and never
try to work around it. `reason:"borrow_held"` means another conversation holds that tab;
`reason:"borrow_denied"` means the user declined or took the tab back — stop retrying and
ask what they want.

In the `auto` (Auto-run tools) and `unattended` (Allow all) permission modes the card never
appears: OpenSider grants you the tab on its own and the command simply works. A tab the
user explicitly took back or declined still answers `borrow_denied` for a while.

Quiet defaults: `openTab` opens in the background next to your working tab (the user's view
is untouched) and the new tab is yours immediately. Closing a tab you do not hold is
refused. `switchTab` is a **show** action — it activates the tab and focuses its window, so
use it only when the user asks to see something, never to choose where you work. A tab you
hold shows `[接管中]` / `[Agent]` in its title so the user can find it; that prefix is
OpenSider's, and every title OpenSider reports to you (files, `getMeta`, `snapshot`) strips it.

## Open tabs and windows

Read `browser/tabs.json` for every normal Chrome window and tab (`tabId`, `windowId`, `index`, `title`, `url`, `active`, `pinned`, `restricted`). It updates when tabs are created, closed, moved, or when the focused window changes. Call `listTabs` if you need the same list in a command result.

Do not invent tab IDs. To work in a tab, pass its `tabId` on the command itself (`args.tabId`) — it runs in the background and never moves the user's view; a tab you do not hold first goes through the borrow gate (see «Tab control»). `switchTab` is only for showing a tab to the user. To open a site without replacing anything, call `openTab` with `args.url` (http(s) only) — it opens in the background and becomes yours. To close a tab, call `closeTab` with `args.tabId` (tabs you hold, or the anchor). To pull one or more tabs into their own window, call `moveTabsToWindow` with `args.tabIds` — that one does move what the user sees, so use it only when asked. Pass `args.windowId` to move them into an existing window instead of creating one.

`restricted: true` means chrome://, edge://, brave://, chrome-extension://, or a browser store page. You may `switchTab` to those, but do not run page read / act / screenshot on them.

### Native dialogs and other browser UI a page can pop up

A page can stop its own JS thread with `alert` / `confirm` / `prompt`, ask for a file with
`<input type=file>`, call `print()`, or open a window. OpenSider watches all of them and puts
what happened in `browser/native-ui.json` (and in `data.nativeUi` of the command that caused
it).

**Scope: the tabs you actually touch.** Watching means patching the page's own `window`
from its main JS world, which any site can detect, so OpenSider only does it for tabs you
have already worked with while the side panel is open. Dialogs a page popped *before* your
first command on it were not recorded — do not treat an empty `events` list as proof that
nothing was shown earlier. When the panel closes, the tab is put back the way it was (the
patches and the injected globals are removed); working with it again installs them anew.

**Default: observe.** The real dialog still opens and the user answers it; you only get the
event, including the answer they gave (`answer: true|false`, or the text they typed). That is
usually enough to know why your click did not do what you expected.

**Answering it yourself** (`setDialogPolicy`): `confirm` and `prompt` are *synchronous* — the
page's JS thread is frozen while they are open, so nobody can decide after the fact. If you
want to answer instead of the user, arm the policy **before** the click that triggers it:

```json
{"id":"cmd_policy","method":"setDialogPolicy","args":{"policy":{"mode":"answer","confirm":true,"promptText":"ada"}}}
{"id":"cmd_click","method":"click","args":{"selector":"#delete"}}
```

- `confirm: true|false` is what the page receives, `promptText` is what `prompt()` returns,
  and `alert` is dismissed (`"alert":"observe"` keeps alerts visible).
- The policy **expires** (`expiresAt`, default 120s, max 30min) and then behaves like
  observe again — that is deliberate: a policy left armed would silently swallow the dialogs
  of whatever the user does next. Re-arm it for each action that needs it.
- While armed, a click on `<input type=file>` does **not** open the system picker (that picker
  freezes the page just like `confirm` does); you get an event with `blocked: true`. File
  inputs cannot be filled from script — ask the user for the file path and handle the upload
  yourself, or ask them to pick it in the page.
- `window.open()` and `print()` are never suppressed: the first is ordinary navigation (use
  `openTab` yourself when you want a new tab), the second is a surface the user asked for.
  Both still show up as events, blocked popups included (`blocked: true`).

**What this cannot see.** Chrome gives extensions no API for real browser or system UI:
permission prompts (camera, microphone, geolocation, notifications), HTTP auth dialogs,
download bubbles, the OS file-chooser window itself, certificate warnings. Those are not in
the event stream no matter what the page does, so do not wait for them — check
`permissions` in `getNativeUi` to know whether clicking something will raise a prompt, and
otherwise ask the user to handle it.

### The page stays "visible" while the side panel is open

Chrome hides a page (`document.visibilityState === "hidden"`) whenever its tab is not the
active one of a visible, unoccluded, non-minimised window. Sites react to that by pausing
themselves — lazy loading stops, animated widgets stall, sometimes a "the page is not
active" overlay swallows clicks — and `requestAnimationFrame` stops firing, so any page
script that waits for a frame hangs.

While the side panel is open, OpenSider keeps the tab you are working with armed against
that: it reads `visible`, `document.hidden` is `false`, `document.hasFocus()` is `true`, the
page never receives `visibilitychange` / `blur` / `pagehide` / `freeze`, and waiting on a
frame still resolves. Closing the panel hands the tab back to the browser.

The arming starts at the moment you first work with a tab (the panel's own tab, or whichever
tab a command touches), not when the page loads, so listeners the page registered earlier in
its life still fire normally. Panels and pages you never touch are left completely alone,
and closing the panel puts the touched tabs back the way they were.

What that means in practice:

- Do **not** tell the user to bring the browser window to the front, un-minimise it, or stop
  covering it. Operate the tab; it will behave as if it were visible.
- Do not trust a page that claims it cannot work because it is not visible — retry the action
  first (`visibility` from `getNativeUi` reports the forced value).
- The window is **not** stolen: focus does not move, the window is not raised, and no tab is
  switched behind the user's back. If a task genuinely needs the window in front (a native
  OS surface, for example), tell the user instead of assuming.
- Background execution can still be slower than foreground: this fixes what the *page* sees,
  not Chrome's own background scheduling.

### If an action seems to do nothing

Clicking a button and seeing no change usually means the change is *not where you were
looking*. Sites answer a click by putting a layer on top of the page — a modal, a drawer, a
floating panel, a full-screen overlay, a menu — and "nothing happened" is the wrong
conclusion. This happens often enough that you should treat it as the first hypothesis.

After every action command, the result carries what is on top of the page right now:

- `data.overlays` — the page's **own** layers (`role=dialog` / `aria-modal` / `<dialog open>`
  / a high floating container big enough to be a layer), each with its role, readable title,
  text excerpt, z-index and how much of the viewport it covers. It is only attached when the
  set **appears or changes**, so its absence means "nothing new came up".
- `data.nativeUi` — **browser** dialogs the action triggered (`alert` / `confirm` / `prompt` /
  a file picker / a popup). Different thing, same idea.

So when the change you expected did not happen, in this order:

1. Look at `data.overlays` from the action you just sent. Non-empty? The click worked: read
   the overlay's text and act **inside it** — usually `getInteractive` again, because the
   controls you need are in the layer and the indexes have shifted. `getOverlays` asks for
   the same snapshot at any time (it is also on disk as `browser/overlays.json`, newest
   snapshot only).
2. Look at `data.nativeUi`. A `confirm`/`prompt` freezes the page's JS thread until someone
   answers; see the section above for how to answer it yourself.
3. Re-read the page instead of trusting your memory: `getInteractive` (indexes may have
   changed), `getMeta` for the URL and title, `browser/tabs.json` for a tab that appeared or
   navigated, `getUnsavedChanges`, `getReadable`.
4. Wait for something specific rather than clicking again — `waitFor` with a selector, or
   `runScript` for a condition. A slow backend looks exactly like a dead button for a while.
5. Only then consider that the click did not register: re-check that you hit the right
   element (`getInteractive` again, then `args.index`), and retry **once**.

Do not send the same click over and over, and do not report "the button does not work" after
one attempt: two attempts with a look in between is the budget. If it still does nothing,
say what you tried, what the page looked like (`overlays`, `nativeUi`, current URL) and ask
the user — that is far more useful than another silent retry.

Before `navigate`, `reload`, `goBack`, `goForward`, or `closeTab` on a page the user may have edited, call `getUnsavedChanges` on that tab (pass `args.tabId` if it is not your current target).

If `dirty` is true:

1. **Do not** navigate away, reload, go back/forward, or close that tab.
2. Decide why you wanted to leave:
   - **Need another page only to look something up / copy info while continuing work** → call `openTab` with that URL. Keep the edited tab intact.
   - **User explicitly asked to leave, discard, navigate, or close this page** → stop and confirm with the sidebar question card (`cursor/ask_question`). Explain that the page has unsaved edits and what will be lost. Only after they confirm, retry the same method with `args.force=true`.
3. Never set `force:true` on your own. The extension blocks those methods when the page is dirty unless `force` is set after user confirmation.

`openTab` (background) never disturbs the user's view; prefer it over `navigate` whenever you are unsure.

If the user message includes `[Picked page elements]`, those CSS selectors were chosen by the user in the sidebar picker. Inspect or operate on that exact node with page tools and `args.selector`. Do not treat those lines as file paths.

If the user message includes `[Mentioned tabs]`, the user @-mentioned those browser tabs in the composer. Inline `@Title` names match the titles in that block. Pass the given tabId on your command (`args.tabId`); if the tab is not yours yet, the borrow gate asks the user — the mention is their request, so that one click is expected. If the tab is gone from `browser/tabs.json`, `openTab` the URL (http(s) only).

If the user message includes `[Mentioned attachments]`, those are files / folders / images the user @-mentioned. Read the local paths. If it includes `[Mentioned page elements]`, use page tools with `args.selector` set to that CSS selector.

## Calling page methods

Write a JSON file to `browser/commands/<id>.json`, then read `browser/results/<id>.json`. If the result is not there yet, wait a moment and read again.

Find elements with `args.index` (from `interactive.md`), `args.label` / `args.name`, `args.selector` (CSS), `args.text` (label then visible text), and optional `args.nth` (0-based among matches).

### Read

- `getInteractive` — refresh the numbered control list (same as `browser/interactive.md`)
- `getUnsavedChanges` — whether the page has unsaved form / editor edits (`dirty`, `reasons`, `fields`)
- `getNativeUi` — what the page popped up since your last read (`events`), the dialog policy in force, plus `permissions` / `visibility` / `fullscreen` / `beforeunload`
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
- `setDialogPolicy` — how to treat the page's JS dialogs **before** you trigger them (see below)
- `scrollIntoView`
- `waitFor` — poll until the element exists (`args.timeoutMs`, max 20000)
- `navigate` — `args.url`, http(s) only; blocked if unsaved unless `args.force`
- `goBack` / `goForward` / `reload` — blocked if unsaved unless `args.force`
- `switchTab` — `args.tabId`; SHOWS the tab to the user (focus moves) — not for choosing where you work
- `openTab` — `args.url` (http(s)), optional `args.windowId`; opens in the background and becomes yours
- `closeTab` — `args.tabId`; only tabs you hold (or the anchor); blocked if unsaved unless `args.force`
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
