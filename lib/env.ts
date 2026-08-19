import { z } from "zod";

const envSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
  SUPABASE_SECRET_KEY: z.string().min(1),
  NEXT_PUBLIC_APP_URL: z.string().url(),
  CRON_SECRET: z.string().optional(),
  EMAIL_DELIVERY_MODE: z.enum(["mock", "live"]).default("mock"),
  SES_FROM_ADDRESS: z.string().email().optional(),
  SES_REPLY_TO_ADDRESS: z.string().email().optional(),
  AWS_REGION: z.string().optional(),
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),
  PROXMOX_API_BASE_URL: z.string().url().optional(),
  PROXMOX_API_TOKEN_ID: z.string().optional(),
  PROXMOX_API_TOKEN_SECRET: z.string().optional(),
  PROXMOX_EXPECTED_NODES: z.string().optional(),
  PROXMOX_CORE_DC_RESOURCES: z.string().optional(),
  PROXMOX_EXPECTED_PODS: z.string().optional(),
  LAB_STATUS_INGEST_SECRET: z.string().optional(),
  LAB_STATUS_MAX_AGE_SECONDS: z.coerce.number().int().positive().default(180),
  TRAINING_TRACKER_BASE_URL: z.string().url().optional(),
  TRAINING_TRACKER_API_TOKEN: z.string().optional(),
});

export type ServerEnv = z.infer<typeof envSchema>;

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
    EMAIL_DELIVERY_MODE: value(process.env.EMAIL_DELIVERY_MODE),
    SES_FROM_ADDRESS: value(process.env.SES_FROM_ADDRESS),
    SES_REPLY_TO_ADDRESS: value(process.env.SES_REPLY_TO_ADDRESS),
    AWS_REGION: value(process.env.AWS_REGION),
    AWS_ACCESS_KEY_ID: value(process.env.AWS_ACCESS_KEY_ID),
    AWS_SECRET_ACCESS_KEY: value(process.env.AWS_SECRET_ACCESS_KEY),
    PROXMOX_API_BASE_URL: value(process.env.PROXMOX_API_BASE_URL),
    PROXMOX_API_TOKEN_ID: value(process.env.PROXMOX_API_TOKEN_ID),
    PROXMOX_API_TOKEN_SECRET: value(process.env.PROXMOX_API_TOKEN_SECRET),
    PROXMOX_EXPECTED_NODES: value(process.env.PROXMOX_EXPECTED_NODES),
    PROXMOX_CORE_DC_RESOURCES: value(process.env.PROXMOX_CORE_DC_RESOURCES),
    PROXMOX_EXPECTED_PODS: value(process.env.PROXMOX_EXPECTED_PODS),
    LAB_STATUS_INGEST_SECRET: value(process.env.LAB_STATUS_INGEST_SECRET),
    LAB_STATUS_MAX_AGE_SECONDS: value(process.env.LAB_STATUS_MAX_AGE_SECONDS),
    TRAINING_TRACKER_BASE_URL: value(process.env.TRAINING_TRACKER_BASE_URL),
    TRAINING_TRACKER_API_TOKEN: value(process.env.TRAINING_TRACKER_API_TOKEN),
  });
}
