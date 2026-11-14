import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;

const files: Row[] = [];
const events: Row[] = [];
const profiles: Row[] = [
  { id: "student-1", full_name: "Marvin Koroma", email: "marvin@example.com" },
  { id: "staff-1", full_name: "Eddie", email: "eddie@example.com" },
];
const objects = new Map<string, Buffer>();
const removed: string[] = [];

function rowsFor(name: string) {
  if (name === "cohort_files") {
    return files;
  }

  if (name === "cohort_file_events") {
    return events;
  }

  return profiles;
}

function table(name: string) {
  const rows = rowsFor(name);

  function query(mutate?: (row: Row) => void) {
    const filters: Array<(row: Row) => boolean> = [];
    const builder = {
      eq(column: string, value: unknown) {
        filters.push((row) => row[column] === value);

        return builder;
      },
      in(column: string, values: unknown[]) {
        filters.push((row) => values.includes(row[column]));

        return builder;
      },
      is(column: string, value: unknown) {
        filters.push((row) => (row[column] ?? null) === value);

        return builder;
      },
      neq(column: string, value: unknown) {
        filters.push((row) => row[column] !== value);

        return builder;
      },
      order() {
        return builder;
      },
      select() {
        return builder;
      },
      single() {
        return Promise.resolve({
          data: builder.resolve()[0] ?? null,
          error: null,
        });
      },
      maybeSingle() {
        return Promise.resolve({
          data: builder.resolve()[0] ?? null,
          error: null,
        });
      },
      resolve() {
        const selected = rows.filter((row) =>
          filters.every((predicate) => predicate(row)),
        );

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
      const row: Row = {
        created_at: new Date().toISOString(),
        deleted_at: null,
        ...values,
      };
      rows.push(row);

      return query().eq("id", row.id ?? null);
    },
    select: () => query(),
    update(values: Row) {
      return query((row) => Object.assign(row, values));
    },
  };
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: table,
    storage: {
      from: () => ({
        createSignedUploadUrl(path: string) {
          return Promise.resolve({
            data: { path, token: `token-for-${path}` },
            error: null,
          });
        },
        list(prefix: string, options: { search: string }) {
          const path = `${prefix}/${options.search}`;
          const body = objects.get(path);

          return Promise.resolve({
            data: body
              ? [
                  {
                    name: options.search,
                    metadata: {
                      mimetype: "application/pdf",
                      size: body.length,
                    },
                  },
                ]
              : [],
            error: null,
          });
        },
        createSignedUrl(path: string) {
          return Promise.resolve({
            data: { signedUrl: `https://storage.test/${path}?token=abc` },
            error: null,
          });
        },
        remove(paths: string[]) {
          paths.forEach((path) => {
            removed.push(path);
            objects.delete(path);
          });

          return Promise.resolve({ data: null, error: null });
        },
        upload(path: string, body: Buffer) {
          objects.set(path, body);

          return Promise.resolve({ data: { path }, error: null });
        },
      }),
    },
  }),
}));

const {
  createCohortFileDownload,
  createCohortFileUploadTicket,
  deleteCohortFile,
  listCohortFiles,
  listCohortFolders,
  listStudentFiles,
  registerCohortFile,
  sanitizeFileName,
  uploadCohortFile,
} = await import("@/lib/cohort-files");

const staff = { role: "staff" as const, userId: "staff-1" };
const student = { role: "student" as const, userId: "student-1" };

function transcript(overrides: Record<string, unknown> = {}) {
  return uploadCohortFile(
    {
      body: Buffer.from("Learning report for Cohort 6"),
      cohortNumber: 6,
      contentType: "application/pdf",
      fileName: "learning-report-marvin-koroma.pdf",
      folder: "transcripts",
      studentUserId: "student-1",
      ...overrides,
    },
    staff,
  );
}

beforeEach(() => {
  files.length = 0;
  events.length = 0;
  removed.length = 0;
  objects.clear();
});

describe("file names", () => {
  it("cannot escape the cohort prefix inside the bucket", () => {
    expect(sanitizeFileName("../../etc/passwd")).toBe("passwd");
    expect(sanitizeFileName("reports/../x.pdf")).toBe("x.pdf");
  });

  it("keeps a readable name for an ordinary upload", () => {
    expect(sanitizeFileName("Learning Report (Cohort 6).pdf")).toBe(
      "Learning-Report-Cohort-6-.pdf",
    );
  });
});

describe("uploading", () => {
  it("files the bytes under the cohort and folder", async () => {
    const row = await transcript();

    expect(String(row.storage_path)).toMatch(
      /^cohort-06\/transcripts\/[0-9a-f-]+-learning-report-marvin-koroma\.pdf$/,
    );
    expect(objects.get(row.storage_path)?.toString()).toBe(
      "Learning report for Cohort 6",
    );
    expect(row.checksum_sha256).toHaveLength(64);
  });

  it("replaces a file of the same name instead of duplicating it", async () => {
    await transcript();
    await transcript({ body: Buffer.from("Corrected learning report") });

    const listed = await listCohortFiles(6, "transcripts");

    expect(listed).toHaveLength(1);
    expect(listed[0].byteSize).toBe("Corrected learning report".length);
    // The superseded row stays for the audit trail rather than being purged.
    expect(files.filter((row) => row.deleted_at !== null)).toHaveLength(1);
  });

  it("refuses an empty file", async () => {
    await expect(transcript({ body: Buffer.alloc(0) })).rejects.toThrow(
      /empty/i,
    );
  });

  it("refuses a cohort that is not on the calendar", async () => {
    await expect(transcript({ cohortNumber: 999 })).rejects.toThrow(
      /cohort calendar/i,
    );
  });

  it("counts the folder it landed in", async () => {
    await transcript();

    const folders = await listCohortFolders(6);
    const transcripts = folders.find(
      (folder) => folder.folder === "transcripts",
    );

    expect(transcripts?.fileCount).toBe(1);
    expect(
      folders.find((folder) => folder.folder === "reports")?.fileCount,
    ).toBe(0);
  });
});

