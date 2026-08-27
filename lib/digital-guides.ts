import {
  buildStudentLabIdentity,
  type StudentLabIdentity,
} from "@/lib/student-lab";

export const acGuideRelease = {
  code: "AC",
  effectiveDate: "August 2026",
  family: "Access Control",
  labCount: 12,
  pdfPath: "/guides/ac-lab-completion-guide.pdf",
  route: "/guides/ac",
  version: "2026.08.1",
} as const;

export type DigitalGuideMode = "personalized" | "pending" | "review";

export type DigitalGuideContext = {
  identity: StudentLabIdentity | null;
  mode: DigitalGuideMode;
};

export function getAcGuideContext({
  identity,
  manager,
}: {
  identity: StudentLabIdentity | null;
  manager: boolean;
}): DigitalGuideContext {
  if (manager) {
    return {
      identity: buildStudentLabIdentity(1),
      mode: "review",
    };
  }

  return {
    identity,
    mode: identity ? "personalized" : "pending",
  };
}

export function replaceGuideTokens(
  source: string,
  identity: StudentLabIdentity | null,
) {
  const values: Record<string, string> = {
    artifactsPath: identity?.artifactsPath ?? "C:\\CyberLab\\PodXX\\",
    domainController: identity?.domainController ?? "PODXX-DC",
    domainName: identity?.domainName ?? "acs-p01.local",
    gatewayAddress: identity?.gatewayAddress ?? "10.51.XX.1",
    guacamoleUrl:
      identity?.guacamoleUrl ?? "https://crc.guac.01.tcecure.com/#/",
    labUsername: identity?.labUsername ?? "studentXX",
    podName: identity?.podName ?? "PodXX",
    podPrefix: identity?.podPrefix ?? "PXX",
    studentNumber: identity?.studentNumber ?? "XX",
  };

  return source.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
    return values[key] ?? match;
  });
}
