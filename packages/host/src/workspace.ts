import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import type { CurrentPage } from "../../shared/src/protocol.ts";
import {
  AGENTS_MD_PATH,
  BROWSER_DIR,
  COMMANDS_DIR,
  CURRENT_PAGE_PATH,
  RESULTS_DIR,
  SESSION_PATH,
  SIDEBAR_HOME,
  SNAPSHOT_PATH,
  WORKSPACE_DIR,
} from "./paths.ts";

const AGENTS_MD = `# Browser page tools

You are chatting from a Chrome sidebar. The user keeps ONE session and ONE workspace across every browser tab.

## Current page

When the user talks about "this page", "the current tab", or the site they are looking at, read \`browser/current.json\` first. \`browser/snapshot.md\` is the latest readable extract of that page.

The current tab also changes while you work. Re-read those files if the user switches topics or says they changed pages.

## Calling page methods

Write a JSON file to \`browser/commands/<id>.json\`:

\`\`\`json
{"id":"<id>","method":"getReadable","args":{}}
\`\`\`

Then read \`browser/results/<id>.json\`. If the file is not there yet, wait a moment and read again.

Allowed methods (read-only):

- \`getMeta\` — url, title, description
- \`getReadable\` — main text
- \`getSelection\` — the user's highlighted text
- \`getLinks\` — same-origin links
- \`getOutline\` — h1–h3 headings
- \`queryText\` — \`args.selector\` required, returns that node's text

Do not invent other methods. Do not try to click or navigate the page.
`;

export function ensureWorkspace(): void {
  mkdirSync(COMMANDS_DIR, { recursive: true });
  mkdirSync(RESULTS_DIR, { recursive: true });
  mkdirSync(SIDEBAR_HOME, { recursive: true });
  writeFileSync(AGENTS_MD_PATH, AGENTS_MD);
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
