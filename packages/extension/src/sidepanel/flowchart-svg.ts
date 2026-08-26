import dagre from "@dagrejs/dagre";

type RankDir = "TB" | "BT" | "LR" | "RL";
type NodeShape = "rect" | "round" | "diamond" | "circle" | "stadium";
type EdgeKind = "arrow" | "line" | "dotted" | "thick";

interface FlowNode {
  id: string;
  label: string;
  shape: NodeShape;
}

interface FlowEdge {
  from: string;
  to: string;
  label?: string;
  kind: EdgeKind;
}

interface FlowChart {
  dir: RankDir;
  nodes: FlowNode[];
  edges: FlowEdge[];
}

const CACHE_LIMIT = 48;
const svgCache = new Map<string, string | null>();

const OTHER_DIAGRAM =
  /^(sequenceDiagram|classDiagram|stateDiagram(?:-v2)?|erDiagram|gantt|pie|journey|gitGraph|mindmap|timeline|quadrantChart|requirementDiagram|C4Context|sankey-beta|xychart-beta|block-beta|packet-beta|kanban|radar-beta|architecture-beta)\b/i;

const HEADER = /^(flowchart|graph)(?:-elk)?(?:\s+(TD|TB|BT|LR|RL))?\s*$/i;

export function renderFlowchartSvg(source: string): string | null {
  const key = source.replace(/\s+$/, "");
  if (svgCache.has(key)) return svgCache.get(key) ?? null;
  const parsed = parseFlowchart(key);
  const svg = parsed ? layoutToSvg(parsed) : null;
  if (svgCache.size >= CACHE_LIMIT) {
    const oldest = svgCache.keys().next().value;
    if (oldest !== undefined) svgCache.delete(oldest);
  }
  svgCache.set(key, svg);
  return svg;
}

function parseFlowchart(source: string): FlowChart | null {
  const rawLines = source.replace(/\r\n/g, "\n").split("\n");
  const lines: string[] = [];
  for (const raw of rawLines) {
    const line = stripDirective(stripLineComment(raw)).trim();
    if (!line) continue;
    if (OTHER_DIAGRAM.test(line)) return null;
    if (/^subgraph\b/i.test(line)) return null;
    if (/^(classDef|class|style|click|linkStyle|animate)\b/i.test(line)) continue;
    lines.push(line);
  }
  if (lines.length === 0) return null;

  const header = HEADER.exec(lines[0]);
  if (!header) return null;
  let dir = normalizeDir(header[2]);
  const nodes = new Map<string, FlowNode>();
  const edges: FlowEdge[] = [];

  for (const line of lines.slice(1)) {
    const direction = /^direction\s+(TD|TB|BT|LR|RL)\s*$/i.exec(line);
    if (direction) {
      dir = normalizeDir(direction[1]);
      continue;
    }
    if (!parseStatement(line, nodes, edges)) return null;
  }

  if (nodes.size === 0) return null;
  return { dir, nodes: [...nodes.values()], edges };
}

function normalizeDir(value?: string): RankDir {
  const upper = (value ?? "TB").toUpperCase();
  if (upper === "TD" || upper === "TB") return "TB";
  if (upper === "BT" || upper === "LR" || upper === "RL") return upper;
  return "TB";
}

function stripDirective(line: string): string {
  return line.replace(/%%\{[\s\S]*?\}%%/g, "");
}

function stripLineComment(line: string): string {
  let inQuote: '"' | "'" | "`" | null = null;
  for (let i = 0; i < line.length - 1; i += 1) {
    const ch = line[i];
    if (inQuote) {
      if (ch === inQuote && line[i - 1] !== "\\") inQuote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      inQuote = ch;
      continue;
    }
    if (ch === "%" && line[i + 1] === "%") return line.slice(0, i);
  }
  return line;
}

function parseStatement(line: string, nodes: Map<string, FlowNode>, edges: FlowEdge[]): boolean {
  const parts = splitStatements(line);
  for (const part of parts) {
    if (!parseOneStatement(part, nodes, edges)) return false;
  }
  return true;
}

