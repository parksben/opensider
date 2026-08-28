import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { TOOL_CATALOG, type CurrentPage, type TabsSnapshot } from "../../shared/src/protocol.ts";
import {
  AGENTS_MD_PATH,
  CLAUDE_MD_PATH,
  BROWSER_DIR,
  COMMANDS_DIR,
  CURRENT_PAGE_PATH,
  INTERACTIVE_PATH,
  PASTED_DIR,
  RESULTS_DIR,
  SCREENSHOTS_DIR,
  SESSION_PATH,
  SIDEBAR_HOME,
  SNAPSHOT_PATH,
  TABS_PATH,
  TOOLS_PATH,
  WORKSPACE_DIR,
} from "./paths.ts";

const AGENTS_MD = `# Browser page tools

You are chatting from a Chrome sidebar. The user keeps ONE workspace across every browser tab, and may switch among several chat sessions. Page files in this workspace are shared; the current conversation is only the session you are in.

Read \`browser/tools.json\` now. It lists every page method available in this session (read, act, vision). Prefer those methods over guessing from memory.

## Current page

When the user talks about "this page", "the current tab", or the site they are looking at, read these files first:

1. \`browser/current.json\` — tabId, url, title
2. **\`browser/interactive.md\`** — numbered interactive controls. This is how you fill forms and click. Do **not** start by guessing CSS selectors.
3. \`browser/snapshot.md\` — the same control list plus a readable text extract

The current tab also changes while you work. Re-read those files after navigation, after \`switchTab\`, or if the user says they changed pages.

## How to operate the page (read this)

Interactive controls look like:

\`\`\`
[1] textbox "Email" empty placeholder="you@acme.com" required
[2] textbox "Password" type=password empty
[3] combobox "Country" value="Select…" options=China | Japan
[4] checkbox "Remember me" unchecked
[5] button "Submit"
\`\`\`

Rules:

- Only lines with \`[index]\` are actionable. Indices are **1-based**.
- Prefer \`args.index\` from the latest list. Second choice: \`args.label\` or \`args.name\` (these resolve to the control, not the \`<label>\` node). CSS \`args.selector\` is a last resort.
- **Fill a whole form with one \`fillForm\`** whenever you have several fields. Do not invent a selector per box.
- After \`click\` / \`fill\` / \`fillForm\` / \`select\`, the result JSON includes a fresh \`interactive\` list. **Use those new indices.** Dropdowns, validation, and navigation change the numbering.
- Custom dropdowns: \`fill\` or \`select\` with the option text as \`args.value\`. If that fails, \`click\` the field, read the new list, \`click\` the option.
- Do not match inputs by visible \`innerText\` — empty textboxes have none. That is why \`interactive.md\` exists.
- File inputs cannot be filled. Ask the user to pick the file.
- Screenshots are for layout / confirmation, not the default way to find a form field.

### fillForm example

\`\`\`json
{"id":"cmd_form","method":"fillForm","args":{"fields":[{"label":"Email","value":"ada@example.com"},{"label":"Password","value":"secret"},{"label":"Country","value":"China"}]}}
\`\`\`

### click / fill by index

\`\`\`json
{"id":"cmd_01","method":"fill","args":{"index":1,"value":"ada@example.com"}}
{"id":"cmd_02","method":"click","args":{"index":5}}
\`\`\`

## Open tabs and windows

Read \`browser/tabs.json\` for every normal Chrome window and tab (\`tabId\`, \`windowId\`, \`index\`, \`title\`, \`url\`, \`active\`, \`pinned\`, \`restricted\`). It updates when tabs move. Call \`listTabs\` if you need the same list in a command result.

Do not invent tab IDs. To switch tabs, call \`switchTab\` with \`args.tabId\` from that file — it also focuses the tab's window. To open a site without replacing the current page, call \`openTab\` with \`args.url\` (http(s) only). To pull one or more tabs into their own window, call \`moveTabsToWindow\` with \`args.tabIds\`. Pass \`args.windowId\` to move them into an existing window instead of creating one.

\`restricted: true\` means chrome://, chrome-extension://, or the Web Store. You may \`switchTab\` to those, but do not run page read / act / screenshot on them.

If the user message includes \`[Picked page elements]\`, those CSS selectors were chosen by the user in the sidebar picker. Inspect or operate on that exact node with page tools and \`args.selector\`. Do not treat those lines as file paths.

If the user message includes \`[Mentioned tabs]\`, the user @-mentioned those browser tabs in the composer. Inline \`@Title\` names match the titles in that block. Use \`switchTab\` with the given tabId if it still appears in \`browser/tabs.json\`; otherwise \`openTab\` the URL (http(s) only).

If the user message includes \`[Mentioned attachments]\`, those are files / folders / images the user @-mentioned. Read the local paths. If it includes \`[Mentioned page elements]\`, use page tools with \`args.selector\` set to that CSS selector.

## Calling page methods

Write a JSON file to \`browser/commands/<id>.json\`, then read \`browser/results/<id>.json\`. If the result is not there yet, wait a moment and read again.

Find elements with \`args.index\` (from \`interactive.md\`), \`args.label\` / \`args.name\`, \`args.selector\` (CSS), \`args.text\` (label then visible text), and optional \`args.nth\` (0-based among matches).

### Read

- \`getInteractive\` — refresh the numbered control list (same as \`browser/interactive.md\`)
- \`getMeta\` — url, title, description
- \`getReadable\` — main text
- \`getSelection\` — highlighted text
- \`getLinks\` — same-origin links
- \`getOutline\` — h1–h3
- \`queryText\` — one node's text
- \`queryAll\` — matching node summaries; no locator = current interactive list
- \`getAttribute\` — requires \`args.attribute\`
- \`getValue\` — current value + label of a field
- \`exists\` — whether a match exists
- \`listTabs\` — all normal windows and tabs (same shape as \`browser/tabs.json\`)

### Act

- \`click\` / \`dblclick\` / \`hover\` / \`focus\`
- \`fillForm\` — many fields at once (\`args.fields\`)
- \`fill\` — set value (\`args.value\`)
- \`type\` — append \`args.text\`
- \`clear\`
- \`select\` — native \`<select>\` or custom combobox; \`args.value\` is option value or visible text
- \`check\` — checkbox/radio/switch, optional \`args.checked\`
- \`press\` — \`args.key\` such as \`Enter\` or \`Escape\`
- \`scroll\` — element if index/selector/text, else window by \`args.x\` / \`args.y\`
- \`scrollIntoView\`
- \`waitFor\` — poll until the element exists (\`args.timeoutMs\`, max 20000)
- \`navigate\` — \`args.url\`, http(s) only
- \`goBack\` / \`goForward\` / \`reload\`
- \`switchTab\` — \`args.tabId\`
- \`openTab\` — \`args.url\` (http(s)), optional \`args.windowId\`
- \`moveTabsToWindow\` — \`args.tabIds\`, optional \`args.windowId\`

### Vision

Use screenshots when the control list is not enough to understand layout, pick a target, or confirm what changed.

- \`screenshot\` — visible viewport JPEG; optional \`x,y,width,height\` in CSS pixels
- \`screenshotElement\` — scroll an element into view and crop it (\`index\`, \`selector\`, or \`label\`)

The result JSON has \`data.path\` (absolute file). **Read that JPEG** to inspect the page visually. Do not expect base64 in the JSON.

Do not invent other methods. Do not try to run arbitrary JavaScript. After acting, re-read \`browser/current.json\`, \`browser/interactive.md\`, and \`browser/tabs.json\` if the page or tab set may have changed.
`;

