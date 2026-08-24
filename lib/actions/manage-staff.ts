"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { requireAdmin } from "@/lib/auth";
import { readServerEnv } from "@/lib/env";
import { isStaffRole, staffRoles, type StaffRole } from "@/lib/staff-users";
import { createAdminClient } from "@/lib/supabase/admin";

const staffInviteSchema = z.object({
  email: z
    .string()
    .trim()
    .email()
    .transform((email) => email.toLowerCase()),
  fullName: z.string().trim().min(2).max(120),
  role: z.enum(staffRoles),
});
const targetSchema = z.string().uuid();
const roleSchema = z.enum(staffRoles);
const accessCommandSchema = z.enum(["disable", "restore"]);

function message(input: string) {
  return encodeURIComponent(input);
}

function errorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : "The request could not be completed.";
}

async function findAuthUserByEmail(
  supabase: ReturnType<typeof createAdminClient>,
  email: string,
) {
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page,
      perPage: 200,
    });

    if (error) {
      throw new Error(error.message);
    }

    const match = data.users.find(
      (user) => user.email?.toLowerCase() === email,
    );

    if (match) {
      return match;
    }

    if (data.users.length < 200) {
      return null;
    }
  }

  return null;
}

async function getStaffRoleRecords(
  supabase: ReturnType<typeof createAdminClient>,
) {
  const { data, error } = await supabase
    .from("roles")
    .select("id, role_name")
    .in("role_name", [...staffRoles]);

  if (error) {
    throw new Error(error.message);
  }

  const records = (data ?? []).filter(
    (role): role is typeof role & { role_name: StaffRole } =>
      isStaffRole(role.role_name),
  );

  if (records.length !== staffRoles.length) {
    throw new Error("The admin and approver roles must exist in Supabase.");
  }

  return records;
}

async function getTargetStaffRoles(
  supabase: ReturnType<typeof createAdminClient>,
  targetUserId: string,
  roleRecords: Awaited<ReturnType<typeof getStaffRoleRecords>>,
) {
  const roleById = new Map(
    roleRecords.map((role) => [role.id, role.role_name]),
  );
  const { data, error } = await supabase
    .from("user_roles")
    .select("role_id")
    .eq("user_id", targetUserId)
    .in("role_id", [...roleById.keys()]);

  if (error) {
    throw new Error(error.message);
  }

  const roles = (data ?? [])
    .map((assignment) => roleById.get(assignment.role_id))
    .filter((role): role is StaffRole => Boolean(role));

  if (roles.length === 0) {
    throw new Error("This account is not a staff user.");
  }

  return roles;
}

async function writeAuditEvent({
  action,
  actorId,
  newValue,
  previousValue,
  targetUserId,
  supabase,
}: {
  action: string;
  actorId: string;
  newValue: Record<string, string | boolean>;
  previousValue?: Record<string, string | boolean>;
  targetUserId: string;
  supabase: ReturnType<typeof createAdminClient>;
}) {
  const { error } = await supabase.from("audit_events").insert({
    action,
    actor_id: actorId,
    entity_id: targetUserId,
    entity_type: "staff_user",
    new_value: newValue,
    previous_value: previousValue,
  });

  if (error) {
    throw new Error(error.message);
  }
}

export async function inviteStaffUserAction(formData: FormData) {
  const { user: actor } = await requireAdmin();
  const parsed = staffInviteSchema.safeParse({
    email: formData.get("email"),
    fullName: formData.get("fullName"),
    role: formData.get("role"),
  });

  if (!parsed.success) {
    redirect(
      `/admin/users?error=${message("Enter a valid name, email, and staff role.")}`,
    );
  }

  const { email, fullName, role } = parsed.data;

  try {
    const env = readServerEnv();
    const supabase = createAdminClient();
    const existingUser = await findAuthUserByEmail(supabase, email);

    if (existingUser) {
      throw new Error(
        "An account already exists for this email. Existing student accounts cannot be converted here.",
      );
    }

    const roleRecords = await getStaffRoleRecords(supabase);
    const roleId = roleRecords.find((record) => record.role_name === role)?.id;

    if (!roleId) {
      throw new Error(`${role} role is missing in Supabase.`);
    }

    const { data, error } = await supabase.auth.admin.inviteUserByEmail(email, {
      data: {
        full_name: fullName,
        organization: "DigitalRCC Operations",
      },
      redirectTo: `${env.NEXT_PUBLIC_APP_URL}/auth/callback?next=/set-password`,
    });

    if (error || !data.user) {
      throw new Error(
        error?.message ?? "Supabase did not create the invitation.",
      );
    }

    const targetUserId = data.user.id;

    try {
      const [{ error: profileError }, { error: roleError }] = await Promise.all(
        [
          supabase.from("profiles").upsert({
            account_status: "active",
            email,
            full_name: fullName,
            id: targetUserId,
            organization: "DigitalRCC Operations",
          }),
          supabase.from("user_roles").upsert(
            {
              assigned_by: actor.id,
              role_id: roleId,
              user_id: targetUserId,
            },
            { onConflict: "user_id,role_id" },
          ),
        ],
      );

      if (profileError || roleError) {
        throw new Error(profileError?.message ?? roleError?.message);
      }

      await writeAuditEvent({
        action: "staff_user.invited",
        actorId: actor.id,
        newValue: { email, role },
        targetUserId,
        supabase,
      });
    } catch (error) {
      await supabase.auth.admin.deleteUser(targetUserId);
      throw error;
    }
  } catch (error) {
    redirect(`/admin/users?error=${message(errorMessage(error))}`);
  }

  revalidatePath("/admin/users");
  redirect(`/admin/users?message=${message(`Invitation sent to ${email}.`)}`);
}