function splitStatements(line: string): string[] {
  const out: string[] = [];
  let start = 0;
  let inQuote: '"' | "'" | "`" | null = null;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inQuote) {
      if (ch === inQuote && line[i - 1] !== "\\") inQuote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      inQuote = ch;
      continue;
    }
    if (ch === ";") {
      const piece = line.slice(start, i).trim();
      if (piece) out.push(piece);
      start = i + 1;
    }
  }
  const tail = line.slice(start).trim();
  if (tail) out.push(tail);
  return out;
}

function parseOneStatement(line: string, nodes: Map<string, FlowNode>, edges: FlowEdge[]): boolean {
  let i = skipSpace(line, 0);
  const left = parseNodeList(line, i);
  if (!left) return false;
  remember(nodes, left.nodes);
  i = skipSpace(line, left.next);
  if (i >= line.length) return true;

  while (i < line.length) {
    const edge = parseEdgeOp(line, i);
    if (!edge) return false;
    i = skipSpace(line, edge.next);
    const right = parseNodeList(line, i);
    if (!right) return false;
    remember(nodes, right.nodes);
    for (const from of left.nodes) {
      for (const to of right.nodes) {
        edges.push({ from: from.id, to: to.id, label: edge.label, kind: edge.kind });
      }
    }
    left.nodes = right.nodes;
    i = skipSpace(line, right.next);
  }
  return true;
}

function remember(nodes: Map<string, FlowNode>, list: FlowNode[]) {
  for (const node of list) {
    const prev = nodes.get(node.id);
    if (!prev || (prev.label === prev.id && node.label !== node.id)) nodes.set(node.id, node);
  }
}

function parseNodeList(line: string, start: number): { nodes: FlowNode[]; next: number } | null {
  const first = parseNodeToken(line, start);
  if (!first) return null;
  const nodes = [first.node];
  let i = skipSpace(line, first.next);
  while (line[i] === "&") {
    i = skipSpace(line, i + 1);
    const next = parseNodeToken(line, i);
    if (!next) return null;
    nodes.push(next.node);
    i = skipSpace(line, next.next);
  }
  return { nodes, next: i };
}

function parseNodeToken(line: string, start: number): { node: FlowNode; next: number } | null {
  const i0 = skipSpace(line, start);
  const idMatch = /^(?:[\p{L}_][\p{L}\p{N}_-]*|\d+)/u.exec(line.slice(i0));
  if (!idMatch) return null;
  const id = idMatch[0];
  let i = i0 + id.length;
  const shaped = parseShape(line, i);
  if (!shaped) return { node: { id, label: id, shape: "rect" }, next: i };
  return { node: { id, label: cleanLabel(shaped.label) || id, shape: shaped.shape }, next: shaped.next };
}

function parseShape(line: string, start: number): { label: string; shape: NodeShape; next: number } | null {
  const ch = line[start];
  if (ch === "[") {
    if (line[start + 1] === "[") {
      const body = readUntil(line, start + 2, "]]");
      return body ? { label: body.text, shape: "rect", next: body.next } : null;
    }
    const body = readBracket(line, start, "[", "]");
    return body ? { label: body.text, shape: "rect", next: body.next } : null;
  }
  if (ch === "(") {
    if (line.startsWith("((", start)) {
      const body = readUntil(line, start + 2, "))");
      return body ? { label: body.text, shape: "circle", next: body.next } : null;
    }
    if (line.startsWith("([", start)) {
      const body = readUntil(line, start + 2, "])");
      return body ? { label: body.text, shape: "stadium", next: body.next } : null;
    }
    const body = readBracket(line, start, "(", ")");
    return body ? { label: body.text, shape: "round", next: body.next } : null;
  }
  if (ch === "{") {
    if (line.startsWith("{{", start)) {
      const body = readUntil(line, start + 2, "}}");
      return body ? { label: body.text, shape: "diamond", next: body.next } : null;
    }
    const body = readBracket(line, start, "{", "}");
    return body ? { label: body.text, shape: "diamond", next: body.next } : null;
  }
  if (ch === ">") {
    const body = readUntil(line, start + 1, "]");
    return body ? { label: body.text, shape: "rect", next: body.next } : null;
  }
  return null;
}

