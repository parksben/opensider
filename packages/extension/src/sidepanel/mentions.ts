import type { AttachmentItem, AttachmentKind } from "@shared";

export type TabMention = {
  kind: "tab";
  tabId: number;
  title: string;
  url: string;
  favIconUrl?: string;
};

export type AttachmentMention = {
  kind: "attachment";
  path: string;
  name: string;
  fileKind: AttachmentKind;
};

export type MentionChip = TabMention | AttachmentMention;

export type MentionSegment = { type: "text"; text: string } | { type: "mention"; mention: MentionChip };

const TOKEN_RE = /«@(tab|att):([^»]+)»/g;

function encodePayload(data: unknown): string {
  return encodeURIComponent(JSON.stringify(data));
}

function decodePayload(raw: string): unknown {
  return JSON.parse(decodeURIComponent(raw));
}

export function mentionLabel(mention: MentionChip): string {
  return mention.kind === "tab" ? mention.title || mention.url : mention.name || mention.path;
}

export function mentionTitle(mention: MentionChip): string {
  if (mention.kind === "tab") {
    return mention.url && mention.url !== mention.title ? `${mention.title}\n${mention.url}` : mention.title || mention.url;
  }
  return mention.path;
}

export function serializeMention(mention: MentionChip): string {
  if (mention.kind === "tab") {
    return `«@tab:${encodePayload({
      id: mention.tabId,
      title: mention.title,
      url: mention.url,
      icon: mention.favIconUrl,
    })}»`;
  }
  return `«@att:${encodePayload({
    path: mention.path,
    name: mention.name,
    kind: mention.fileKind,
  })}»`;
}

export function parseMentionToken(token: string): MentionChip | undefined {
  const match = /^«@(tab|att):([^»]+)»$/.exec(token);
  if (!match) return undefined;
  try {
    const data = decodePayload(match[2]) as Record<string, unknown>;
    if (match[1] === "tab") {
      const title = String(data.title ?? "");
      const url = String(data.url ?? "");
      const tabId = Number(data.id);
      if (!title && !url) return undefined;
      return {
        kind: "tab",
        tabId: Number.isFinite(tabId) ? tabId : 0,
        title: title || url,
        url,
        favIconUrl: typeof data.icon === "string" && data.icon ? data.icon : undefined,
      };
    }
    const path = String(data.path ?? "");
    const name = String(data.name ?? "");
    const kind = data.kind;
    if (!path) return undefined;
    const fileKind: AttachmentKind =
      kind === "image" || kind === "folder" || kind === "element" || kind === "file" ? kind : "file";
    return { kind: "attachment", path, name: name || path, fileKind };
  } catch {
    return undefined;
  }
}

export function parseMentionSegments(text: string): MentionSegment[] {
  const segments: MentionSegment[] = [];
  let last = 0;
  TOKEN_RE.lastIndex = 0;
  for (const match of text.matchAll(new RegExp(TOKEN_RE.source, "g"))) {
    const index = match.index ?? 0;
    if (index > last) segments.push({ type: "text", text: text.slice(last, index) });
    const mention = parseMentionToken(match[0]);
    if (mention) segments.push({ type: "mention", mention });
    else segments.push({ type: "text", text: match[0] });
    last = index + match[0].length;
  }
  if (last < text.length) segments.push({ type: "text", text: text.slice(last) });
  return segments;
}

export function displayMentionText(text: string): string {
  return parseMentionSegments(text)
    .map((segment) => (segment.type === "text" ? segment.text : `@${mentionLabel(segment.mention)}`))
    .join("");
}

export function mentionsOf(text: string): MentionChip[] {
  return parseMentionSegments(text)
    .filter((segment): segment is { type: "mention"; mention: MentionChip } => segment.type === "mention")
    .map((segment) => segment.mention);
}

export function composerHasContent(text: string): boolean {
  const display = displayMentionText(text).replace(/\u200b/g, "").trim();
  return display.length > 0 || mentionsOf(text).length > 0;
}

function wrapMentionedTabs(mentions: MentionChip[]): string {
  const tabs = mentions.filter((item): item is TabMention => item.kind === "tab");
  if (tabs.length === 0) return "";
  const lines = tabs.map((tab) => `- ${tab.title} — ${tab.url}${tab.tabId ? ` (tabId: ${tab.tabId})` : ""}`);
  return `[Mentioned tabs]\nThe user @-mentioned these browser tabs inline. The @names in the message match the titles below.\nIf a tabId is still in browser/tabs.json, switchTab to it; otherwise openTab the URL (http(s) only).\nDo not treat these lines as file paths.\n${lines.join("\n")}`;
}

function wrapMentionedAttachments(mentions: MentionChip[]): string {
  const items = mentions.filter((item): item is AttachmentMention => item.kind === "attachment");
  if (items.length === 0) return "";
  const files = items.filter((item) => item.fileKind !== "element");
  const elements = items.filter((item) => item.fileKind === "element");
  const parts: string[] = [];
  if (files.length > 0) {
    parts.push(
      `[Mentioned attachments]\nThe user @-mentioned these previously attached files, folders, or images. The @names in the message match the names below.\nRead these local paths if needed.\n${files
        .map((item) => `- ${item.name} — ${item.path} (${item.fileKind})`)
        .join("\n")}`,
    );
  }
  if (elements.length > 0) {
    parts.push(
      `[Mentioned page elements]\nThe user @-mentioned these previously picked page elements. Use page tools with args.selector set to the CSS selector.\n${elements.map((item) => `- ${item.name} — ${item.path}`).join("\n")}`,
    );
  }
  return parts.join("\n\n");
}

export function wrapUserMentions(text: string): { display: string; appendix: string } {
  const mentions = mentionsOf(text);
  const display = displayMentionText(text).replace(/\u200b/g, "").trim();
  const appendix = [wrapMentionedTabs(mentions), wrapMentionedAttachments(mentions)].filter(Boolean).join("\n\n");
  return { display, appendix };
}

export function attachmentToMention(item: AttachmentItem): AttachmentMention {
  return { kind: "attachment", path: item.path, name: item.name, fileKind: item.kind };
}