export async function updateStaffRoleAction(formData: FormData) {
  const { user: actor } = await requireAdmin();
  const targetUserId = targetSchema.safeParse(formData.get("targetUserId"));
  const selectedRole = roleSchema.safeParse(formData.get("role"));

  if (!targetUserId.success || !selectedRole.success) {
    redirect(`/admin/users?error=${message("Select a valid staff role.")}`);
  }

  if (targetUserId.data === actor.id) {
    redirect(
      `/admin/users?error=${message("You cannot change your own admin role.")}`,
    );
  }

  try {
    const supabase = createAdminClient();
    const roleRecords = await getStaffRoleRecords(supabase);
    const previousRoles = await getTargetStaffRoles(
      supabase,
      targetUserId.data,
      roleRecords,
    );
    const selectedRoleId = roleRecords.find(
      (role) => role.role_name === selectedRole.data,
    )?.id;

    if (!selectedRoleId) {
      throw new Error("The selected staff role is missing in Supabase.");
    }

    const { error: addError } = await supabase.from("user_roles").upsert(
      {
        assigned_by: actor.id,
        role_id: selectedRoleId,
        user_id: targetUserId.data,
      },
      { onConflict: "user_id,role_id" },
    );

    if (addError) {
      throw new Error(addError.message);
    }

    const otherRoleIds = roleRecords
      .filter((role) => role.id !== selectedRoleId)
      .map((role) => role.id);
    const { error: removeError } = await supabase
      .from("user_roles")
      .delete()
      .eq("user_id", targetUserId.data)
      .in("role_id", otherRoleIds);

    if (removeError) {
      throw new Error(removeError.message);
    }

    await writeAuditEvent({
      action: "staff_user.role_updated",
      actorId: actor.id,
      newValue: { role: selectedRole.data },
      previousValue: { role: previousRoles.join(",") },
      targetUserId: targetUserId.data,
      supabase,
    });
  } catch (error) {
    redirect(`/admin/users?error=${message(errorMessage(error))}`);
  }

  revalidatePath("/admin/users");
  redirect(`/admin/users?message=${message("Staff role updated.")}`);
}

export async function updateStaffAccessAction(formData: FormData) {
  const { user: actor } = await requireAdmin();
  const targetUserId = targetSchema.safeParse(formData.get("targetUserId"));
  const command = accessCommandSchema.safeParse(formData.get("command"));

  if (!targetUserId.success || !command.success) {
    redirect(`/admin/users?error=${message("Select a valid staff account.")}`);
  }

  if (targetUserId.data === actor.id) {
    redirect(
      `/admin/users?error=${message("You cannot disable your own account.")}`,
    );
  }

  try {
    const supabase = createAdminClient();
    const roleRecords = await getStaffRoleRecords(supabase);
    await getTargetStaffRoles(supabase, targetUserId.data, roleRecords);
    const disabling = command.data === "disable";
    const { error: authError } = await supabase.auth.admin.updateUserById(
      targetUserId.data,
      { ban_duration: disabling ? "876000h" : "none" },
    );

    if (authError) {
      throw new Error(authError.message);
    }

    const { error: profileError } = await supabase
      .from("profiles")
      .update({ account_status: disabling ? "disabled" : "active" })
      .eq("id", targetUserId.data);

    if (profileError) {
      await supabase.auth.admin.updateUserById(targetUserId.data, {
        ban_duration: disabling ? "none" : "876000h",
      });
      throw new Error(profileError.message);
    }

    await writeAuditEvent({
      action: disabling ? "staff_user.disabled" : "staff_user.restored",
      actorId: actor.id,
      newValue: { disabled: disabling },
      previousValue: { disabled: !disabling },
      targetUserId: targetUserId.data,
      supabase,
    });
  } catch (error) {
    redirect(`/admin/users?error=${message(errorMessage(error))}`);
  }

  revalidatePath("/admin/users");
  redirect(
    `/admin/users?message=${message(command.data === "disable" ? "Staff access disabled." : "Staff access restored.")}`,
  );
}

export async function sendStaffPasswordSetupAction(formData: FormData) {
  const { user: actor } = await requireAdmin();
  const targetUserId = targetSchema.safeParse(formData.get("targetUserId"));

  if (!targetUserId.success) {
    redirect(`/admin/users?error=${message("Select a valid staff account.")}`);
  }

  try {
    const env = readServerEnv();
    const supabase = createAdminClient();
    const roleRecords = await getStaffRoleRecords(supabase);
    await getTargetStaffRoles(supabase, targetUserId.data, roleRecords);
    const { data, error: userError } = await supabase.auth.admin.getUserById(
      targetUserId.data,
    );
    const email = data.user?.email;

    if (userError || !email) {
      throw new Error(userError?.message ?? "The staff email is unavailable.");
    }

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${env.NEXT_PUBLIC_APP_URL}/auth/callback?next=/set-password`,
    });

    if (error) {
      throw new Error(error.message);
    }

    await writeAuditEvent({
      action: "staff_user.password_setup_sent",
      actorId: actor.id,
      newValue: { email },
      targetUserId: targetUserId.data,
      supabase,
    });
  } catch (error) {
    redirect(`/admin/users?error=${message(errorMessage(error))}`);
  }

  redirect(`/admin/users?message=${message("Password setup email sent.")}`);
}
