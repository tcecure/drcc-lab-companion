import {
  buildStudentLabIdentity,
  type StudentLabIdentity,
} from "@/lib/student-lab";

type GuideSectionLink = {
  href: `#${string}`;
  label: string;
};

export type DigitalGuideRelease = {
  code: "AC" | "IA" | "MP" | "PE" | "SC" | "SI";
  effectiveDate: string;
  family: string;
  labCount: number;
  pdfPath: string;
  route: string;
  sections: readonly GuideSectionLink[];
  summary: string;
  version: string;
};

export const digitalGuideReleases = {
  AC: {
    code: "AC",
    effectiveDate: "August 2026",
    family: "Access Control",
    labCount: 12,
    pdfPath: "/guides/ac-lab-completion-guide.pdf",
    route: "/guides/ac",
    summary:
      "A personalized field guide for account management, user lifecycle, least privilege, and access review evidence.",
    version: "2026.08.1",
    sections: [
      { href: "#before-you-begin", label: "Before you begin" },
      { href: "#connect", label: "Connect" },
      { href: "#workspace", label: "Directory workspace" },
      { href: "#module-1", label: "M1 Account management" },
      { href: "#module-2", label: "M2 User lifecycle" },
      { href: "#module-3", label: "M3 Least privilege" },
      { href: "#module-4", label: "M4 Audit and evidence" },
      { href: "#quick-reference", label: "Quick reference" },
      { href: "#completion-checklist", label: "Completion checklist" },
    ],
  },
  IA: {
    code: "IA",
    effectiveDate: "August 2026",
    family: "Identification & Authentication",
    labCount: 12,
    pdfPath: "/guides/ia-lab-completion-guide.pdf",
    route: "/guides/ia",
    summary:
      "Identity and authentication exercises covering user accounts, service identities, password policy, and credential handling.",
    version: "2026.08.1",
    sections: [
      { href: "#before-you-begin", label: "Before you begin" },
      { href: "#connect", label: "Connect" },
      { href: "#workspace", label: "Identity workspace" },
      { href: "#module-1", label: "M1 User identification" },
      { href: "#module-2", label: "M2 Non-person identities" },
      { href: "#module-3", label: "M3 Authentication" },
      { href: "#module-4", label: "M4 Defaults and processes" },
      { href: "#quick-reference", label: "Quick reference" },
      { href: "#completion-checklist", label: "Completion checklist" },
    ],
  },
  SI: {
    code: "SI",
    effectiveDate: "August 2026",
    family: "System & Information Integrity",
    labCount: 12,
    pdfPath: "/guides/si-lab-completion-guide.pdf",
    route: "/guides/si",
    summary:
      "Guided analysis of flaws, patch evidence, malware protection, Group Policy, and security incidents.",
    version: "2026.08.1",
    sections: [
      { href: "#before-you-begin", label: "Before you begin" },
      { href: "#connect", label: "Connect" },
      { href: "#workspace", label: "Integrity workspace" },
      { href: "#module-1", label: "M1 Flaw remediation" },
      { href: "#module-2", label: "M2 Vulnerability and patching" },
      { href: "#module-3", label: "M3 Malware protection" },
      { href: "#module-4", label: "M4 Enforcement and response" },
      { href: "#quick-reference", label: "Quick reference" },
      { href: "#completion-checklist", label: "Completion checklist" },
    ],
  },
  SC: {
    code: "SC",
    effectiveDate: "August 2026",
    family: "System & Communications Protection",
    labCount: 12,
    pdfPath: "/guides/sc-lab-completion-guide.pdf",
    route: "/guides/sc",
    summary:
      "A practical pfSense guide for trust boundaries, segmentation, firewall rules, monitoring, and validation.",
    version: "2026.08.1",
    sections: [
      { href: "#before-you-begin", label: "Before you begin" },
      { href: "#connect", label: "Connect" },
      { href: "#workspace", label: "Firewall workspace" },
      { href: "#module-1", label: "M1 Digital perimeter" },
      { href: "#module-2", label: "M2 Boundaries" },
      { href: "#module-3", label: "M3 Firewall rules" },
      { href: "#module-4", label: "M4 Monitoring" },
      { href: "#quick-reference", label: "Quick reference" },
      { href: "#completion-checklist", label: "Completion checklist" },
    ],
  },
  MP: {
    code: "MP",
    effectiveDate: "August 2026",
    family: "Media Protection",
    labCount: 3,
    pdfPath: "/guides/mp-lab-completion-guide.pdf",
    route: "/guides/mp",
    summary:
      "Media classification, sanitization, reuse, destruction, and the evidence required to support each decision.",
    version: "2026.08.1",
    sections: [
      { href: "#before-you-begin", label: "Before you begin" },
      { href: "#connect", label: "Connect" },
      { href: "#workspace", label: "Media workspace" },
      { href: "#module-1", label: "M1 Media protection" },
      { href: "#quick-reference", label: "Quick reference" },
      { href: "#completion-checklist", label: "Completion checklist" },
    ],
  },
  PE: {
    code: "PE",
    effectiveDate: "August 2026",
    family: "Physical Protection",
    labCount: 6,
    pdfPath: "/guides/pe-lab-completion-guide.pdf",
    route: "/guides/pe",
    summary:
      "Physical access review, visitor escort, badge lifecycle, log reconciliation, and incident response.",
    version: "2026.08.1",
    sections: [
      { href: "#before-you-begin", label: "Before you begin" },
      { href: "#connect", label: "Connect" },
      { href: "#workspace", label: "Physical security workspace" },
      { href: "#module-1", label: "M1 Access authorization" },
      { href: "#module-2", label: "M2 Visitors and badges" },
      { href: "#module-3", label: "M3 Audit and response" },
      { href: "#quick-reference", label: "Quick reference" },
      { href: "#completion-checklist", label: "Completion checklist" },
    ],
  },
} as const satisfies Record<string, DigitalGuideRelease>;

