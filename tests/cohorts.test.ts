import { describe, expect, it } from "vitest";

import {
  cohortConfig,
  getCohortNumberForStartDate,
  getCohortSchedule,
  getLabIdentity,
  getPodName,
} from "@/lib/cohorts";

describe("cohort calendar", () => {
  it("starts cohort 2 on the 9/6 date and then runs every two weeks", () => {
    expect(getCohortSchedule(1).startDate).toBe(
      cohortConfig.firstCohortStartDate,
    );
    expect(getCohortSchedule(2).startDate).toBe("2026-09-06");
    expect(getCohortSchedule(3).startDate).toBe("2026-09-20");
    expect(getCohortSchedule(4).startDate).toBe("2026-10-04");
  });

  it("assigns student numbers at 01:00 Eastern, across the DST change", () => {
    // EDT (UTC-4) in September, EST (UTC-5) in December.
    expect(getCohortSchedule(2).assignmentRunAt).toBe(
      "2026-09-06T05:00:00.000Z",
    );
    expect(getCohortSchedule(9).assignmentRunAt).toBe(
      "2026-12-13T06:00:00.000Z",
    );
  });

  it("opens access at local midnight and closes it two weeks later", () => {
    const schedule = getCohortSchedule(2);

    expect(schedule.accessStartsAt).toBe("2026-09-06T04:00:00.000Z");
    expect(schedule.accessEndsAt).toBe("2026-09-20T04:00:00.000Z");
    expect(new Date(schedule.assignmentRunAt).getTime()).toBeGreaterThan(
      new Date(schedule.accessStartsAt).getTime(),
    );
  });

  it("maps a booking form date to the cohort that starts on or after it", () => {
    expect(getCohortNumberForStartDate("2026-08-17")).toBe(2);
    expect(getCohortNumberForStartDate("2026-09-06")).toBe(2);
    expect(getCohortNumberForStartDate("2026-09-07")).toBe(3);
    expect(getCohortNumberForStartDate("2099-01-01")).toBeNull();
  });

  it("derives the pod and lab username from the student number", () => {
    expect(getPodName(3)).toBe("Pod03");
    expect(getLabIdentity(12)).toEqual({
      labUsername: "student12",
      podName: "Pod12",
    });
  });
});
