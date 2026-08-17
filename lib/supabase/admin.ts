import "server-only";

import { createClient } from "@supabase/supabase-js";

import { readServerEnv } from "@/lib/env";
import type { Database } from "@/lib/types";

export function createAdminClient() {
  const env = readServerEnv();

  return createClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.SUPABASE_SECRET_KEY,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );
}
