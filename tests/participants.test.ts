import { describe, expect, it } from "vitest";

import { parseParticipantCsv } from "@/lib/participants";

describe("parseParticipantCsv", () => {
  it("reads the booking export columns and ignores the rest", () => {
    const rows = parseParticipantCsv(
      [
        "Order,First Name,Last Name,Email,Phone,Booking Start Time,Amount Paid",
        '1001,James,Rivera,James.Rivera@example.com,555-0100,"Monday, August 17, 2026 12:00 AM",0',
      ].join("\n"),
    );

    expect(rows).toEqual([
      {
        fullName: "James Rivera",
        email: "james.rivera@example.com",
        labStartDate: "2026-08-17",
      },
    ]);
  });

  it("honours quoted commas and embedded newlines", () => {
    const rows = parseParticipantCsv(
      [
        "Name,Email,Notes",
        '"Rivera, James",james@example.com,"line one',
        'line two"',
      ].join("\n"),
    );

    expect(rows).toEqual([
      {
        fullName: "Rivera, James",
        email: "james@example.com",
        labStartDate: null,
      },
    ]);
  });

  it("lowercases emails and keeps only the first of each duplicate", () => {
    const rows = parseParticipantCsv(
      [
        "Name,Email",
        "James Rivera,James@Example.com",
        "James R,james@example.com",
        "Ada Lovelace,ada@example.com",
      ].join("\n"),
    );

    expect(rows.map((row) => row.email)).toEqual([
      "james@example.com",
      "ada@example.com",
    ]);
    expect(rows[0].fullName).toBe("James Rivera");
  });

  it("drops rows missing an email or a name", () => {
    const rows = parseParticipantCsv(
      [
        "Name,Email",
        ",nobody@example.com",
        "No Email,",
        "Ada,ada@example.com",
      ].join("\n"),
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].email).toBe("ada@example.com");
  });

  it("rejects a file without the required columns", () => {
    expect(() => parseParticipantCsv("Order,Phone\n1001,555-0100")).toThrow(
      /Email column/,
    );
  });

  it("leaves the start date null when it cannot be read", () => {
    const rows = parseParticipantCsv(
      ["Name,Email,Booking Start Time", "Ada,ada@example.com,not a date"].join(
        "\n",
      ),
    );

    expect(rows[0].labStartDate).toBeNull();
  });
});
