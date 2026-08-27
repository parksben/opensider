import type { ReactNode } from "react";

export function HighlightText({
  text,
  ranges,
  className = "",
}: {
  text: string;
  ranges: ReadonlyArray<readonly [number, number]>;
  className?: string;
}) {
  if (ranges.length === 0) return <span className={className}>{text}</span>;

  const parts: ReactNode[] = [];
  let last = 0;
  ranges.forEach(([start, end], index) => {
    if (start > last) parts.push(text.slice(last, start));
    parts.push(
      <mark key={`${start}-${index}`} className="cs-at-match">
        {text.slice(start, end)}
      </mark>,
    );
    last = end;
  });
  if (last < text.length) parts.push(text.slice(last));
  return <span className={className}>{parts}</span>;
}
