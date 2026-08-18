/**
 * The only participant-export columns the lab queue needs. Everything else in
 * the booking export (phone, payment, order, venue metadata) is ignored.
 */
export type StudentRow = {
  fullName: string;
  email: string;
  labStartDate: string | null;
};

export function cleanEmail(input: string) {
  return input.trim().toLowerCase();
}
/** Splits CSV text into rows, honouring quoted fields that contain commas. */
function splitCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }

      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[index + 1] === "\n") {
        index += 1;
      }

      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  row.push(field);
  rows.push(row);

  return rows.filter((entry) => entry.some((value) => value.trim()));
}

function findColumn(header: string[], candidates: string[]) {
  return header.findIndex((name) => candidates.includes(name));
}

/** Reads a booking date such as "Monday, August 17, 2026 12:00 AM" as YYYY-MM-DD. */
function parseLabStartDate(input: string) {
  const trimmed = input.trim();

  if (!trimmed) {
    return null;
  }

  const parsed = new Date(trimmed);

  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  // Booking exports carry no time zone, so read the wall-clock date back out.
  return [
    String(parsed.getFullYear()).padStart(4, "0"),
    String(parsed.getMonth() + 1).padStart(2, "0"),
    String(parsed.getDate()).padStart(2, "0"),
  ].join("-");
}

export function parseParticipantCsv(text: string): StudentRow[] {
  const rows = splitCsv(text);
  const header = (rows.shift() ?? []).map((name) => name.trim().toLowerCase());
  const firstNameIndex = findColumn(header, [
    "first name",
    "firstname",
    "first",
  ]);
  const lastNameIndex = findColumn(header, ["last name", "lastname", "last"]);
  const nameIndex = findColumn(header, [
    "name",
    "full name",
    "fullname",
    "participant name",
  ]);
  const emailIndex = findColumn(header, [
    "email",
    "email address",
    "participant email",
  ]);
  const startIndex = findColumn(header, [
    "booking start time",
    "session start",
    "lab start date",
    "start date",
  ]);

  if (emailIndex < 0 || (nameIndex < 0 && firstNameIndex < 0)) {
    throw new Error(
      "CSV needs an Email column plus either Name or First Name / Last Name.",
    );
  }

  const seen = new Set<string>();

  return rows
    .map((columns) => columns.map((value) => value.trim()))
    .map((columns) => ({
      email: cleanEmail(columns[emailIndex] ?? ""),
      fullName:
        nameIndex >= 0
          ? (columns[nameIndex] ?? "")
          : `${columns[firstNameIndex] ?? ""} ${columns[lastNameIndex] ?? ""}`.trim(),
      labStartDate:
        startIndex >= 0 ? parseLabStartDate(columns[startIndex] ?? "") : null,
    }))
    .filter((row) => {
      if (!row.email || !row.fullName || seen.has(row.email)) {
        return false;
      }

      seen.add(row.email);

      return true;
    });
}