function readBracket(line: string, start: number, open: string, close: string): { text: string; next: number } | null {
  if (line[start] !== open) return null;
  const quote = line[start + 1];
  if (quote === '"' || quote === "'" || quote === "`") {
    const end = line.indexOf(quote, start + 2);
    if (end < 0 || line[end + 1] !== close) return null;
    return { text: line.slice(start + 2, end), next: end + 2 };
  }
  return readUntil(line, start + 1, close);
}

function readUntil(line: string, from: number, close: string): { text: string; next: number } | null {
  const end = line.indexOf(close, from);
  if (end < 0) return null;
  return { text: line.slice(from, end), next: end + close.length };
}

function parseEdgeOp(line: string, start: number): { kind: EdgeKind; label?: string; next: number } | null {
  const i = skipSpace(line, start);
  const rest = line.slice(i);
  const tagged = /^(-->|---|==>|===|-.->|-.-)\|([^|]*)\|/.exec(rest);
  if (tagged) {
    return { kind: kindOf(tagged[1]), label: cleanLabel(tagged[2]) || undefined, next: i + tagged[0].length };
  }
  const plain = /^(-->|---|==>|===|-.->|-.-)(?!\|)/.exec(rest);
  if (plain) {
    return { kind: kindOf(plain[1]), next: i + plain[1].length };
  }
  const labeled = /^(--|==|-\.)\s+(.+?)\s+(-->|---|->|==>|===|\.->)(?!\S)/.exec(rest);
  if (labeled) {
    return {
      kind: kindOfLabeled(labeled[1], labeled[3]),
      label: cleanLabel(labeled[2]) || undefined,
      next: i + labeled[0].length,
    };
  }
  return null;
}

function kindOf(op: string): EdgeKind {
  if (op.startsWith("-.")) return "dotted";
  if (op.startsWith("=")) return "thick";
  if (op.includes(">")) return "arrow";
  return "line";
}

function kindOfLabeled(prefix: string, suffix: string): EdgeKind {
  if (prefix.startsWith("-.") || suffix.includes(".")) return "dotted";
  if (prefix.startsWith("=") || suffix.includes("=")) return "thick";
  if (suffix.includes(">")) return "arrow";
  return "line";
}

function cleanLabel(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?[\w-]+[^>]*>/g, "")
    .replace(/fa:fa-\S+\s*/g, "")
    .replace(/\\n/g, "\n")
    .trim();
}

function skipSpace(line: string, i: number): number {
  while (i < line.length && (line[i] === " " || line[i] === "\t")) i += 1;
  return i;
}

function layoutToSvg(chart: FlowChart): string {
  const g = new dagre.graphlib.Graph({ directed: true, multigraph: true });
  g.setGraph({
    rankdir: chart.dir,
    nodesep: 32,
    ranksep: 48,
    edgesep: 18,
    marginx: 14,
    marginy: 14,
  });
  g.setDefaultEdgeLabel(() => ({}));

  for (const node of chart.nodes) {
    const size = nodeSize(node);
    g.setNode(node.id, { ...size, label: node.label, shape: node.shape });
  }
  chart.edges.forEach((edge, index) => {
    const label = edge.label ?? "";
    const lw = label ? textWidth(label) + 12 : 0;
    g.setEdge(edge.from, edge.to, { label, width: lw, height: label ? 16 : 0, kind: edge.kind }, `e${index}`);
  });
  dagre.layout(g);

  const graph = g.graph();
  const width = Math.max(1, Math.ceil(graph.width ?? 0));
  const height = Math.max(1, Math.ceil(graph.height ?? 0));
  const markerId = `cs-arr-${Math.abs(hash(chart.nodes.map((n) => n.id).join("|") + width))}`;

  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img">`,
    `<defs><marker id="${markerId}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 10 5 0 10z" fill="var(--line)"/></marker></defs>`,
  ];

  for (const id of g.edges()) {
    const edge = g.edge(id) as { points?: Array<{ x: number; y: number }>; label?: string; x?: number; y?: number; kind?: EdgeKind };
    const points = edge.points ?? [];
    if (points.length < 2) continue;
    const d = points.map((p, idx) => `${idx === 0 ? "M" : "L"}${round(p.x)} ${round(p.y)}`).join(" ");
    const kind = edge.kind ?? "arrow";
    const dash = kind === "dotted" ? ' stroke-dasharray="5 4"' : "";
    const sw = kind === "thick" ? 2.4 : 1.35;
    const marker = kind === "line" ? "" : ` marker-end="url(#${markerId})"`;
    parts.push(
      `<path d="${d}" fill="none" stroke="var(--line)" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"${dash}${marker}/>`,
    );
    if (edge.label && edge.x != null && edge.y != null) {
      const tw = textWidth(edge.label);
      parts.push(
        `<rect x="${round(edge.x - tw / 2 - 4)}" y="${round(edge.y - 8)}" width="${round(tw + 8)}" height="16" rx="3" fill="var(--code)" />`,
        `<text x="${round(edge.x)}" y="${round(edge.y + 0.5)}" text-anchor="middle" dominant-baseline="middle" fill="var(--muted)" font-size="11">${esc(edge.label)}</text>`,
      );
    }
  }

  for (const id of g.nodes()) {
    const node = g.node(id) as { x: number; y: number; width: number; height: number; label: string; shape: NodeShape };
    parts.push(drawNode(node));
  }

  parts.push("</svg>");
  return parts.join("");
}

