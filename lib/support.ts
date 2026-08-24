export type CurrentLabNotice = {
  area: string;
  commands?: string[];
  guidance: string;
  note?: string;
  reason?: string;
  steps?: string[];
  symptom?: string;
  title: string;
};

export type ResolvedLabIssue = {
  issue: string;
  resolution: string;
};

export type ExpectedLabBehavior = {
  description: string;
  title: string;
};

export const supportContentLastUpdated = "August 24, 2026";

export const currentLabNotices: CurrentLabNotice[] = [
  {
    area: "AC, IA, and SI labs",
    commands: [
      'cmd /c "set __COMPAT_LAYER=RunAsInvoker&& start "" mmc.exe dsa.msc"',
      "taskschd.msc",
    ],
    guidance:
      "Cancel the prompt. Open the Active Directory Users and Computers shortcut on your desktop. If the shortcut is missing, run the first command below from Windows Run. For Task Scheduler, use the second command.",
    note: "The AC guide and quick-start instructions have been corrected.",
    reason:
      "Student accounts are intentionally not administrators on the shared server, and Server Manager is not used by any lab.",
    symptom:
      "After selecting Server Manager > Tools, you receive a credential prompt followed by an access-denied or unable-to-connect error.",
    title: "Server Manager asks for administrator credentials",
  },
  {
    area: "MP M1-L1",
    guidance:
      "Do not try to mount the media. Use the PXX-FCI-USB-Contents.txt and PXX-Employee-Handbook-Contents.txt listings in C:\\CyberLab\\PodXX\\MP-Artifacts\\. Classify and document the media from those listings; the worksheet and CSV are still graded normally.",
    symptom:
      "The .vhdx media shows 'A required privilege is not held by the client' or requests administrator credentials.",
    title: "The .vhdx media will not open or mount",
  },
  {
    area: "MP M1-L2",
    guidance:
      "Read the disk-management step so you understand the process, but do not attempt it during this cohort. Complete the sanitization log and certificate in the later step using a valid method, result, disposition, SanitizedBy name, and date.",
    note: "The instructor performs the disk operation for this cohort; the log and certificate are the graded work.",
    symptom:
      "Disk Management or diskpart denies the re-create or format operation.",
    title: "The sanitized volume cannot be re-created or formatted",
  },
  {
    area: "IA M2-L1",
    guidance:
      "Create the PXX-svc_backup service account as written, read the Task Scheduler step without attempting it, and continue to M2-L2.",
    note: "This lab is auto-credited for the current cohort.",
    reason:
      "Storing a scheduled-task credential requires administrator rights that students do not have on the shared server.",
    symptom:
      "The PodXX ACS Nightly Backup task step fails, or changing the account it runs under returns Access is denied.",
    title: "The nightly backup task cannot be changed",
  },
  {
    area: "IA M3-L2",
    commands: [
      "Get-ADDefaultDomainPasswordPolicy | Select-Object MinPasswordLength, ComplexityEnabled, LockoutThreshold, PasswordHistoryCount, MaxPasswordAge, MinPasswordAge",
    ],
    guidance:
      "Work through the required settings, then use the command below to verify the live policy. Do not run the Set- command or edit the GPO; both operations will be denied.",
    note: "This lab is auto-credited for the current cohort. The live policy requires 12 characters, complexity, lockout after 10 attempts, 24 remembered passwords, and a 90-day maximum age.",
    reason:
      "The domain password policy is shared by all 20 pods, so it has been hardened centrally.",
    title: "The domain password policy cannot be changed",
  },
  {
    area: "AC L2.1 and password-setting labs",
    guidance:
      "Use a unique password with at least 12 characters, including uppercase and lowercase letters, a number, and a symbol. Do not reuse a recent password. When an older guide refers to the password provided for your portal sign-in, create a separate password that meets this policy instead.",
    reason:
      "The hardened domain policy applies to every account created or updated in the lab. A rejection means the policy is working and does not indicate a problem with your account.",
    symptom:
      "Windows reports that the password does not meet the password policy requirements when you create an account or set a password.",
    title: "The password does not meet the policy requirements",
  },
  {
    area: "SC firewall labs",
    commands: ["http://10.51.XX.1"],
    guidance:
      "Connect to PODXX-DC in Guacamole, open Edge or Firefox on that desktop, and browse to the address below with your pod number in place of XX. For Pod 06, use http://10.51.6.1. Sign in with the firewall credentials issued by your instructor; they are included in your handout and are not published here.",
    reason:
      "The remote-desktop gateway carries desktops and terminals, not websites. The separate PODXX-GW tile was removed.",
    symptom:
      "The old PODXX-GW Guacamole tile times out or repeatedly reconnects.",
    title: "The pod firewall tile times out or loops",
  },
  {
    area: "SC M2-L2 and SC M2-L3",
    guidance:
      "Create the VLAN before assigning the interface. The Add button becomes available on Interfaces > Assignments after at least one VLAN exists.",
    reason:
      "Each pod firewall has only two physical ports for WAN and LAN, so there is no spare interface to assign until a VLAN has been created. The updated SC guide now uses this sequence.",
    steps: [
      "For the DMZ, open Interfaces > VLANs > Add. Select parent interface vtnet1 (LAN), enter VLAN tag 50 and description DMZ, then save.",
      "Open Interfaces > Assignments, select Add, and assign VLAN 50 on vtnet1. It appears as OPT1.",
      "Open Interfaces > OPT1, enable the interface, set the description to DMZ, choose Static IPv4, enter 10.52.XX.1/24 using your pod number, then save and apply changes.",
      "For M2-L3, create VLANs 10, 20, 30, and 40 the same way. Address them 10.61.XX.1/24, 10.62.XX.1/24, 10.63.XX.1/24, and 10.64.XX.1/24.",
      "Do not use an address inside 10.51.XX.0/24 for a DMZ or VLAN; that subnet belongs to the LAN and pfSense will reject the overlap.",
    ],
    symptom:
      "Interfaces > Assignments does not show an Add button when you begin the DMZ or VLAN segmentation lab.",
    title: "The interface assignment Add button is missing",
  },
];

