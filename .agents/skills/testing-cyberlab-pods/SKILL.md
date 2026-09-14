---
name: testing-cyberlab-pods
description: How to interactively test the CyberLab per-pod Windows session hosts (PODxx-SRV / legacy PODxx-DC) through Guacamole and RDP from this box — logging in as a student, driving the Windows GUI reliably despite coordinate scaling, proving local-admin/AD/scheduled-task/VHDX capability inside the session, and classifying isolation denials correctly.
---

# Testing the CyberLab per-pod session hosts (Guacamole → RDP)

Applies to the CyberLab migration where each student gets a domain-joined member server
`PODxx-SRV` at `10.50.<pod>.20` in `acs-p01.local` (NetBIOS `ACS-P01`), with legacy
`PODxx-DC` connections (pointing at DC01 `10.50.1.10`) kept as a rollback path.

## Ground rules that keep this safe

- Everything is **production**. Read-only except explicitly authorized temporary artifacts,
  and re-query every artifact after deletion instead of trusting the delete's silence.
- Never print, echo, or screenshot a password. Type it only into a focused field.
- Do not change firewall rules, Guacamole connection definitions, AD accounts, or pod config.

## Credentials

Two separate, independently rotated sets — do not confuse them:

- Guacamole **web login**: `/home/ubuntu/msmigration/private/guac-passwords.json`
- **AD** password typed at the RDP prompt: `/home/ubuntu/msmigration/private/student-passwords.json`

Type without disclosure:

```bash
export DISPLAY=:0
xdotool type --delay 25 "$(python3 -c "import json;print(json.load(open('/home/ubuntu/msmigration/private/student-passwords.json'))['student01'])")"
```

To verify a field received the right value without revealing it, compare **length and SHA-256**
only. To confirm an AD credential is valid independently of RDP, do a read-only LDAP bind
against DC01 and check for `resultCode=0` — this cleanly separates "bad password" from
"server refused the session".

**The recorded AD password may only be authoritative for the pods the identity reset covered.**
A real failure mode seen in practice: `student01-03` authenticated fine while `student05` failed
RDP with guacd logging `Authentication failure (invalid credentials?)` and DC events
`0xC000006D/0xC000006A`, because AWX template 70 "Reset Student Identities" had only ever been
run with `pod_count=3` — students 04-20 still held the *previous cohort's* passwords. So if a
low-numbered student works and a higher-numbered one fails on an otherwise identical tile,
suspect reset coverage (`pod_count`) rather than the pod, the certificate, or the tile. Stop
after **one** failed attempt (lockout risk) and escalate; the owner re-runs template 70 with
`pod_count=20` and `student_reset_keep_enabled=true`, after which the same file works for all 20.
Always re-read the JSON at type time rather than caching a value across a run.

## Establish ground truth before asserting on the UI

Use the Guacamole token API with each student's own credentials (invalidate the token right
after) to enumerate what that student may see. This makes the UI assertion falsifiable and
catches permission bugs that a screenshot alone cannot.

Known, likely-persistent facts worth re-checking rather than assuming:

- Students see **2** connections (`PODxx-DC`, `PODxx-SRV`), not 3. `PODxx-GW` connections
  exist but have never been permissioned to students — check
  `private/guac-permissions-export.csv` / `evidence/guac-permissions-before.csv` before
  reporting a missing GW tile as a migration regression.
- `PODxx-SRV` intentionally stores **no** password, so an RDP credential prompt is expected.
- The legacy `PODxx-DC` connections **historically** stored a plaintext password. If a tile
  fails with `Log in failed. Please reconnect and try again.` and **no prompt**, suspect a
  stored password left stale by a credential rotation. Diagnose by comparing the stored value
  to the current AD password programmatically and printing only a boolean. This was fixed by
  deleting the `password` parameter from all 20 `PODxx-DC` connections, so they now prompt like
  the SRV tiles; if the failure reappears, check whether a stored password was reintroduced.
- This box is **off the pod network**: `10.50.x.20:3389` and `10.50.1.10:3389` are unreachable
  locally. All pod evidence must come from *inside* the RDP session — local probes prove nothing.
