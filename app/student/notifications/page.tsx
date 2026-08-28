import Link from "next/link";
import { Bell, CheckCheck } from "lucide-react";

import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/card";
import { SubmitButton } from "@/components/forms";
import { markAllNotificationsReadAction } from "@/lib/actions/notifications";
import { requireStudent } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { createAdminClient } from "@/lib/supabase/admin";

type NotificationsPageProps = {
  searchParams: Promise<{ error?: string; message?: string }>;
};

export default async function NotificationsPage({
  searchParams,
}: NotificationsPageProps) {
  const [{ user, roles }, params] = await Promise.all([
    requireStudent(),
    searchParams,
  ]);
  const supabase = createAdminClient();
  const { data: notifications } = await supabase
    .from("notifications")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(100);
  const unread = (notifications ?? []).filter(
    (notification) => !notification.read_at,
  ).length;

  return (
    <AppShell roles={roles} title="Notifications">
      {params.error ? (
        <p className="rounded-lg border border-rose-300/30 bg-rose-400/10 p-3 text-sm text-rose-100">
          {params.error}
        </p>
      ) : null}
      {params.message ? (
        <p className="rounded-lg border border-cyan-300/30 bg-cyan-400/10 p-3 text-sm text-cyan-100">
          {params.message}
        </p>
      ) : null}
      <Card eyebrow="Inbox" title={`${unread} unread`}>
        {unread ? (
          <form action={markAllNotificationsReadAction} className="mb-5">
            <SubmitButton className="secondary">
              <CheckCheck aria-hidden="true" size={16} />
              Mark all read
            </SubmitButton>
          </form>
        ) : null}
        {(notifications ?? []).length ? (
          <div className="grid gap-2">
            {(notifications ?? []).map((notification) => {
              const content = (
                <div
                  className={`border-l-2 px-4 py-3 ${
                    notification.read_at
                      ? "border-slate-600 bg-white/[0.02]"
                      : "border-cyan-300 bg-cyan-400/[0.06]"
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-bold">{notification.title}</p>
                    <time className="text-xs text-slate-500">
                      {formatDateTime(notification.created_at)}
                    </time>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-slate-300">
                    {notification.message}
                  </p>
                </div>
              );

              return notification.action_url ? (
                <Link href={notification.action_url} key={notification.id}>
                  {content}
                </Link>
              ) : (
                <div key={notification.id}>{content}</div>
              );
            })}
          </div>
        ) : (
          <div className="flex items-center gap-3 border-y border-cyan-200/10 py-8 text-sm text-slate-400">
            <Bell aria-hidden="true" size={18} />
            Cohort and support updates will appear here.
          </div>
        )}
      </Card>
    </AppShell>
  );
}
