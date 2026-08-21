import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  CircleDot,
} from "lucide-react";

import {
  cohortUpdate,
  currentLabNotices,
  expectedLabBehaviors,
  resolvedLabIssues,
  supportContentLastUpdated,
} from "@/lib/support";

export function KnownIssuesSummary() {
  return (
    <section
      aria-labelledby="known-issues-heading"
      className="overflow-hidden rounded-lg border border-cyan-200/15 bg-slate-950/55 shadow-2xl shadow-slate-950/20"
    >
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-cyan-200/10 p-5 sm:p-6">
        <div>
          <h2 id="known-issues-heading" className="text-2xl font-bold">
            Known issues and lab notices
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">
            Current workarounds, expected lab behavior, and resolved issue
            history.
          </p>
        </div>
        <Link className="button secondary" href="/support">
          View all guidance
          <ArrowRight aria-hidden="true" size={16} />
        </Link>
      </div>
      <dl className="grid border-b border-cyan-200/10 sm:grid-cols-3">
        <SummaryMetric
          label="Current workarounds"
          value={currentLabNotices.length}
        />
        <SummaryMetric
          label="Resolved issues"
          value={resolvedLabIssues.length}
        />
        <SummaryMetric
          label="Expected behaviors"
          value={expectedLabBehaviors.length}
        />
      </dl>
      <div className="divide-y divide-cyan-200/10">
        {currentLabNotices.slice(0, 3).map((notice) => (
          <Link
            className="flex min-h-16 items-center justify-between gap-4 px-5 py-4 text-sm font-bold text-slate-100 hover:bg-white/5 sm:px-6"
            href="/support#current-notices"
            key={notice.title}
          >
            <span className="flex items-start gap-3">
              <AlertTriangle
                aria-hidden="true"
                className="mt-0.5 shrink-0 text-amber-200"
                size={17}
              />
              <span>{notice.title}</span>
            </span>
            <ArrowRight
              aria-hidden="true"
              className="shrink-0 text-cyan-200"
              size={16}
            />
          </Link>
        ))}
      </div>
    </section>
  );
}

function SummaryMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="border-cyan-200/10 px-5 py-4 sm:border-r sm:last:border-r-0 sm:px-6">
      <dt className="text-xs font-bold uppercase text-cyan-100/60">{label}</dt>
      <dd className="mt-1 text-2xl font-bold text-white">{value}</dd>
    </div>
  );
}

export function CurrentLabNotices() {
  return (
    <section
      aria-labelledby="current-notices-heading"
      className="overflow-hidden rounded-lg border border-cyan-200/15 bg-slate-950/55"
      id="current-notices"
    >
      <div className="border-b border-cyan-200/10 p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="current-notices-heading" className="text-2xl font-bold">
            Current workarounds
          </h2>
          <span className="rounded-full border border-amber-300/20 bg-amber-400/10 px-3 py-1 text-xs font-bold text-amber-100">
            Action required
          </span>
        </div>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">
          These conditions are known and already handled. Follow the listed
          step; nothing is broken on your account, and these items will not
          prevent course completion.
        </p>
        <p className="mt-2 text-xs font-semibold text-slate-400">
          Last updated {supportContentLastUpdated}
        </p>
      </div>
      <div className="divide-y divide-cyan-200/10">
        {currentLabNotices.map((notice, index) => (
          <details className="group" key={notice.title}>
            <summary className="flex min-h-20 cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 hover:bg-white/5 sm:px-6 [&::-webkit-details-marker]:hidden">
              <span className="flex min-w-0 items-start gap-3">
                <span className="mt-0.5 text-xs font-bold text-amber-200">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span>
                  <span className="block font-bold text-white">
                    {notice.title}
                  </span>
                  <span className="mt-1 block text-xs font-bold uppercase text-cyan-100/55">
                    {notice.area}
                  </span>
                </span>
              </span>
              <ChevronDown
                aria-hidden="true"
                className="shrink-0 text-slate-400 transition-transform group-open:rotate-180"
                size={18}
              />
            </summary>
            <div className="border-t border-cyan-200/10 bg-slate-950/30 px-5 py-5 sm:pl-14 sm:pr-8">
              <NoticeDetail label="What you see" value={notice.symptom} />
              <NoticeDetail label="What to do" value={notice.guidance} />
              {notice.commands?.length ? (
                <div className="mt-4 grid gap-2">
                  {notice.commands.map((command) => (
                    <code
                      className="overflow-x-auto rounded-md border border-cyan-200/10 bg-slate-950/80 px-3 py-2 text-xs leading-5 text-cyan-100"
                      key={command}
                    >
                      {command}
                    </code>
                  ))}
                </div>
              ) : null}
              <NoticeDetail label="Why" value={notice.reason} />
              <NoticeDetail label="Completion note" value={notice.note} />
            </div>
          </details>
        ))}
      </div>
    </section>
  );
}

function NoticeDetail({ label, value }: { label: string; value?: string }) {
  if (!value) return null;

  return (
    <p className="mt-3 max-w-4xl text-sm leading-6 text-slate-300 first:mt-0">
      <strong className="text-slate-100">{label}:</strong> {value}
    </p>
  );
}

export function ExpectedBehaviorNotices() {
  return (
    <section
      aria-labelledby="expected-behavior-heading"
      className="rounded-lg border border-cyan-200/15 bg-slate-950/55 p-5 sm:p-6"
    >
      <div className="flex items-center gap-3">
        <CircleDot aria-hidden="true" className="text-cyan-200" size={21} />
        <h2 id="expected-behavior-heading" className="text-2xl font-bold">
          Expected behavior
        </h2>
      </div>
      <div className="mt-5 divide-y divide-cyan-200/10">
        {expectedLabBehaviors.map((behavior) => (
          <article className="py-4 first:pt-0 last:pb-0" key={behavior.title}>
            <h3 className="font-bold text-white">{behavior.title}</h3>
            <p className="mt-2 text-sm leading-6 text-slate-300">
              {behavior.description}
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}

export function ResolvedIssuesArchive() {
  return (
    <section
      aria-labelledby="resolved-issues-heading"
      className="overflow-hidden rounded-lg border border-cyan-200/15 bg-slate-950/55"
    >
      <div className="border-b border-cyan-200/10 p-5 sm:p-6">
        <div className="flex items-center gap-3">
          <CheckCircle2
            aria-hidden="true"
            className="text-cyan-200"
            size={21}
          />
          <h2 id="resolved-issues-heading" className="text-2xl font-bold">
            Resolved issues
          </h2>
        </div>
        <p className="mt-2 text-sm leading-6 text-slate-300">
          No action is required for these previously reported conditions.
        </p>
      </div>
      <div className="divide-y divide-cyan-200/10">
        {resolvedLabIssues.map((item) => (
          <article
            className="grid gap-2 p-5 sm:p-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-8"
            key={item.issue}
          >
            <h3 className="text-sm font-bold text-slate-100">{item.issue}</h3>
            <p className="text-sm leading-6 text-slate-300">
              {item.resolution}
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}

export function CohortUpdate() {
  return (
    <section className="rounded-lg border border-cyan-200/15 bg-cyan-400/5 p-5 sm:p-6">
      <div className="flex items-start gap-3">
        <CalendarClock
          aria-hidden="true"
          className="mt-0.5 shrink-0 text-cyan-200"
          size={21}
        />
        <div>
          <h2 className="text-xl font-bold">Coming later this cohort</h2>
          <p className="mt-2 text-sm leading-6 text-slate-300">
            {cohortUpdate}
          </p>
        </div>
      </div>
    </section>
  );
}