export const resolvedLabIssues: ResolvedLabIssue[] = [
  {
    issue:
      "Only two students could connect at once and new sessions were refused",
    resolution:
      "The shared server now supports 12 simultaneous sessions and has been verified under load.",
  },
  {
    issue:
      "The PodXX ACS Nightly Backup task was not visible in Task Scheduler or PowerShell",
    resolution:
      "Fixed on all 20 pods; the task is present and readable by each student account.",
  },
  {
    issue: "Sign-in was rejected when using ACS\\studentNN",
    resolution:
      "Use studentNN@acs-p01.local or ACS-P01\\studentNN. ACS alone is not a valid domain name.",
  },
  {
    issue: "The guides pointed students to Server Manager for ADUC",
    resolution: "The AC and IA guides and quick-start handouts were reissued.",
  },
  {
    issue: "A Server Manager desktop shortcut was present",
    resolution:
      "The shortcut was removed; the ADUC shortcut is now the supported launcher.",
  },
  {
    issue: "Students could not access C:\\CyberLab\\PodXX\\",
    resolution:
      "Each student account now has full control of its assigned pod evidence folder.",
  },
  {
    issue: "The pod firewall page would not load from the lab desktop",
    resolution:
      "Fixed on all 20 pods; http://10.51.XX.1 now opens from PODXX-DC.",
  },
  {
    issue: "Some pod firewalls were offline",
    resolution: "All 20 pod firewalls were restarted and verified responding.",
  },
];

export const expectedLabBehaviors: ExpectedLabBehavior[] = [
  {
    description:
      "Pod isolation is part of the lab design. You have full control of your own Students > PodXX OU and files only.",
    title: "You cannot see or edit another pod's OU or files",
  },
  {
    description:
      "All required work is possible without shared-server administrator rights, with the current-cohort exceptions documented above.",
    title: "You are not an administrator on the shared server",
  },
  {
    description:
      "The verifier runs on a schedule. This does not represent a zero score; check the progress page again shortly.",
    title: "Progress may briefly show unavailable after evidence is submitted",
  },
  {
    description:
      "CMMC PE Level 1 SCORM errors, including 'sesskey was missing,' occur on the learning platform rather than in the lab environment. Report them to the course platform support address.",
    title: "Course-platform errors are separate from the lab",
  },
];

export const cohortUpdate =
  "Pods are moving to individual lab servers during break week, where each student will be an administrator of their own machine. MP M1-L1, MP M1-L2, IA M2-L1, and IA M3-L2 will then return to full hands-on labs. Already-earned credit will not be affected.";

export function getSupportEmail() {
  return process.env.SUPPORT_EMAIL?.trim() || "support@digitalrcc.com";
}
