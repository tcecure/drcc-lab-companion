# Lab health monitoring (read-only Proxmox)

The admin dashboard shows live lab health for non-technical staff so nobody has
to open Proxmox. Everything here is read-only: the monitor account cannot start,
stop, reconfigure, or console into a VM.

## Architecture

The Proxmox management interface (port 8006) is **not** published to the
internet and must stay that way, and Vercel cannot reach the lab network, so the
portal does not poll Proxmox. Instead:

```
pve1:8006  <--(read-only token, LAN)--  poller (lab host)
                                          |
                                          v  POST + bearer secret
                              https://my.digitalrcc.com/api/lab-status/ingest
                                          |
                                          v
                              Supabase: public.lab_status_snapshots
                                          |
                                          v
                              getLabStatus() -> dashboard card + metrics page
```

`RECOMMENDED_INTEGRATION=internal-poller`. `lib/proxmox/status.ts` still supports
direct API polling, but only when the process running Next.js can reach Proxmox
itself (a developer on the lab network). On Vercel, leave `PROXMOX_API_*` unset.

If no snapshot has arrived, the snapshot read fails, or the newest snapshot is
older than `LAB_STATUS_MAX_AGE_SECONDS`, the card renders **gray/Unknown** and
says so explicitly — a stale or unreachable monitor is never shown as an outage.

## Health rules

| Colour | Meaning                                                                         |
| ------ | ------------------------------------------------------------------------------- |
| green  | Both core DCs and every expected pod component are running                      |
| yellow | Both core DCs run, but a pod component (or expected node) is stopped/missing    |
| red    | A core DC is stopped or missing                                                 |
| gray   | Monitor cannot reach Proxmox, no snapshot yet, or data is stale (not an outage) |

Every result carries `checkedAt` and `failed[]`, the exact resources at fault
(e.g. `POD07-SRV (stopped)`, `DC02 (missing)`).

The dashboard Lab Status card links to `/admin/lab-status`. That admin-only page
shows the current pve1 host utilization and every VM reported by Proxmox,
including state, CPU, memory, disk, uptime, network traffic, and disk I/O. The
page continues to show availability when an older poller sends no utilization
fields; missing values are labeled `Not reported`.

## Inventory (observed 2026-08-18)

`pve1` is a **standalone node** — `/etc/pve/corosync.conf` does not exist, so
there is no cluster. `cluster/resources` therefore returns pve1's 46 VMs.

The two core domain controllers are **virtual machines, not Proxmox nodes**:

| Resource | VMID | Node | Type | Status  |
| -------- | ---- | ---- | ---- | ------- |
| DC01     | 200  | pve1 | qemu | running |
| DC02     | 221  | pve1 | qemu | running |

Pod components (all `qemu` on `pve1`, all running):

| Pod   | Gateway (VMID) | Member server (VMID) |
| ----- | -------------- | -------------------- |
| Pod01 | Pod01-GW (300) | —                    |
| Pod02 | Pod02-GW (301) | —                    |
| Pod03 | Pod03-GW (302) | POD03-SRV (403)      |
| Pod04 | Pod04-GW (303) | POD04-SRV (404)      |
| Pod05 | Pod05-GW (304) | POD05-SRV (405)      |
| Pod06 | Pod06-GW (305) | POD06-SRV (406)      |
| Pod07 | Pod07-GW (306) | POD07-SRV (407)      |
| Pod08 | Pod08-GW (307) | POD08-SRV (408)      |
| Pod09 | Pod09-GW (308) | POD09-SRV (409)      |
| Pod10 | Pod10-GW (309) | POD10-SRV (410)      |
| Pod11 | Pod11-GW (310) | POD11-SRV (411)      |
| Pod12 | Pod12-GW (311) | POD12-SRV (412)      |
| Pod13 | Pod13-GW (312) | POD13-SRV (413)      |
| Pod14 | Pod14-GW (313) | POD14-SRV (414)      |
| Pod15 | Pod15-GW (314) | POD15-SRV (415)      |
| Pod16 | Pod16-GW (315) | —                    |
| Pod17 | Pod17-GW (316) | —                    |
| Pod18 | Pod18-GW (317) | —                    |
| Pod19 | Pod19-GW (318) | —                    |
| Pod20 | Pod20-GW (319) | —                    |