function drawNode(node: { x: number; y: number; width: number; height: number; label: string; shape: NodeShape }): string {
  const x = node.x - node.width / 2;
  const y = node.y - node.height / 2;
  const common = `fill="var(--panel)" stroke="var(--brass)" stroke-width="1.4"`;
  let shape = "";
  if (node.shape === "diamond") {
    const pts = [
      `${round(node.x)},${round(y)}`,
      `${round(x + node.width)},${round(node.y)}`,
      `${round(node.x)},${round(y + node.height)}`,
      `${round(x)},${round(node.y)}`,
    ].join(" ");
    shape = `<polygon points="${pts}" ${common}/>`;
  } else if (node.shape === "circle") {
    shape = `<ellipse cx="${round(node.x)}" cy="${round(node.y)}" rx="${round(node.width / 2)}" ry="${round(node.height / 2)}" ${common}/>`;
  } else {
    const rx = node.shape === "rect" ? 6 : Math.min(node.height / 2, 18);
    shape = `<rect x="${round(x)}" y="${round(y)}" width="${round(node.width)}" height="${round(node.height)}" rx="${round(rx)}" ${common}/>`;
  }
  const lines = node.label.split("\n").filter((line) => line.length > 0);
  const lineH = 15;
  const start = node.y - ((lines.length - 1) * lineH) / 2;
  const texts = lines.map(
    (line, idx) =>
      `<text x="${round(node.x)}" y="${round(start + idx * lineH)}" text-anchor="middle" dominant-baseline="middle" fill="var(--text)" font-size="12">${esc(line)}</text>`,
  );
  return `${shape}${texts.join("")}`;
}

function nodeSize(node: FlowNode): { width: number; height: number } {
  const lines = wrapLabel(node.label);
  const w = Math.max(...lines.map(textWidth), 16) + 22;
  const h = lines.length * 16 + 16;
  if (node.shape === "diamond") return { width: w + 28, height: h + 22 };
  if (node.shape === "circle") {
    const side = Math.max(w, h) + 8;
    return { width: side, height: side };
  }
  return { width: w, height: h };
}

function wrapLabel(label: string): string[] {
  const given = label.split("\n").flatMap((line) => line.split("\\n"));
  const out: string[] = [];
  for (const line of given) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (textWidth(trimmed) <= 148) {
      out.push(trimmed);
      continue;
    }
    let buf = "";
    for (const ch of trimmed) {
      const next = buf + ch;
      if (buf && textWidth(next) > 148) {
        out.push(buf);
        buf = ch === " " ? "" : ch;
      } else {
        buf = next;
      }
    }
    if (buf) out.push(buf);
  }
  return out.length > 0 ? out : [label || " "];
}

function textWidth(text: string): number {
  let width = 0;
  for (const ch of text) {
    width += /[\u1100-\u115F\u2E80-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF]/.test(ch) ? 12 : 7.05;
  }
  return width;
}

function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}

function hash(value: string): number {
  let h = 0;
  for (let i = 0; i < value.length; i += 1) h = (h * 31 + value.charCodeAt(i)) | 0;
  return h;
}
