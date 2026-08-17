import { z } from "zod";

const envSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
  SUPABASE_SECRET_KEY: z.string().min(1),
  NEXT_PUBLIC_APP_URL: z.string().url(),
  CRON_SECRET: z.string().optional(),
  PROXMOX_API_BASE_URL: z.string().url().optional(),
  PROXMOX_API_TOKEN_ID: z.string().optional(),
  PROXMOX_API_TOKEN_SECRET: z.string().optional(),
  PROXMOX_EXPECTED_NODES: z.string().optional(),
  PROXMOX_EXPECTED_PODS: z.string().optional(),
});

function value(input: string | undefined) {
  return input?.trim() || undefined;
}

export function readPublicEnv() {
  const parsed = envSchema
    .pick({
      NEXT_PUBLIC_SUPABASE_URL: true,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: true,
      NEXT_PUBLIC_APP_URL: true,
    })
    .parse({
      NEXT_PUBLIC_SUPABASE_URL:
        value(process.env.NEXT_PUBLIC_SUPABASE_URL) ??
        value(process.env.SUPABASE_URL),
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
        value(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) ??
        value(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) ??
        value(process.env.SUPABASE_PUBLISHABLE_KEY) ??
        value(process.env.SUPABASE_ANON_KEY),
      NEXT_PUBLIC_APP_URL: value(process.env.NEXT_PUBLIC_APP_URL),
    });

  return parsed;
}

export function readServerEnv() {
  const publicEnv = readPublicEnv();

  return envSchema.parse({
    ...publicEnv,
    SUPABASE_SECRET_KEY:
      value(process.env.SUPABASE_SECRET_KEY) ??
      value(process.env.SUPABASE_SERVICE_ROLE_KEY),
    CRON_SECRET: value(process.env.CRON_SECRET),
    PROXMOX_API_BASE_URL: value(process.env.PROXMOX_API_BASE_URL),
    PROXMOX_API_TOKEN_ID: value(process.env.PROXMOX_API_TOKEN_ID),
    PROXMOX_API_TOKEN_SECRET: value(process.env.PROXMOX_API_TOKEN_SECRET),
    PROXMOX_EXPECTED_NODES: value(process.env.PROXMOX_EXPECTED_NODES),
    PROXMOX_EXPECTED_PODS: value(process.env.PROXMOX_EXPECTED_PODS),
  });
}