export type DigitalGuideCode = keyof typeof digitalGuideReleases;
export type DigitalGuideMode = "personalized" | "pending" | "review";

export type DigitalGuideContext = {
  identity: StudentLabIdentity | null;
  mode: DigitalGuideMode;
};

export function getDigitalGuideContext({
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
  const artifactsPath = identity?.artifactsPath ?? "C:\\CyberLab\\PodXX\\";
  const values: Record<string, string> = {
    artifactsPath,
    iaArtifactsPath: `${artifactsPath}IA-Artifacts\\`,
    mpArtifactsPath: `${artifactsPath}MP-Artifacts\\`,
    peArtifactsPath: `${artifactsPath}PE-Artifacts\\`,
    scArtifactsPath: `${artifactsPath}SC-Artifacts\\`,
    siArtifactsPath: `${artifactsPath}SI-Artifacts\\`,
    sessionHost: identity?.sessionHost ?? "PODXX-SRV",
    sessionHostAddress: identity?.sessionHostAddress ?? "10.50.XX.20",
    domainControllers: (
      identity?.domainControllers ?? ["DC01-P01", "DC02-P01"]
    ).join(" and "),
    domainName: identity?.domainName ?? "acs-p01.local",
    gatewayAddress: identity?.gatewayAddress ?? "10.51.XX.1",
    guacamoleUrl: identity?.guacamoleUrl ?? "https://guac.01.digitalrcc.com/#/",
    labUsername: identity?.labUsername ?? "studentXX",
    netbiosDomain: identity?.netbiosDomain ?? "ACS-P01",
    podGroup: identity?.podGroup ?? "PODXX",
    podName: identity?.podName ?? "PodXX",
    podNetwork: identity?.podNetwork ?? "10.51.XX.0/24",
    podOctet: identity ? String(Number(identity.studentNumber)) : "XX",
    podPrefix: identity?.podPrefix ?? "PXX",
    progressUrl:
      identity?.progressUrl ?? "https://training.digitalrcc.com/pod/XX",
    studentNumber: identity?.studentNumber ?? "XX",
  };

  return source.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
    return values[key] ?? match;
  });
}