- **After the cutover, a cut-over student has exactly ONE visible connection**, so Guacamole
  **auto-launches it** and never renders a connection list. Do not read that as "the tile list is
  missing": the tab title (e.g. `POD05-SRV`) plus the token-API enumeration is the evidence. A
  student who still has 2+ connections (e.g. held-back `student07`: `POD07-DC` + `POD07-SRV`)
  does get the list, and the `POD07` group node must be expanded with a click on its `+` box.

## Post-cutover DC01 denial (the enforcement assertion)

After students are removed from the domain `Remote Desktop Users` group, `mstsc /v:10.50.1.10`
from inside the member-server session, with the student's own password, walks the full path:
credential prompt → certificate-not-trusted warning for `DC01-P01.acs-p01.local` (click **Yes**)
→ then the refusal dialog:

> The connection was denied because the user account is not authorized for remote login.

Always pair it with `(Test-NetConnection 10.50.1.10 -Port 3389).TcpTestSucceeded` → `True` in the
same screenshot; `True` + that dialog is **authorization** enforcement, whereas an unreachable
3389 would only be a weak network-level result and must be reported as such.

## Driving the Windows GUI reliably

The browser tool's coordinates are **scaled** relative to the real X screen and misclicks are
common (a click meant for a tree node often drops the window behind Server Manager).

- Real screen is `1600x1122` (`xdotool getdisplaygeometry`). Screenshots via
  `scrot -o file.png` are native 1600x1122, but the `read` tool renders them ~1568x1100 —
  multiply coordinates read off the rendered image by **~1.0204** before using `xdotool`.
- Prefer `xdotool mousemove X Y click 1` (or `--repeat 2` to expand a tree node) over browser
  clicks for anything inside the RDP session.
- `wmctrl` does not work here (no usable WM client-list), so window management is limited.
  Taskbar clicks and `alt+Tab` are unreliable for raising a specific window; the reliable way to
  get a window is to **launch a fresh one** via Start-menu search:
  `xdotool key ctrl+Escape`, type `powershell` / `gpmc.msc`, then `Return`
  (`ctrl+shift+Return` for elevated).
- UAC runs on the secure desktop where clicks don't land — accept with `xdotool key alt+y`.

## Proving capability inside the session (the whole point)

A remote WinRM harness cannot prove these (NTLM double hop + UAC token filtering), so run them
interactively and capture exact output.

- **Local admin:** non-elevated `whoami /groups` shows
  `BUILTIN\Administrators ... Group used for deny only`. That is **UAC filtering, not absent
  membership** — do not report it as a failure. Re-check in an **elevated** shell to see it
  enabled. Same cause makes `w32tm /query /source` return
  `Access is denied. (0x80070005)` unelevated.
- **Multi-homed servers:** a readiness check that takes the *first* IPv4 address can report a
  misleading IP (e.g. `192.168.1.x` instead of `10.50.<pod>.20`). Read full `ipconfig` inside
  the session before calling it a defect — POD01 legitimately showed both.
- **Scheduled task with a stored credential:** prefer registering it as the **student's own
  domain account** — that needs no new local account and no privilege change, and it is the
  cleanest proof of the IA M2-L1 capability. Supply the credential through a masked
  `Get-Credential -UserName 'acs-p01\studentXX'` dialog (never echo the password), then
  `Register-ScheduledTask ... -User $c.UserName -Password $c.GetNetworkCredential().Password`.
  Verified working on both POD01-SRV and POD03-SRV: `Principal.LogonType = Password`,
  `UserId = studentXX`, `State = Ready`, and `Start-ScheduledTask` gives
  `LastTaskResult: 0` first try (students are local admins, so the group already holds
  `SeBatchLogonRight`).
  The older trap still applies to a **plain non-admin local account**: it registers fine with
  `LogonType: Password` but silently fails with `LastTaskResult: 267011` and
  `LastRunTime: 11/30/1999` because it lacks `SeBatchLogonRight`. Confirm read-only via
  `secedit /export /areas USER_RIGHTS`; for a throwaway account the least-invasive fix is
  adding it to local Administrators (a granted group) rather than editing policy.
