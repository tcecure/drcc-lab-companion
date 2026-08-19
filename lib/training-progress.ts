import "server-only";

import { z } from "zod";

import { readServerEnv } from "@/lib/env";

const progressStatus = z.enum([
  "not_started",
  "in_progress",
  "completed",
  "unavailable",
]);

const percentage = z.coerce.number().int().min(0).max(100);

const moduleSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  status: progressStatus,
  percentage,
  completedAt: z.string().datetime().nullable().default(null),
});

const podProgressSchema = z.object({
  podName: z.string().min(1),
  studentNumber: z.string().min(1),
  checkedAt: z.string().datetime(),
  overallPercentage: percentage,
  completedModules: z.coerce.number().int().min(0),
  totalModules: z.coerce.number().int().min(0),
  currentModule: z.string().nullable().default(null),
  status: progressStatus,
  modules: z.array(moduleSchema).default([]),
  trackerUrl: z.string().url(),
});

export type ProgressStatus = z.infer<typeof progressStatus>;
export type ProgressModule = z.infer<typeof moduleSchema>;
export type PodProgress = z.infer<typeof podProgressSchema>;

const trackerBaseUrl = "https://training.status.tcecure.com";

export function podNumberFromPodName(podName: string | null | undefined) {
  const match = /^pod\s*-?(\d{1,2})$/i.exec((podName ?? "").trim());
  if (!match) {
    return null;
  }

  const number = Number(match[1]);
  if (number < 1 || number > 20) {
    return null;
  }

  return String(number).padStart(2, "0");
}

export function unavailableProgress(
  podNumber: string,
  baseUrl = trackerBaseUrl,
): PodProgress {
  return {
    podName: `Pod${podNumber}`,
    studentNumber: podNumber,
    checkedAt: new Date().toISOString(),
    overallPercentage: 0,
    completedModules: 0,
    totalModules: 0,
    currentModule: null,
    status: "unavailable",
    modules: [],
    trackerUrl: `${baseUrl.replace(/\/+$/, "")}/pod/${podNumber}`,
  };
}

export function parsePodProgress(podNumber: string, body: unknown) {
  const parsed = podProgressSchema.safeParse(body);
  if (
    !parsed.success ||
    parsed.data.studentNumber !== podNumber ||
    parsed.data.podName !== `Pod${podNumber}`
  ) {
    return null;
  }

  return parsed.data;
}

export async function getPodProgress(
  podName: string | null | undefined,
): Promise<PodProgress | null> {
  const podNumber = podNumberFromPodName(podName);
  if (!podNumber) {
    return null;
  }

  const env = readServerEnv();
  const baseUrl = env.TRAINING_TRACKER_BASE_URL ?? trackerBaseUrl;
  if (!env.TRAINING_TRACKER_API_TOKEN) {
    return unavailableProgress(podNumber, baseUrl);
  }

  try {
    const url = new URL(`/api/v1/pods/${podNumber}/progress`, baseUrl);
    const response = await fetch(url, {
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${env.TRAINING_TRACKER_API_TOKEN}`,
      },
      signal: AbortSignal.timeout(8_000),
    });

    if (!response.ok) {
      return unavailableProgress(podNumber, baseUrl);
    }

    return (
      parsePodProgress(podNumber, await response.json()) ??
      unavailableProgress(podNumber, baseUrl)
    );
  } catch {
    return unavailableProgress(podNumber, baseUrl);
  }
}
