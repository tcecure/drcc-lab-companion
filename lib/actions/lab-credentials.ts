"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { requireManager, requireUser } from "@/lib/auth";
import {
  labCredentialsConfigured,
  revealLabCredential,
  rotateLabCredential,
} from "@/lib/lab-credentials";
import { getStudentCohortAssignment } from "@/lib/student-lab";

export type StudentCredentialResult =
  | { ok: true; labUsername: string; password: string; podName: string }
  | { ok: false; error: string };

/**
 * A student can only ever read the seat their own active assignment points at,
 * so the seat number is taken from the assignment rather than from the client.
 */
export async function revealMyLabCredentialAction(): Promise<StudentCredentialResult> {
  const user = await requireUser();

  if (!labCredentialsConfigured()) {
    return {
      ok: false,
      error:
        "Lab credentials are not configured yet. Contact support@digitalrcc.com.",
    };
  }

  const assignment = await getStudentCohortAssignment(user.id);

  if (!assignment || assignment.seat_number === null) {
    return {
      ok: false,
      error: "You do not have a lab seat assigned yet.",
    };
  }

  const credential = await revealLabCredential(assignment.seat_number, {
    role: "student",
    userId: user.id,
  });

  if (!credential) {
    return {
      ok: false,
      error:
        "Your pod password has not been issued yet. Contact support@digitalrcc.com.",
    };
  }

  if (credential.password === null) {
    return {
      ok: false,
      error:
        "Your pod password is still being applied to the lab. Try again in a few minutes.",
    };
  }

  return {
    ok: true,
    labUsername: credential.labUsername,
    password: credential.password,
    podName: credential.podName,
  };
}

const rotateSchema = z.object({
  seatNumber: z.coerce.number().int().min(1).max(200),
});

function message(input: string) {
  return encodeURIComponent(input);
}

export async function rotateLabCredentialAction(formData: FormData) {
  const { user: actor } = await requireManager();
  const parsed = rotateSchema.safeParse({
    seatNumber: formData.get("seatNumber"),
  });

  if (!parsed.success) {
    redirect(
      `/admin/lab-credentials?error=${message("That seat number is not valid.")}`,
    );
  }

  try {
    await rotateLabCredential({
      actor: { role: "staff", userId: actor.id },
      seatNumber: parsed.data.seatNumber,
    });
  } catch (error) {
    redirect(
      `/admin/lab-credentials?error=${message(
        error instanceof Error ? error.message : "Rotation failed.",
      )}`,
    );
  }

  revalidatePath("/admin/lab-credentials");
  redirect(
    `/admin/lab-credentials?notice=${message(
      `Seat ${parsed.data.seatNumber} rotated. It becomes usable once the lab push completes.`,
    )}`,
  );
}

export async function revealLabCredentialForStaffAction(
  seatNumber: number,
): Promise<StudentCredentialResult> {
  const { user: actor } = await requireManager();
  const parsed = rotateSchema.safeParse({ seatNumber });

  if (!parsed.success) {
    return { ok: false, error: "That seat number is not valid." };
  }

  const credential = await revealLabCredential(parsed.data.seatNumber, {
    role: "staff",
    userId: actor.id,
  });

  if (!credential) {
    return { ok: false, error: "No credential stored for that seat." };
  }

  if (credential.password === null) {
    return {
      ok: false,
      error:
        "This seat has a rotation staged but no password the lab accepts yet. It becomes readable once the push completes.",
    };
  }

  return {
    ok: true,
    labUsername: credential.labUsername,
    password: credential.password,
    podName: credential.podName,
  };
}
