/**
 * A deliberately small Markdown reader for assistant replies.
 *
 * The console renders model output, so the safe move is to never have HTML in the first
 * place: this produces a token tree the renderer turns into React elements. Nothing here
 * emits markup, no `dangerouslySetInnerHTML` is involved anywhere downstream, and a link
 * survives only if it is plainly http(s) or mailto — anything else stays as text, so a
 * `javascript:` or `data:` URL cannot become a clickable link.
 */

export type InlineToken =
  | { type: "text"; text: string }
  | { type: "code"; text: string }
  | { type: "strong"; text: string }
  | { type: "em"; text: string }
  | { type: "link"; text: string; href: string };

export type MarkdownBlock =
  | { type: "paragraph"; inline: InlineToken[] }
  | { type: "heading"; level: 1 | 2 | 3; inline: InlineToken[] }
  | { type: "list"; ordered: boolean; items: InlineToken[][] }
  | { type: "quote"; inline: InlineToken[] }
  | { type: "code"; language: string | null; text: string };

const safeLinkProtocols = new Set(["http:", "https:", "mailto:"]);

/** True only for a URL a browser can follow without executing anything. */
export function isSafeHref(href: string) {
  try {
    return safeLinkProtocols.has(new URL(href).protocol);
  } catch {
    return false;
  }
}

const inlinePattern =
  /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*)|(_[^_]+_)|(\[[^\]]+\]\([^)\s]+\))/;

export function parseInline(text: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  let rest = text;

  while (rest.length > 0) {
    const match = inlinePattern.exec(rest);

    if (!match || match.index === undefined) {
      tokens.push({ type: "text", text: rest });
      break;
    }

    if (match.index > 0) {
      tokens.push({ type: "text", text: rest.slice(0, match.index) });
    }

    const piece = match[0];

    if (piece.startsWith("`")) {
      tokens.push({ type: "code", text: piece.slice(1, -1) });
    } else if (piece.startsWith("**")) {
      tokens.push({ type: "strong", text: piece.slice(2, -2) });
    } else if (piece.startsWith("*") || piece.startsWith("_")) {
      tokens.push({ type: "em", text: piece.slice(1, -1) });
    } else {
      const label = piece.slice(1, piece.indexOf("]"));
      const href = piece.slice(piece.indexOf("(") + 1, -1);

      tokens.push(
        isSafeHref(href)
          ? { type: "link", text: label, href }
          : // Unsafe scheme: show what it said, do not make it clickable.
            { type: "text", text: `${label} (${href})` },
      );
    }

    rest = rest.slice(match.index + piece.length);
  }

  return tokens.filter((token) => token.type !== "text" || token.text.length > 0);
}

/** Parses the subset of Markdown a chat reply actually uses. */
export function parseMarkdown(source: string): MarkdownBlock[] {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks: MarkdownBlock[] = [];
  let paragraph: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length > 0) {
      blocks.push({ type: "paragraph", inline: parseInline(paragraph.join(" ")) });
      paragraph = [];
    }
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const fence = /^\s*```(\w+)?\s*$/.exec(line);

    if (fence) {
      flushParagraph();

      const body: string[] = [];

      index += 1;

      while (index < lines.length && !/^\s*```\s*$/.test(lines[index])) {
        body.push(lines[index]);
        index += 1;
      }

      blocks.push({ type: "code", language: fence[1] ?? null, text: body.join("\n") });
      continue;
    }

    if (line.trim().length === 0) {
      flushParagraph();
      continue;
    }

    const heading = /^(#{1,3})\s+(.*)$/.exec(line);

    if (heading) {
      flushParagraph();
      blocks.push({
        type: "heading",
        level: heading[1].length as 1 | 2 | 3,
        inline: parseInline(heading[2]),
      });
      continue;
    }

    const quote = /^>\s?(.*)$/.exec(line);

    if (quote) {
      flushParagraph();
      blocks.push({ type: "quote", inline: parseInline(quote[1]) });
      continue;
    }

    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
    const ordered = /^\s*\d+[.)]\s+(.*)$/.exec(line);

    if (bullet || ordered) {
      flushParagraph();

      const isOrdered = Boolean(ordered);
      const items: InlineToken[][] = [];

      while (index < lines.length) {
        const item = isOrdered
          ? /^\s*\d+[.)]\s+(.*)$/.exec(lines[index])
          : /^\s*[-*+]\s+(.*)$/.exec(lines[index]);

        if (!item) {
          break;
        }

        items.push(parseInline(item[1]));
        index += 1;
      }

      index -= 1;
      blocks.push({ type: "list", ordered: isOrdered, items });
      continue;
    }

    paragraph.push(line.trim());
  }

  flushParagraph();

  return blocks;
}
