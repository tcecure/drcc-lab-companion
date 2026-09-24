import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/card";
import { SubmitButton } from "@/components/forms";
import { StaffCredentialReveal } from "@/components/staff-credential-reveal";
import {
  revealLabCredentialForStaffAction,
  rotateLabCredentialAction,
} from "@/lib/actions/lab-credentials";
import { requireManager } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import {
  labCredentialsConfigured,
  listCredentialEvents,
  listLabCredentials,
} from "@/lib/lab-credentials";
import { createAdminClient } from "@/lib/supabase/admin";

type PageProps = {
  searchParams: Promise<{ error?: string; notice?: string }>;
};

export default async function AdminLabCredentialsPage({
  searchParams,
}: PageProps) {
  const { roles } = await requireManager();
  const params = await searchParams;
  const configured = labCredentialsConfigured();
  const supabase = createAdminClient();
  const [{ data: assignments }, credentials, events] = await Promise.all([
    supabase
      .from("student_cohort_assignments")
      .select("seat_number, pod_name, lab_username, cohort_number, status")
      .not("seat_number", "is", null)
      .not("status", "in", "(cancelled,completed)")
      .order("seat_number"),
    configured ? listLabCredentials() : Promise.resolve([]),
    configured ? listCredentialEvents() : Promise.resolve([]),
  ]);

  const bySeat = new Map(
    credentials.map((credential) => [credential.seatNumber, credential]),
  );
  const seats = (assignments ?? [])
    .filter((row): row is typeof row & { seat_number: number } =>
      Boolean(row.seat_number),
    )
    .map((row) => ({
      assignmentStatus: row.status,
      cohortNumber: row.cohort_number,
      credential: bySeat.get(row.seat_number) ?? null,
      labUsername: row.lab_username,
      podName: row.pod_name,
      seatNumber: row.seat_number,
    }));
  const orphanCredentials = credentials.filter(
    (credential) =>
      !seats.some((seat) => seat.seatNumber === credential.seatNumber),
  );

  return (
    <AppShell roles={roles} title="Lab Credentials">
      {params.error ? (
        <p className="rounded-lg border border-rose-300/30 bg-rose-400/10 p-3 text-sm text-rose-100">
          {params.error}
        </p>
      ) : null}
      {params.notice ? (
        <p className="rounded-lg border border-cyan-300/30 bg-cyan-400/10 p-3 text-sm text-cyan-100">
          {params.notice}
        </p>
      ) : null}

      {configured ? null : (
        <Card eyebrow="Not Configured" title="Credential storage is disabled">
          <p className="text-sm leading-6 text-slate-300">
            Set LAB_CREDENTIAL_ENCRYPTION_KEY (32 random bytes, base64) so pod
            passwords can be stored and revealed.
          </p>
        </Card>
      )}

      <Card eyebrow="Active Seats" title="Pod passwords by seat">
        <p className="text-sm leading-6 text-slate-300">
          Rotating generates a new password and holds it as pending until the
          AWX bridge applies it to Active Directory and Guacamole. Students see
          the old password until the push lands, so access never breaks mid-lab.
        </p>
        <div className="table-wrap mt-5">
          <table className="data-table">
            <thead>
              <tr>
                <th>Seat</th>
                <th>Pod</th>
                <th>Lab username</th>
                <th>Status</th>
                <th>Rotated</th>
                <th>Pushed</th>
                <th>Password</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {seats.map((seat) => (
                <tr key={seat.seatNumber}>
                  <td>{String(seat.seatNumber).padStart(2, "0")}</td>
                  <td>{seat.podName}</td>
                  <td>{seat.labUsername}</td>
                  <td>
                    <span className="status-pill">
                      {seat.credential?.status ?? "not issued"}
                    </span>
                  </td>
                  <td>
                    {seat.credential
                      ? formatDateTime(seat.credential.rotatedAt)
                      : "—"}
                  </td>
                  <td>
                    {seat.credential?.pushedAt
                      ? formatDateTime(seat.credential.pushedAt)
                      : "Pending"}
                  </td>
                  <td>
                    {seat.credential ? (
                      <StaffCredentialReveal
                        reveal={revealLabCredentialForStaffAction}
                        seatNumber={seat.seatNumber}
                      />
                    ) : (
                      "—"
                    )}
                  </td>
                  <td>
                    <form action={rotateLabCredentialAction}>
                      <input
                        name="seatNumber"
                        type="hidden"
                        value={seat.seatNumber}
                      />
                      <SubmitButton className="secondary">Rotate</SubmitButton>
                    </form>
                  </td>
                </tr>
              ))}
              {seats.length ? null : (
                <tr>
                  <td colSpan={8}>No seated students in an active cohort.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {orphanCredentials.length ? (
          <p className="mt-4 text-xs leading-5 text-slate-400">
            {orphanCredentials.length} stored credential
            {orphanCredentials.length === 1 ? "" : "s"} belong to seats with no
            active student: seat
            {orphanCredentials.length === 1 ? " " : "s "}
            {orphanCredentials
              .map((credential) =>
                String(credential.seatNumber).padStart(2, "0"),
              )
              .join(", ")}
            .
          </p>
        ) : null}
      </Card>

      <Card eyebrow="Audit Trail" title="Credential events">
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Seat</th>
                <th>Action</th>
                <th>Actor</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <tr key={event.id}>
                  <td>{formatDateTime(event.created_at)}</td>
                  <td>{String(event.seat_number).padStart(2, "0")}</td>
                  <td>
                    <span className="status-pill">{event.action}</span>
                  </td>
                  <td>{event.actor_role}</td>
                  <td>{event.detail}</td>
                </tr>
              ))}
              {events.length ? null : (
                <tr>
                  <td colSpan={5}>No credential activity recorded yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </AppShell>
  );
}
