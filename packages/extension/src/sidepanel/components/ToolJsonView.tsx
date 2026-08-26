import type { ReactNode } from "react";

const MAX_DEPTH = 12;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function coerceJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed) return value;
  const first = trimmed[0];
  const last = trimmed[trimmed.length - 1];
  if (!((first === "{" && last === "}") || (first === "[" && last === "]"))) return value;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function formatScalar(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value === undefined) return "";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function padStyle(depth: number): { paddingLeft: string } | undefined {
  return depth > 0 ? { paddingLeft: `${depth}em` } : undefined;
}

function renderValue(value: unknown, depth: number, unwrapSingle: boolean): ReactNode {
  if (depth > MAX_DEPTH) {
    return (
      <p style={padStyle(depth)} className="whitespace-pre-wrap break-words">
        {formatScalar(value)}
      </p>
    );
  }

  const parsed = coerceJson(value);

  if (isPlainObject(parsed)) {
    const entries = Object.entries(parsed);
    if (entries.length === 0) return null;
    if (unwrapSingle && entries.length === 1) {
      return renderValue(entries[0][1], depth, false);
    }
    return entries.map(([key, child], index) => renderEntry(`${depth}-${key}-${index}`, key, child, depth));
  }

  if (Array.isArray(parsed)) {
    if (parsed.length === 0) {
      return (
        <p style={padStyle(depth)} className="whitespace-pre-wrap break-words">
          []
        </p>
      );
    }
    return parsed.map((item, index) => {
      const inner = coerceJson(item);
      if (isPlainObject(inner) || Array.isArray(inner)) {
        return <div key={`${depth}-arr-${index}`}>{renderValue(item, depth, false)}</div>;
      }
      return (
        <p key={`${depth}-arr-${index}`} style={padStyle(depth)} className="whitespace-pre-wrap break-words">
          {formatScalar(inner)}
        </p>
      );
    });
  }

  const text = formatScalar(parsed);
  if (!text) return null;
  return (
    <p style={padStyle(depth)} className="whitespace-pre-wrap break-words">
      {text}
    </p>
  );
}

function renderEntry(reactKey: string, key: string, value: unknown, depth: number): ReactNode {
  const parsed = coerceJson(value);
  if (isPlainObject(parsed) || Array.isArray(parsed)) {
    return (
      <div key={reactKey}>
        <p style={padStyle(depth)} className="whitespace-pre-wrap break-words">
          {key}：
        </p>
        {renderValue(parsed, depth + 1, false)}
      </div>
    );
  }
  return (
    <p key={reactKey} style={padStyle(depth)} className="whitespace-pre-wrap break-words">
      {key}：{formatScalar(parsed)}
    </p>
  );
}

export function ToolJsonView({ value }: { value: unknown }) {
  if (value == null || value === "") return null;
  const body = renderValue(value, 0, true);
  if (body == null) return null;
  return <div className="space-y-0.5">{body}</div>;
}
