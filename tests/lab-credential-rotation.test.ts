import { randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.LAB_CREDENTIAL_ENCRYPTION_KEY = randomBytes(32).toString("base64");

type Row = Record<string, unknown>;

const credentials: Row[] = [];
const events: Row[] = [];

function matches(row: Row, filters: Array<[string, unknown]>) {
  return filters.every(([column, value]) =>
    Array.isArray(value) ? value.includes(row[column]) : row[column] === value,
  );
}

function table(name: string) {
  const rows = name === "lab_pod_credentials" ? credentials : events;

  function query(mutate?: (row: Row) => void) {
    const filters: Array<[string, unknown]> = [];
    const builder = {
      eq(column: string, value: unknown) {
        filters.push([column, value]);

        return builder;
      },
      in(column: string, value: unknown[]) {
        filters.push([column, value]);

        return builder;
      },
      limit() {
        return builder;
      },
      order() {
        return builder;
      },
      select() {
        return builder;
      },
      maybeSingle() {
        return Promise.resolve({
          data: builder.resolve()[0] ?? null,
          error: null,
        });
      },
      resolve() {
        const selected = rows.filter((row) => matches(row, filters));

        if (mutate) {
          selected.forEach(mutate);
        }

        return selected.map((row) => ({ ...row }));
      },
      then(resolve: (value: { data: Row[]; error: null }) => unknown) {
        return resolve({ data: builder.resolve(), error: null });
      },
    };

    return builder;
  }

  return {
    insert(values: Row) {
      rows.push({ ...values, created_at: new Date().toISOString() });

      return Promise.resolve({ data: null, error: null });
    },
    select: () => query(),
    update(values: Row) {
      return query((row) => Object.assign(row, values));
    },
    upsert(values: Row) {
      const existing = rows.find(
        (row) => row.seat_number === values.seat_number,
      );

      if (existing) {
        Object.assign(existing, values);
      } else {
        rows.push({ ...values });
      }

      return Promise.resolve({ data: null, error: null });
    },
  };
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: table }),
}));

const {
  listPendingRotations,
  markRotationPushed,
  revealLabCredential,
  rotateLabCredential,
  storeLabCredential,
} = await import("@/lib/lab-credentials");

const staff = { role: "staff" as const, userId: "staff-1" };
const student = { role: "student" as const, userId: "student-1" };

async function seat(password: string) {
  await storeLabCredential({
    actor: staff,
    markPendingPush: false,
    password,
    seatNumber: 2,
  });
}

beforeEach(() => {
  credentials.length = 0;
  events.length = 0;
});

describe("rotation continuity", () => {
  it("keeps serving the working password while a rotation is pending", async () => {
    await seat("Canyon-aaaaaa-11");
    const staged = await rotateLabCredential({ actor: staff, seatNumber: 2 });

    const revealed = await revealLabCredential(2, student);

    expect(staged).not.toBe("Canyon-aaaaaa-11");
    expect(revealed?.password).toBe("Canyon-aaaaaa-11");
    expect(revealed?.rotationPending).toBe(true);
  });

  it("hands only the staged password to the bridge", async () => {
    await seat("Canyon-aaaaaa-11");
    const staged = await rotateLabCredential({ actor: staff, seatNumber: 2 });

    const pending = await listPendingRotations();

    expect(pending).toHaveLength(1);
    expect(pending[0].password).toBe(staged);
  });

  it("promotes the staged password once the push is acknowledged", async () => {
    await seat("Canyon-aaaaaa-11");
    const staged = await rotateLabCredential({ actor: staff, seatNumber: 2 });

    expect(await markRotationPushed([2])).toEqual([2]);

    const revealed = await revealLabCredential(2, student);

    expect(revealed?.password).toBe(staged);
    expect(revealed?.status).toBe("active");
    expect(revealed?.rotationPending).toBe(false);
    expect(await listPendingRotations()).toEqual([]);
  });

  it("ignores a repeated acknowledgement", async () => {
    await seat("Canyon-aaaaaa-11");
    await rotateLabCredential({ actor: staff, seatNumber: 2 });

    await markRotationPushed([2]);

    expect(await markRotationPushed([2])).toEqual([]);
  });

  it("has no password to give before the first push", async () => {
    await rotateLabCredential({ actor: staff, seatNumber: 2 });

    const revealed = await revealLabCredential(2, student);

    expect(revealed?.password).toBeNull();
    expect(events.filter((event) => event.action === "reveal")).toEqual([]);
  });

  it("logs a reveal only when a password was disclosed", async () => {
    await seat("Canyon-aaaaaa-11");
    await revealLabCredential(2, student);

    expect(events.filter((event) => event.action === "reveal")).toHaveLength(1);
  });
});
