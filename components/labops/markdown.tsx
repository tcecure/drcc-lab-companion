/**
 * Renders parsed Markdown as React elements. Text is always text: nothing on this path
 * sets HTML, so an assistant reply cannot inject markup or script into the console.
 */

import { Fragment } from "react";

import { parseMarkdown, type InlineToken } from "@/lib/labops/markdown";

function Inline({ tokens }: { tokens: InlineToken[] }) {
  return (
    <>
      {tokens.map((token, index) => {
        switch (token.type) {
          case "code":
            return (
              <code
                className="rounded bg-slate-950/70 px-1.5 py-0.5 font-mono text-[0.85em] text-cyan-100"
                key={index}
              >
                {token.text}
              </code>
            );
          case "strong":
            return <strong key={index}>{token.text}</strong>;
          case "em":
            return <em key={index}>{token.text}</em>;
          case "link":
            return (
              <a
                className="text-cyan-200 underline"
                href={token.href}
                key={index}
                rel="noreferrer noopener nofollow"
                target="_blank"
              >
                {token.text}
              </a>
            );
          default:
            return <Fragment key={index}>{token.text}</Fragment>;
        }
      })}
    </>
  );
}

export function Markdown({ source }: { source: string }) {
  return (
    <div className="grid gap-3 text-sm leading-6 text-slate-200">
      {parseMarkdown(source).map((block, index) => {
        switch (block.type) {
          case "heading": {
            const size =
              block.level === 1 ? "text-lg" : block.level === 2 ? "text-base" : "text-sm";

            return (
              <p className={`font-bold ${size}`} key={index}>
                <Inline tokens={block.inline} />
              </p>
            );
          }
          case "code":
            return (
              <pre
                className="table-wrap overflow-x-auto rounded-lg border border-cyan-200/10 bg-slate-950/70 p-3 font-mono text-xs leading-5 text-slate-100"
                key={index}
              >
                <code>{block.text}</code>
              </pre>
            );
          case "list":
            return block.ordered ? (
              <ol className="ml-5 list-decimal gap-1" key={index}>
                {block.items.map((item, itemIndex) => (
                  <li key={itemIndex}>
                    <Inline tokens={item} />
                  </li>
                ))}
              </ol>
            ) : (
              <ul className="ml-5 list-disc gap-1" key={index}>
                {block.items.map((item, itemIndex) => (
                  <li key={itemIndex}>
                    <Inline tokens={item} />
                  </li>
                ))}
              </ul>
            );
          case "quote":
            return (
              <blockquote
                className="border-l-2 border-cyan-200/30 pl-3 text-slate-300"
                key={index}
              >
                <Inline tokens={block.inline} />
              </blockquote>
            );
          default:
            return (
              <p key={index}>
                <Inline tokens={block.inline} />
              </p>
            );
        }
      })}
    </div>
  );
}
