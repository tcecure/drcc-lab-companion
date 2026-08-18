import { beforeEach, describe, expect, it, vi } from "vitest";

const pendingRows: Record<string, unknown>[] = [];
const occupiedSeats: { seat_number: number | null }[] = [];
const updates: Record<string, unknown>[] = [];

function selectBuilder(rows: unknown[]) {
  const builder: Record<string, unknown> = {
    then: (resolve: (value: { data: unknown[]; error: null }) => unknown) =>
      resolve({ data: rows, error: null }),
  };

  for (const method of ["is", "eq", "neq", "not", "order", "select"]) {
    builder[method] = () => builder;
  }

  return builder;
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      select: (columns: string) =>
        selectBuilder(columns === "seat_number" ? occupiedSeats : pendingRows),
      update: (values: Record<string, unknown>) => {
        updates.push(values);

        return selectBuilder([]);
      },
    }),
  }),
}));

const { assignDueCohortSeats } = await import("@/lib/cohorts");
const { getCohortSchedule } = await import("@/lib/cohorts");

function queued(id: string, cohortNumber = 2) {
  return {
    id,
    user_id: `user-${id}`,
    cohort_number: cohortNumber,
    seat_number: null,
    status: "queued",
  };
}

beforeEach(() => {
  pendingRows.length = 0;
  occupiedSeats.length = 0;
  updates.length = 0;
});

describe("assignDueCohortSeats", () => {
  const runAt = new Date(getCohortSchedule(2).assignmentRunAt);

  it("assigns nothing before 01:00 Eastern on the cohort start date", async () => {
    pendingRows.push(queued("a"), queued("b"));

    const result = await assignDueCohortSeats(
      new Date(runAt.getTime() - 60_000),
    );

    expect(result.assigned).toEqual([]);
    expect(updates).toEqual([]);
  });

  it("hands out the lowest free seats in queue order once due", async () => {
    pendingRows.push(queued("a"), queued("b"));
    occupiedSeats.push({ seat_number: 1 });

    const result = await assignDueCohortSeats(runAt);

    expect(
      result.assigned.map((row) => [row.id, row.seatNumber, row.labUsername]),
    ).toEqual([
      ["a", 2, "student02"],
      ["b", 3, "student03"],
    ]);
    expect(updates).toHaveLength(2);
    expect(updates[0]).toMatchObject({
      seat_number: 2,
      pod_name: "Pod02",
      status: "notified",
    });
  });

  it("skips a student when the cohort is full", async () => {
    pendingRows.push(queued("a"));

    for (let seat = 1; seat <= 20; seat += 1) {
      occupiedSeats.push({ seat_number: seat });
    }

    const result = await assignDueCohortSeats(runAt);

    expect(result.assigned).toEqual([]);
    expect(result.skipped).toEqual([
      { id: "a", reason: "Cohort 2 has no free seat." },
    ]);
  });
});