describe("who may download", () => {
  it("gives the owning student a short-lived link and logs it", async () => {
    const row = await transcript();

    const download = await createCohortFileDownload(String(row.id), student);

    expect(download?.signedUrl).toContain("token=");
    expect(events.filter((event) => event.action === "download")).toHaveLength(
      1,
    );
  });

  it("refuses another student's transcript", async () => {
    const row = await transcript();

    const download = await createCohortFileDownload(String(row.id), {
      role: "student",
      userId: "student-2",
    });

    expect(download).toBeNull();
    expect(events.filter((event) => event.action === "download")).toHaveLength(
      0,
    );
  });

  it("refuses a student a staff-only document", async () => {
    const row = await transcript({
      fileName: "cohort-6-funding-summary.pdf",
      folder: "reports",
      studentUserId: null,
    });

    expect(await createCohortFileDownload(String(row.id), student)).toBeNull();
    expect(
      await createCohortFileDownload(String(row.id), staff),
    ).not.toBeNull();
  });

  it("shows a student only their own live documents", async () => {
    await transcript();
    await transcript({
      fileName: "learning-report-clement-ojo.pdf",
      studentUserId: "student-2",
    });

    const mine = await listStudentFiles("student-1");

    expect(mine.map((file) => file.fileName)).toEqual([
      "learning-report-marvin-koroma.pdf",
    ]);
  });
});

describe("removal", () => {
  it("drops the object, hides the row and keeps the trail", async () => {
    const row = await transcript();

    await deleteCohortFile(String(row.id), staff);

    expect(removed).toContain(row.storage_path);
    expect(await listCohortFiles(6, "transcripts")).toEqual([]);
    expect(await listStudentFiles("student-1")).toEqual([]);
    expect(events.filter((event) => event.action === "delete")).toHaveLength(1);
  });

  it("is a no-op for a file that is already gone", async () => {
    const row = await transcript();
    await deleteCohortFile(String(row.id), staff);

    expect(await deleteCohortFile(String(row.id), staff)).toBeNull();
  });
});

describe("browser uploads", () => {
  async function browserUpload(
    body: Buffer,
    overrides: Record<string, unknown> = {},
  ) {
    const ticket = await createCohortFileUploadTicket(
      {
        cohortNumber: 6,
        fileName: "learning-report-marvin-koroma.pdf",
        folder: "transcripts",
      },
      staff,
    );

    objects.set(ticket.storagePath, body);

    return registerCohortFile(
      {
        cohortNumber: 6,
        fileId: ticket.fileId,
        fileName: ticket.fileName,
        folder: "transcripts",
        storagePath: ticket.storagePath,
        studentUserId: "student-1",
        ...overrides,
      },
      staff,
    );
  }

  it("hands out a ticket under the cohort prefix with a sanitized name", async () => {
    const ticket = await createCohortFileUploadTicket(
      { cohortNumber: 6, fileName: "../../etc/passwd", folder: "transcripts" },
      staff,
    );

    expect(ticket.storagePath).toBe(
      `cohort-06/transcripts/${ticket.fileId}-passwd`,
    );
    expect(ticket.token).toBeTruthy();
  });

  it("records the size storage reports, not the size the browser claims", async () => {
    const row = await browserUpload(Buffer.alloc(2048, 1));

    expect(row.byte_size).toBe(2048);
    expect(row.content_type).toBe("application/pdf");
    expect(events.filter((event) => event.action === "upload")).toHaveLength(1);
  });

  it("replaces a live file of the same name rather than duplicating it", async () => {
    await browserUpload(Buffer.alloc(16, 1));
    await browserUpload(Buffer.alloc(32, 1));

    const live = await listCohortFiles(6, "transcripts");

    expect(live).toHaveLength(1);
    expect(live[0]?.byteSize).toBe(32);
  });

  it("refuses a path that does not match the registered file", async () => {
    await expect(
      browserUpload(Buffer.alloc(16, 1), {
        storagePath: "cohort-01/reports/someone-elses.pdf",
      }),
    ).rejects.toThrow(/does not belong/i);
  });

  it("refuses and deletes an object over the upload limit", async () => {
    const ticket = await createCohortFileUploadTicket(
      { cohortNumber: 6, fileName: "huge.pdf", folder: "transcripts" },
      staff,
    );

    objects.set(ticket.storagePath, {
      length: 50 * 1024 * 1024 + 1,
    } as unknown as Buffer);

    await expect(
      registerCohortFile(
        {
          cohortNumber: 6,
          fileId: ticket.fileId,
          fileName: ticket.fileName,
          folder: "transcripts",
          storagePath: ticket.storagePath,
        },
        staff,
      ),
    ).rejects.toThrow(/over the/i);
    expect(removed).toContain(ticket.storagePath);
    expect(files).toHaveLength(0);
  });

  it("refuses an upload that never reached storage", async () => {
    const ticket = await createCohortFileUploadTicket(
      { cohortNumber: 6, fileName: "missing.pdf", folder: "transcripts" },
      staff,
    );

    await expect(
      registerCohortFile(
        {
          cohortNumber: 6,
          fileId: ticket.fileId,
          fileName: ticket.fileName,
          folder: "transcripts",
          storagePath: ticket.storagePath,
        },
        staff,
      ),
    ).rejects.toThrow(/did not finish/i);
    expect(files).toHaveLength(0);
  });
});