- **Deleting test artifacts under `C:\CyberLab\Podxx`:** never wildcard-delete the tree. Record
  a `PRE-COUNT` (`(Get-ChildItem -Recurse -File $d).Count`) first, create a single uniquely-named
  file, `Remove-Item -LiteralPath` exactly that file, then re-assert the count returned to the
  pre-value. Fresh pods legitimately read `PRE-COUNT=0` (the tree is cleared per cohort; the
  authoritative archive lives on DC01 under `C:\CohortArchive\...`).
- **Log off, don't just disconnect:** closing the browser tab leaves a *disconnected* Windows
  session, and the next Guacamole connect silently **reconnects to it** with the previous run's
  windows still open (easy to mistake for a fresh desktop). Finish every session by typing
  `logoff` in the in-session shell, and expect Guacamole to show `You have been disconnected.`
- **VHDX:** Hyper-V cmdlets (`New-VHD`/`Mount-VHD`/`Get-VHD`) are typically **absent** on these
  member servers. Use DiskPart. Build the script with `Set-Content` for the first line then one
  `Add-Content` per subsequent line — a PowerShell array collapses onto one line and yields
  `The arguments specified for this command are not valid.`
- **ADUC/GPMC:** `dsa.msc` and `gpmc.msc` open for a delegated student; browse
  `acs-p01.local → Students → Podxx`. GPMC needs several expands
  (Forest → Domains → domain → Students → Podxx).

## Classifying isolation denials (do not accept a false pass)

A cross-pod probe that fails because the host is simply **unreachable** looks identical to a
pass but proves nothing about authorization. Always pair the probe with reachability:

```powershell
(Test-NetConnection -ComputerName 10.50.6.20 -Port 445 -WarningAction SilentlyContinue).TcpTestSucceeded
```

Observed pattern worth expecting: another pod's server is **unreachable** on 445/5985/3389
(network isolation → report as a weak/network pass), while DC01 `10.50.1.10` **is** reachable
and returns `Access is denied` (a genuine authorization denial → strong pass). Report the two
differently. Confirmed in both directions (POD01↔POD03), so the weak/strong split is the
expected steady state, not a one-off.

Budget time for this: each unreachable port takes ~20 s to time out, so a three-port probe plus
share/WinRM/`mstsc` attempts is several minutes per host.

**DC RDP is deliberately still open until the final cutover.** A student reaching a full
`DC01-P01` desktop (credentials accepted, cert warning for `DC01-P01.acs-p01.local`, then a
desktop) is **"expected, not yet enforced"** — record the actual behavior, do not call it a
failure, and log off immediately without changing anything on the DC.

## Known flaky/failing area

A pod may refuse RDP at the NLA stage: Guacamole shows `You have been disconnected.` and guacd
logs `Security mode: NLA` / `RDP server closed/refused connection: Disconnected.` This happened
on `POD03-SRV` and was **not** a credential or routing problem — the AD credential bound fine
via LDAP, `10.50.3.20:3389` was open from the Guacamole host, and the certificate CN was right.

How it was actually diagnosed and fixed (try this order next time):

1. Time skew is a plausible but **not** the only cause — it was ruled out here (the pod synced
   from `DC01-P01.acs-p01.local`, stratum 2, secure channel `True`) and the failure persisted.
2. The decisive evidence was **host-side event logs**: the listener logged event **261**
   ("Listener RDP-Tcp received a connection") for each attempt, but there was **no 4625/4776
   locally and no 4768/4771/4776 on the DC** with Success+Failure auditing on. That places the
   failure **inside the TLS/CredSSP stage, before any credential validation** — so stop looking
   at passwords, groups, and firewall rules.
3. Root cause was a **stale self-signed RDP certificate** (issued before an edition
   conversion/reboots) plus a lingering `RDP-Tcp` `SSLCertificateSHA1Hash` binding, alongside
   duplicated firewall rules from a double hardening run. Deleting the "Remote Desktop" store
   certificate and the `SSLCertificateSHA1Hash` binding, removing the duplicate rules, and
   restarting `TermService` (so the certificate regenerates) made NLA succeed immediately.

If a pod won't reach a desktop, every in-session check for it is blocked; say so rather than
inferring. `xfreerdp`/`xfreerdp3` are not installed here for deeper diagnosis, so the host-side
event-log asymmetry above is the most productive signal to ask the pod owner for.

## Devin Secrets Needed

None. Credentials come from the on-disk JSON files above; no secret manager entries are used.