export function ensureWorkspace(): void {
  mkdirSync(COMMANDS_DIR, { recursive: true });
  mkdirSync(RESULTS_DIR, { recursive: true });
  mkdirSync(SCREENSHOTS_DIR, { recursive: true });
  mkdirSync(PASTED_DIR, { recursive: true });
  mkdirSync(SIDEBAR_HOME, { recursive: true });
  writeFileSync(AGENTS_MD_PATH, AGENTS_MD);
  writeFileSync(CLAUDE_MD_PATH, AGENTS_MD);
  writeFileSync(
    TOOLS_PATH,
    `${JSON.stringify(
      {
        version: 4,
        transport: "workspace-files",
        commandsDir: "browser/commands",
        resultsDir: "browser/results",
        screenshotsDir: "browser/screenshots",
        methods: TOOL_CATALOG,
      },
      null,
      2,
    )}\n`,
  );
}

export function writeCurrentPage(page: CurrentPage): void {
  mkdirSync(BROWSER_DIR, { recursive: true });
  const compact = {
    tabId: page.tabId,
    url: page.url,
    title: page.title,
    updatedAt: page.updatedAt,
  };
  writeFileSync(CURRENT_PAGE_PATH, `${JSON.stringify(compact, null, 2)}\n`);
  const interactive = page.interactive?.trim() || "_No interactive controls indexed._";
  const readable = page.readable?.trim() || "_No readable extract available._";
  writeFileSync(INTERACTIVE_PATH, `# ${page.title}\n\n${page.url}\n\n${interactive}\n`);
  writeFileSync(
    SNAPSHOT_PATH,
    `# ${page.title}\n\n${page.url}\n\n## Interactive controls\n\nSee \`browser/interactive.md\`. Use \`args.index\` (1-based) or \`fillForm\`.\n\n${interactive}\n\n## Readable text\n\n${readable}\n`,
  );
}

export function writeTabsSnapshot(snapshot: TabsSnapshot): void {
  mkdirSync(BROWSER_DIR, { recursive: true });
  writeFileSync(TABS_PATH, `${JSON.stringify(snapshot, null, 2)}\n`);
}

export function readSessionId(): string | undefined {
  if (!existsSync(SESSION_PATH)) return undefined;
  try {
    const data = JSON.parse(readFileSync(SESSION_PATH, "utf8")) as { sessionId?: string };
    return data.sessionId;
  } catch {
    return undefined;
  }
}

export function writeSessionId(sessionId: string): void {
  mkdirSync(SIDEBAR_HOME, { recursive: true });
  writeFileSync(SESSION_PATH, `${JSON.stringify({ sessionId }, null, 2)}\n`);
}

export { WORKSPACE_DIR };
