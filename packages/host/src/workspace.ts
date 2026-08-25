import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { TOOL_CATALOG, type CurrentPage } from "../../shared/src/protocol.ts";
import {
  AGENTS_MD_PATH,
  BROWSER_DIR,
  COMMANDS_DIR,
  CURRENT_PAGE_PATH,
  PASTED_DIR,
  RESULTS_DIR,
  SCREENSHOTS_DIR,
  SESSION_PATH,
  SIDEBAR_HOME,
  SNAPSHOT_PATH,
  TOOLS_PATH,
  WORKSPACE_DIR,
} from "./paths.ts";

const AGENTS_MD = `# Browser page tools

You are chatting from a Chrome sidebar. The user keeps ONE workspace across every browser tab, and may switch among several chat sessions. Page files in this workspace are shared; the current conversation is only the session you are in.

Read \`browser/tools.json\` now. It lists every page method available in this session (read, act, vision). Prefer those methods over guessing from memory.

## Current page

When the user talks about "this page", "the current tab", or the site they are looking at, read \`browser/current.json\` first. \`browser/snapshot.md\` is the latest readable extract of that page.

The current tab also changes while you work. Re-read those files after navigation or if the user says they changed pages.

If the user message includes \`[Picked page elements]\`, those CSS selectors were chosen by the user in the sidebar picker. Inspect or operate on that exact node with page tools and \`args.selector\`. Do not treat those lines as file paths.

## Calling page methods

Write a JSON file to \`browser/commands/<id>.json\`, then read \`browser/results/<id>.json\`. If the result is not there yet, wait a moment and read again.

\`\`\`json
{"id":"<id>","method":"click","args":{"text":"Sign in"}}
\`\`\`

Find elements with \`args.selector\` (CSS), \`args.text\` (visible text contains), and optional \`args.nth\` (0-based).

### Read

- \`getMeta\` — url, title, description
- \`getReadable\` — main text
- \`getSelection\` — highlighted text
- \`getLinks\` — same-origin links
- \`getOutline\` — h1–h3
- \`queryText\` — one node's text
- \`queryAll\` — matching node summaries
- \`getAttribute\` — requires \`args.attribute\`
- \`getValue\` — input/textarea/select value
- \`exists\` — whether a match exists

### Act

- \`click\` / \`dblclick\` / \`hover\` / \`focus\`
- \`fill\` — set value (\`args.value\`)
- \`type\` — append \`args.text\`
- \`clear\`
- \`select\` — \`<select>\` + \`args.value\`
- \`check\` — checkbox/radio, optional \`args.checked\`
- \`press\` — \`args.key\` such as \`Enter\` or \`Escape\`
- \`scroll\` — element if selector/text, else window by \`args.x\` / \`args.y\`
- \`scrollIntoView\`
- \`waitFor\` — poll until the element exists (\`args.timeoutMs\`, max 20000)
- \`navigate\` — \`args.url\`, http(s) only
- \`goBack\` / \`goForward\` / \`reload\`

### Vision

Use screenshots when the DOM text is not enough to understand layout, pick a target, or plan the next click.

- \`screenshot\` — visible viewport JPEG; optional \`x,y,width,height\` in CSS pixels
- \`screenshotElement\` — scroll an element into view and crop it (\`selector\` or \`text\`)

The result JSON has \`data.path\` (absolute file). **Read that JPEG** to inspect the page visually. Do not expect base64 in the JSON.

Do not invent other methods. Do not try to run arbitrary JavaScript. After acting, re-read \`browser/current.json\` if the page may have changed.
`;

export function ensureWorkspace(): void {
  mkdirSync(COMMANDS_DIR, { recursive: true });
  mkdirSync(RESULTS_DIR, { recursive: true });
  mkdirSync(SCREENSHOTS_DIR, { recursive: true });
  mkdirSync(PASTED_DIR, { recursive: true });
  mkdirSync(SIDEBAR_HOME, { recursive: true });
  writeFileSync(AGENTS_MD_PATH, AGENTS_MD);
  writeFileSync(
    TOOLS_PATH,
    `${JSON.stringify(
      {
        version: 2,
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
  const body = page.readable?.trim()
    ? `# ${page.title}\n\n${page.url}\n\n${page.readable.trim()}\n`
    : `# ${page.title}\n\n${page.url}\n\n_No readable extract available._\n`;
  writeFileSync(SNAPSHOT_PATH, body);
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
