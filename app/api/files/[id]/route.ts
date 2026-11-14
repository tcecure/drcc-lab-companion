import { NextResponse } from "next/server";

import { canManage, getUserRoles, requireUser } from "@/lib/auth";
import { createCohortFileDownload } from "@/lib/cohort-files";

/**
 * Downloads are brokered rather than linked: the bucket is private, so this
 * checks who is asking (staff, or the student the document belongs to), logs
 * the access, then redirects to a signed URL that expires within the minute.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireUser();
  const roles = await getUserRoles(user.id);
  const { id } = await params;

  const download = await createCohortFileDownload(id, {
    role: canManage(roles) ? "staff" : "student",
    userId: user.id,
  });

  if (!download) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  return NextResponse.redirect(download.signedUrl);
}