Pods 01–02 and 16–20 have no member server yet; add them to
`PROXMOX_EXPECTED_PODS` when they are built, or the card turns yellow.

TLS: pve1 serves the Proxmox cluster CA certificate
(`CN=pve1.cyberlab.tcecure.com`, valid to 2027-09-20), which is self-signed from
the PVE Cluster Manager CA — not publicly trusted. The poller therefore pins the
cluster CA (`PROXMOX_VERIFY_TLS=/etc/drcc/pve-root-ca.pem`). The leaf certificate
carries `IP:127.0.0.1` and `DNS:pve1` in its SAN, so hostname verification passes
for a loopback base URL when the poller runs on pve1 itself.

## Proxmox access

- User `drcc-monitor@pve`, custom role `DRCCStatus` with `Sys.Audit,VM.Audit`
  only, granted at `/`.
- Privilege-separated token `drcc-monitor@pve!lab-status`.
- Verified allowed: `GET /api2/json/nodes`, `GET /api2/json/cluster/resources?type=vm`.
- Verified denied (HTTP 403): VM start, `vncproxy` (console), storage content.
- The token secret lives only in the poller host's environment file. It is never
  committed, logged, or stored in Vercel.

## Portal configuration (Vercel)

```
PROXMOX_CORE_DC_RESOURCES=DC01,DC02
PROXMOX_EXPECTED_NODES=pve1
PROXMOX_EXPECTED_PODS=Pod01=Pod01-GW;Pod02=Pod02-GW;Pod03=Pod03-GW,POD03-SRV;...;Pod20=Pod20-GW
LAB_STATUS_MAX_AGE_SECONDS=180
LAB_STATUS_INGEST_SECRET=<shared with the poller only>
```

Do **not** set `PROXMOX_API_BASE_URL` / `PROXMOX_API_TOKEN_ID` /
`PROXMOX_API_TOKEN_SECRET` on Vercel; Vercel cannot reach port 8006 and the
secret does not belong there.

## Poller install (lab host)

```bash
sudo useradd --system --home /opt/drcc --shell /usr/sbin/nologin drcc-monitor
sudo install -d -o drcc-monitor -g drcc-monitor /opt/drcc/lab-status-poller
sudo install -o drcc-monitor -m 0644 poller.py /opt/drcc/lab-status-poller/poller.py
sudo install -d -m 0750 -g drcc-monitor /etc/drcc
sudo install -m 0640 -g drcc-monitor /etc/pve/pve-root-ca.pem /etc/drcc/pve-root-ca.pem
sudo install -m 0640 -o drcc-monitor -g drcc-monitor \
  lab-status-poller.env /etc/drcc/lab-status-poller.env   # fill in the secrets first
sudo install -m 0644 lab-status-poller.service /etc/systemd/system/
sudo systemctl enable --now lab-status-poller
```

After updating the portal's poller code, install and restart it on pve1:

```bash
sudo install -o drcc-monitor -m 0644 \
  scripts/lab-status-poller/poller.py /opt/drcc/lab-status-poller/poller.py
sudo systemctl restart lab-status-poller
sudo systemctl status --no-pager lab-status-poller
```

`/etc/drcc` must be group-readable by `drcc-monitor` or the service cannot
traverse it to reach the CA and env file. `python3 poller.py --once` publishes a single snapshot and exits — use it to
verify a new host. When Proxmox cannot be read the poller publishes **nothing**,
so the dashboard ages out to gray instead of reporting a false outage.
