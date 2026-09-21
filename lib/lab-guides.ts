export type LabGuideWorkspace = "server" | "firewall" | "pod";

export const labGuides = [
  {
    code: "AC",
    title: "Access Control",
    description:
      "Active Directory, Group Policy, permissions, and account access.",
    digitalGuidePath: "/guides/ac",
    digitalGuideVersion: "2026.08.1",
    guidePath: "/guides/ac-lab-completion-guide.pdf",
    labCount: 12,
    pageCount: 17,
    workspace: "server",
  },
  {
    code: "IA",
    title: "Identification & Authentication",
    description:
      "Passwords, authentication controls, identity management, and account policies.",
    digitalGuidePath: "/guides/ia",
    digitalGuideVersion: "2026.08.1",
    guidePath: "/guides/ia-lab-completion-guide.pdf",
    labCount: 12,
    pageCount: 26,
    workspace: "server",
  },
  {
    code: "SI",
    title: "System & Information Integrity",
    description:
      "Vulnerability management, patching, malware protection, and incident evidence.",
    digitalGuidePath: "/guides/si",
    digitalGuideVersion: "2026.08.1",
    guidePath: "/guides/si-lab-completion-guide.pdf",
    labCount: 12,
    pageCount: 28,
    workspace: "server",
  },
  {
    code: "SC",
    title: "System & Communications Protection",
    description:
      "pfSense firewall rules, segmentation, logging, and network protection.",
    digitalGuidePath: "/guides/sc",
    digitalGuideVersion: "2026.08.1",
    guidePath: "/guides/sc-lab-completion-guide.pdf",
    labCount: 12,
    pageCount: 26,
    workspace: "firewall",
  },
  {
    code: "MP",
    title: "Media Protection",
    description:
      "Media classification, sanitization, reuse, and disposal documentation.",
    digitalGuidePath: "/guides/mp",
    digitalGuideVersion: "2026.08.1",
    guidePath: "/guides/mp-lab-completion-guide.pdf",
    labCount: 3,
    pageCount: 13,
    workspace: "pod",
  },
  {
    code: "PE",
    title: "Physical Protection",
    description:
      "Physical access, visitor activity, audit logs, and incident response.",
    digitalGuidePath: "/guides/pe",
    digitalGuideVersion: "2026.08.1",
    guidePath: "/guides/pe-lab-completion-guide.pdf",
    labCount: 6,
    pageCount: 17,
    workspace: "pod",
  },
] as const;

export type LabGuide = (typeof labGuides)[number];

export function getDigitalGuide(code: LabGuide["code"]) {
  const guide = labGuides.find((candidate) => candidate.code === code);

  if (!guide || !("digitalGuidePath" in guide)) {
    return null;
  }

  return {
    path: guide.digitalGuidePath,
    version: guide.digitalGuideVersion,
  };
}
