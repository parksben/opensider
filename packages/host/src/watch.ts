import { watch } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { BrowserCommand, BrowserResult } from "../../shared/src/protocol.ts";
import { PAGE_METHODS } from "../../shared/src/protocol.ts";
import { log } from "./log.ts";
import { COMMANDS_DIR, RESULTS_DIR } from "./paths.ts";

const processed = new Set<string>();

function isCommand(value: unknown): value is BrowserCommand {
  if (!value || typeof value !== "object") return false;
  const cmd = value as BrowserCommand;
  return typeof cmd.id === "string" && PAGE_METHODS.includes(cmd.method);
}

export function watchCommands(onCommand: (command: BrowserCommand) => void): void {
  watch(COMMANDS_DIR, (_event, filename) => {
    if (!filename || !filename.endsWith(".json")) return;
    void readCommand(join(COMMANDS_DIR, filename), onCommand);
  });
}

async function readCommand(file: string, onCommand: (command: BrowserCommand) => void): Promise<void> {
  try {
    const raw = await readFile(file, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!isCommand(parsed)) return;
    if (processed.has(parsed.id)) return;
    processed.add(parsed.id);
    onCommand(parsed);
  } catch {
    // file may still be writing
  }
}

export async function writeCommandResult(result: BrowserResult): Promise<void> {
  const file = join(RESULTS_DIR, `${result.id}.json`);
  await writeFile(file, `${JSON.stringify(result, null, 2)}\n`);
  log(`wrote result ${result.id} ok=${result.ok}`);
}
