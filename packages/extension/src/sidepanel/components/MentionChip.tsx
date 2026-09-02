import type { AttachmentKind } from "@shared";
import { File, Folder, Globe, Image, MousePointer2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  mentionLabel,
  mentionTitle,
  parseMentionSegments,
  type MentionChip as Mention,
} from "../mentions";
import { tabFaviconCandidates } from "../tab-favicon";

export function kindIcon(kind: AttachmentKind) {
  if (kind === "image") return Image;
  if (kind === "folder") return Folder;
  if (kind === "element") return MousePointer2;
  return File;
}

export function TabFavicon({ pageUrl, favIconUrl }: { pageUrl?: string; favIconUrl?: string }) {
  const candidates = useMemo(() => tabFaviconCandidates(pageUrl, favIconUrl), [pageUrl, favIconUrl]);
  const [index, setIndex] = useState(0);
  useEffect(() => {
    setIndex(0);
  }, [pageUrl, favIconUrl]);
  const src = candidates[index];
  if (!src) return <Globe size={12} className="shrink-0 opacity-80" />;
  return (
    <img
      key={src}
      src={src}
      alt=""
      referrerPolicy="no-referrer"
      className="h-3 w-3 shrink-0 rounded-[2px] object-cover"
      onError={() => setIndex((current) => current + 1)}
    />
  );
}

export function MentionIcon({ mention }: { mention: Mention }) {
  if (mention.kind === "tab") return <TabFavicon pageUrl={mention.url} favIconUrl={mention.favIconUrl} />;
  const Icon = kindIcon(mention.fileKind);
  return <Icon size={12} className="shrink-0 opacity-80" />;
}

export function MentionChip({ mention, className = "" }: { mention: Mention; className?: string }) {
  return (
    <span title={mentionTitle(mention)} className={`cs-mention-chip ${className}`}>
      <MentionIcon mention={mention} />
      <span className="cs-mention-chip-label truncate">{mentionLabel(mention)}</span>
    </span>
  );
}

export function UserRichText({ text }: { text: string }) {
  const segments = parseMentionSegments(text);
  if (segments.length === 0) return null;
  return (
    <div className="whitespace-pre-wrap break-words leading-[1.5]">
      {segments.map((segment, index) =>
        segment.type === "text" ? (
          <span key={index}>{segment.text}</span>
        ) : (
          <MentionChip key={`${index}-${mentionLabel(segment.mention)}`} mention={segment.mention} />
        ),
      )}
    </div>
  );
}
