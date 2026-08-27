import { AlertTriangle, CheckCircle2, CircleHelp, Info } from "lucide-react";
import {
  isValidElement,
  type AnchorHTMLAttributes,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import type { MDXComponents } from "mdx/types";

import { CopyCommandButton } from "@/components/copy-command-button";
import { replaceGuideTokens } from "@/lib/digital-guides";
import type { StudentLabIdentity } from "@/lib/student-lab";

type GuideContainerProps = {
  children: ReactNode;
  id: string;
  index: string;
  title: string;
};

type GuideLabProps = {
  children: ReactNode;
  id: string;
  objective: string;
  title: string;
};

type GuideCalloutProps = {
  children: ReactNode;
  title: string;
  tone?: "check" | "info" | "warning";
};

function GuideSection({ children, id, index, title }: GuideContainerProps) {
  return (
    <section className="guide-section" id={id}>
      <header className="guide-section-header">
        <span className="guide-section-index">{index}</span>
        <h2>{title}</h2>
      </header>
      <div className="guide-section-content">{children}</div>
    </section>
  );
}

function GuideLab({ children, id, objective, title }: GuideLabProps) {
  return (
    <section className="guide-lab" id={id.toLowerCase().replace(".", "-")}>
      <header className="guide-lab-header">
        <span className="guide-lab-code">{id}</span>
        <div>
          <h3>{title}</h3>
          <p>{objective}</p>
        </div>
      </header>
      <div className="guide-lab-content">{children}</div>
    </section>
  );
}

function GuideCallout({ children, title, tone = "info" }: GuideCalloutProps) {
  const Icon =
    tone === "warning" ? AlertTriangle : tone === "check" ? CheckCircle2 : Info;

  return (
    <aside className={`guide-callout guide-callout-${tone}`}>
      <Icon aria-hidden="true" size={19} />
      <div>
        <p className="guide-callout-title">{title}</p>
        <div>{children}</div>
      </div>
    </aside>
  );
}

function GuideField({
  identity,
  label,
  value,
}: {
  identity: StudentLabIdentity | null;
  label: string;
  value: string;
}) {
  return (
    <div className="guide-field">
      <dt>{label}</dt>
      <dd>{replaceGuideTokens(value, identity)}</dd>
    </div>
  );
}

function getTextContent(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }

  if (Array.isArray(node)) {
    return node.map(getTextContent).join("");
  }

  if (isValidElement<{ children?: ReactNode }>(node)) {
    return getTextContent(node.props.children);
  }

  return "";
}

function GuideCodeBlock({
  children,
  identity,
}: {
  children?: ReactNode;
  identity: StudentLabIdentity | null;
}) {
  const command = replaceGuideTokens(getTextContent(children).trim(), identity);

  return (
    <div className="guide-command">
      <div className="guide-command-bar">
        <span>PowerShell</span>
        <CopyCommandButton command={command} />
      </div>
      <pre>
        <code>{command}</code>
      </pre>
    </div>
  );
}

function GuideLink(props: AnchorHTMLAttributes<HTMLAnchorElement>) {
  const external = props.href?.startsWith("http");

  return (
    <a
      {...props}
      rel={external ? "noreferrer" : props.rel}
      target={external ? "_blank" : props.target}
    />
  );
}

export function getDigitalGuideComponents(
  identity: StudentLabIdentity | null,
): MDXComponents {
  return {
    GuideCallout,
    GuideField: (props: { label: string; value: string }) => (
      <GuideField {...props} identity={identity} />
    ),
    GuideLab,
    GuideSection,
    a: GuideLink,
    code: (props: HTMLAttributes<HTMLElement>) => (
      <code {...props}>
        {replaceGuideTokens(getTextContent(props.children), identity)}
      </code>
    ),
    h3: (props: HTMLAttributes<HTMLHeadingElement>) => (
      <h3 className="guide-heading" {...props} />
    ),
    li: (props: HTMLAttributes<HTMLLIElement>) => <li {...props} />,
    ol: (props: HTMLAttributes<HTMLOListElement>) => (
      <ol className="guide-steps" {...props} />
    ),
    p: (props: HTMLAttributes<HTMLParagraphElement>) => <p {...props} />,
    pre: (props: HTMLAttributes<HTMLPreElement>) => (
      <GuideCodeBlock identity={identity}>{props.children}</GuideCodeBlock>
    ),
    table: (props: HTMLAttributes<HTMLTableElement>) => (
      <div className="guide-table-wrap">
        <table {...props} />
      </div>
    ),
    ul: (props: HTMLAttributes<HTMLUListElement>) => (
      <ul className="guide-list" {...props} />
    ),
  };
}

export function GuidePendingNotice() {
  return (
    <div className="guide-pending-notice">
      <CircleHelp aria-hidden="true" size={20} />
      <p>
        Your pod is still being assigned. The guide uses <strong>XX</strong>
        placeholders until your seat is ready; return after scheduling for
        personalized commands.
      </p>
    </div>
  );
}
