import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { HOST_LOG_PATH } from "./paths.ts";

export function log(message: string): void {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  try {
    mkdirSync(dirname(HOST_LOG_PATH), { recursive: true });
    appendFileSync(HOST_LOG_PATH, line);
  } catch {
    // ignore
  }
  process.stderr.write(line);
}
