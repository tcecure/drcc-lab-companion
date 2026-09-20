import { Radio } from "lucide-react";

import type { PublicOperationsSummary } from "@/lib/public-operations";

const statusDetails = {
  gray: {
    dot: "bg-slate-400",
    label: "Status updating",
    text: "text-slate-600",
  },
  green: {
    dot: "bg-emerald-500",
    label: "Labs operational",
    text: "text-emerald-700",
  },
  red: {
    dot: "bg-rose-400",
    label: "Labs unavailable",
    text: "text-rose-700",
  },
  yellow: {
    dot: "bg-amber-300",
    label: "Limited availability",
    text: "text-amber-700",
  },
};

export function calculateFilledCapacitySegments(
  assigned: number,
  capacity: number,
  segmentCount = 20,
) {
  const safeSegmentCount = Math.max(1, Math.floor(segmentCount));
  const safeCapacity = Math.max(1, capacity);
  const safeAssigned = Math.max(0, Math.min(assigned, safeCapacity));

  return Math.round((safeAssigned / safeCapacity) * safeSegmentCount);
}

export function HomeOperations({
  summary,
}: {
  summary: PublicOperationsSummary;
}) {
  const segmentCount = 20;
  const capacity = Math.max(1, summary.capacity);
  const assigned = Math.min(summary.activeStudents ?? 0, capacity);
  const filledSegments = calculateFilledCapacitySegments(
    assigned,
    capacity,
    segmentCount,
  );
  const status = statusDetails[summary.labStatus];

  return (
    <section
      aria-label="Current DigitalRCC lab availability"
      className="home-operations"
    >
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
        <div className="min-w-0">
          <div>
            <p className="text-sm font-bold text-slate-900">Lab capacity</p>
            <p className="mt-1 text-xs text-slate-500">
              Current student seat allocation
            </p>
          </div>

          <div
            aria-label="Current lab capacity utilization"
            className="mt-4 grid h-7 gap-1.5 sm:h-8"
            role="img"
            style={{
              gridTemplateColumns: `repeat(${segmentCount}, minmax(0, 1fr))`,
            }}
          >
            {Array.from({ length: segmentCount }, (_, index) => (
              <span
                aria-hidden="true"
                className={`rounded-sm border ${
                  index < filledSegments
                    ? "border-blue-300 bg-blue-500"
                    : "border-slate-200 bg-slate-100"
                }`}
                key={index}
              />
            ))}
          </div>
        </div>

        <div className="border-slate-200 lg:min-w-56 lg:border-l lg:pl-7">
          <p className="flex items-center gap-2 text-xs font-semibold uppercase text-slate-500">
            <Radio aria-hidden="true" size={15} />
            Lab status
          </p>
          <p
            className={`mt-2 flex items-center gap-2 text-sm font-bold ${status.text}`}
          >
            <span
              aria-hidden="true"
              className={`size-2 rounded-full ${status.dot}`}
            />
            {status.label}
          </p>
        </div>
      </div>
    </section>
  );
}

export function HomeOperationsFallback() {
  return (
    <section
      aria-busy="true"
      aria-label="Loading current lab availability"
      className="home-operations"
    >
      <div className="h-4 w-40 animate-pulse rounded-sm bg-slate-200" />
      <div className="mt-5 grid h-8 grid-cols-20 gap-1.5">
        {Array.from({ length: 20 }, (_, index) => (
          <span
            aria-hidden="true"
            className="rounded-sm border border-slate-200 bg-slate-100"
            key={index}
          />
        ))}
      </div>
    </section>
  );
}
