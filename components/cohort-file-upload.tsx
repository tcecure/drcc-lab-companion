"use client";

import { createBrowserClient } from "@supabase/ssr";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import {
  prepareCohortFileUploadAction,
  registerCohortFileAction,
} from "@/lib/actions/cohort-files";
import {
  bucketId,
  formatBytes,
  maxUploadBytes,
} from "@/lib/cohort-files-public";

type Student = { label: string; userId: string };

/**
 * The bytes go from the browser straight to storage with a one-shot ticket,
 * and only the metadata comes back through the app. A server action carrying a
 * real transcript would be rejected by the request body limit long before the
 * 50 MB rule applies.
 */
export function CohortFileUpload({
  cohortNumber,
  folder,
  students,
  supabaseKey,
  supabaseUrl,
}: {
  cohortNumber: number;
  folder: string;
  students: Student[];
  supabaseKey: string;
  supabaseUrl: string;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [state, setState] = useState<"idle" | "sending">("idle");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function checksum(file: File) {
    if (!crypto.subtle) {
      return undefined;
    }

    const digest = await crypto.subtle.digest(
      "SHA-256",
      await file.arrayBuffer(),
    );

    return Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  }

  async function upload(formData: FormData) {
    const file = formData.get("file");

    if (!(file instanceof File) || file.size === 0) {
      setError("Choose a file to upload.");

      return;
    }

    if (file.size > maxUploadBytes) {
      setError(
        `That file is ${formatBytes(file.size)}, over the ${formatBytes(
          maxUploadBytes,
        )} limit.`,
      );

      return;
    }

    setError(null);
    setNotice(null);
    setState("sending");

    try {
      const ticket = await prepareCohortFileUploadAction({
        cohortNumber,
        fileName: file.name,
        folder,
      });

      if (!ticket.ok) {
        setError(ticket.error);

        return;
      }

      const supabase = createBrowserClient(supabaseUrl, supabaseKey);
      const { error: storageError } = await supabase.storage
        .from(bucketId)
        .uploadToSignedUrl(ticket.value.storagePath, ticket.value.token, file, {
          contentType: file.type || "application/octet-stream",
        });

      if (storageError) {
        setError(storageError.message);

        return;
      }

      const recorded = await registerCohortFileAction({
        checksumSha256: await checksum(file),
        cohortNumber,
        description: String(formData.get("description") ?? "") || undefined,
        fileId: ticket.value.fileId,
        fileName: file.name,
        folder,
        storagePath: ticket.value.storagePath,
        studentUserId: String(formData.get("studentUserId") ?? "") || undefined,
      });

      if (!recorded.ok) {
        setError(recorded.error);

        return;
      }

      formRef.current?.reset();
      setNotice(`${recorded.value.fileName} uploaded.`);
      router.refresh();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "That upload did not finish.",
      );
    } finally {
      setState("idle");
    }
  }

  return (
    <form
      className="mt-4 grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void upload(new FormData(event.currentTarget));
      }}
      ref={formRef}
    >
      {error ? (
        <p className="text-sm text-rose-300" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? <p className="text-sm text-emerald-300">{notice}</p> : null}

      <label className="grid gap-2 text-sm">
        <span className="text-slate-300">File</span>
        <input className="input" name="file" required type="file" />
      </label>

      <label className="grid gap-2 text-sm">
        <span className="text-slate-300">Description (optional)</span>
        <input
          className="input"
          maxLength={500}
          name="description"
          placeholder="Learning report issued at cohort close"
          type="text"
        />
      </label>

      {students.length ? (
        <label className="grid gap-2 text-sm">
          <span className="text-slate-300">Belongs to (optional)</span>
          <select className="input" defaultValue="" name="studentUserId">
            <option value="">Staff only — no student can see it</option>
            {students.map((student) => (
              <option key={student.userId} value={student.userId}>
                {student.label}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <p className="text-xs text-slate-400">
        Up to {formatBytes(maxUploadBytes)}. Uploading a file that already
        exists here replaces it; the previous copy stays in the access log.
        Naming a student lets that student download it from their own Documents
        page.
      </p>

      <div>
        <button className="button" disabled={state === "sending"} type="submit">
          {state === "sending" ? "Uploading..." : "Upload"}
        </button>
      </div>
    </form>
  );
}
