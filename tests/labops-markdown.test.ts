import { describe, expect, it } from "vitest";

import { isSafeHref, parseInline, parseMarkdown } from "@/lib/labops/markdown";

describe("reading an assistant reply as Markdown", () => {
  it("keeps raw HTML as text rather than markup", () => {
    const blocks = parseMarkdown('<script>alert(1)</script> and <b>bold</b>');

    expect(blocks).toEqual([
      {
        type: "paragraph",
        inline: [{ type: "text", text: "<script>alert(1)</script> and <b>bold</b>" }],
      },
    ]);
  });

  it("refuses to make an executable or embedded URL clickable", () => {
    expect(isSafeHref("javascript:alert(1)")).toBe(false);
    expect(isSafeHref("data:text/html;base64,PHNjcmlwdD4=")).toBe(false);
    expect(isSafeHref("file:///etc/labops/model-proxy.env")).toBe(false);
    expect(isSafeHref("not a url")).toBe(false);

    for (const href of ["javascript:alert(1)", "data:text/html,<script>", "file:///etc/passwd"]) {
      expect(parseInline(`[click](${href})`).some((token) => token.type === "link")).toBe(false);
    }
  });

  it("links the protocols a browser can safely follow", () => {
    expect(isSafeHref("https://labops.drcc.digitalrcc.com/labops")).toBe(true);
    expect(isSafeHref("http://192.168.1.103")).toBe(true);
    expect(isSafeHref("mailto:eddie.barlow@tcecure.com")).toBe(true);

    expect(parseInline("see [the console](https://labops.drcc.digitalrcc.com/labops) now")).toEqual([
      { type: "text", text: "see " },
      {
        type: "link",
        text: "the console",
        href: "https://labops.drcc.digitalrcc.com/labops",
      },
      { type: "text", text: " now" },
    ]);
  });

  it("reads code blocks whole, without interpreting what is inside them", () => {
    const blocks = parseMarkdown(
      ["Try:", "", "```bash", "nft list ruleset  # **not bold**", "```"].join("\n"),
    );

    expect(blocks).toEqual([
      { type: "paragraph", inline: [{ type: "text", text: "Try:" }] },
      { type: "code", language: "bash", text: "nft list ruleset  # **not bold**" },
    ]);
  });

  it("keeps an unclosed fence as a code block instead of losing the rest of the reply", () => {
    expect(parseMarkdown("```\nsystemctl status labops-gateway")).toEqual([
      { type: "code", language: null, text: "systemctl status labops-gateway" },
    ]);
  });

  it("reads headings, lists and quotes", () => {
    expect(
      parseMarkdown(
        ["## What I found", "", "- `nft` shows a default deny", "- the seed job never ran", "", "> Reseed M4-L1 first."].join(
          "\n",
        ),
      ),
    ).toEqual([
      { type: "heading", level: 2, inline: [{ type: "text", text: "What I found" }] },
      {
        type: "list",
        ordered: false,
        items: [
          [{ type: "code", text: "nft" }, { type: "text", text: " shows a default deny" }],
          [{ type: "text", text: "the seed job never ran" }],
        ],
      },
      { type: "quote", inline: [{ type: "text", text: "Reseed M4-L1 first." }] },
    ]);

    expect(parseMarkdown("1. first\n2. second")).toEqual([
      {
        type: "list",
        ordered: true,
        items: [[{ type: "text", text: "first" }], [{ type: "text", text: "second" }]],
      },
    ]);
  });

  it("reads emphasis and inline code", () => {
    expect(parseInline("**stop** the *run* with `Ctrl+C`")).toEqual([
      { type: "strong", text: "stop" },
      { type: "text", text: " the " },
      { type: "em", text: "run" },
      { type: "text", text: " with " },
      { type: "code", text: "Ctrl+C" },
    ]);
  });
});
