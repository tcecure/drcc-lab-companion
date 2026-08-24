export type LabGuideWorkspace = "dc" | "firewall" | "pod";

export const labGuides = [
  {
    code: "AC",
    title: "Access Control",
    description:
      "Active Directory, Group Policy, permissions, and account access.",
    guidePath: "/guides/ac-lab-completion-guide.pdf",
    labCount: 12,
    pageCount: 17,
    workspace: "dc",
  },
  {
    code: "IA",
    title: "Identification & Authentication",
    description:
      "Passwords, authentication controls, identity management, and account policies.",
    guidePath: "/guides/ia-lab-completion-guide.pdf",
    labCount: 12,
    pageCount: 22,
    workspace: "dc",
  },
  {
    code: "SI",
    title: "System & Information Integrity",
    description:
      "Vulnerability management, patching, malware protection, and incident evidence.",
    guidePath: "/guides/si-lab-completion-guide.pdf",
    labCount: 12,
    pageCount: 27,
    workspace: "dc",
  },
  {
    code: "SC",
    title: "System & Communications Protection",
    description:
      "pfSense firewall rules, segmentation, logging, and network protection.",
    guidePath: "/guides/sc-lab-completion-guide.pdf",
    labCount: 12,
    pageCount: 25,
    workspace: "firewall",
  },
  {
    code: "MP",
    title: "Media Protection",
    description:
      "Media classification, sanitization, reuse, and disposal documentation.",
    guidePath: "/guides/mp-lab-completion-guide.pdf",
    labCount: 3,
    pageCount: 12,
    workspace: "pod",
  },
  {
    code: "PE",
    title: "Physical Protection",
    description:
      "Physical access, visitor activity, audit logs, and incident response.",
    guidePath: "/guides/pe-lab-completion-guide.pdf",
    labCount: 6,
    pageCount: 14,
    workspace: "pod",
  },
] as const;

export type LabGuide = (typeof labGuides)[number];
