#!/usr/bin/env python3
"""Push read-only Proxmox health snapshots to the DRCC Lab Companion.

Runs inside the lab network (any host that can reach the Proxmox API), so the
Proxmox management interface never needs to be published on the internet. Every
interval it reads /nodes and /cluster/resources?type=vm with a read-only API
token and POSTs a normalized status and utilization snapshot to the portal's
ingest endpoint.

Configuration comes from the environment (see lab-status-poller.env.example):

  PROXMOX_API_BASE_URL      https://192.168.1.90:8006
  PROXMOX_API_TOKEN_ID      drcc-monitor@pve!lab-status
  PROXMOX_API_TOKEN_SECRET  <token secret>
  PROXMOX_VERIFY_TLS        path to the Proxmox cluster CA (pve-root-ca.pem), or "false"
  DRCC_INGEST_URL           https://my.digitalrcc.com/api/lab-status/ingest
  LAB_STATUS_INGEST_SECRET  <bearer secret shared with the portal>
  POLL_INTERVAL_SECONDS     45
"""

from __future__ import annotations

import json
import os
import ssl
import sys
import time
import urllib.error
import urllib.request

BASE_URL = os.environ["PROXMOX_API_BASE_URL"].rstrip("/")
TOKEN_ID = os.environ["PROXMOX_API_TOKEN_ID"]
TOKEN_SECRET = os.environ["PROXMOX_API_TOKEN_SECRET"]
INGEST_URL = os.environ["DRCC_INGEST_URL"]
INGEST_SECRET = os.environ["LAB_STATUS_INGEST_SECRET"]
VERIFY_TLS = os.environ.get("PROXMOX_VERIFY_TLS", "")
INTERVAL = int(os.environ.get("POLL_INTERVAL_SECONDS", "45"))

METRIC_FIELDS = (
    "cpu",
    "maxcpu",
    "mem",
    "maxmem",
    "disk",
    "maxdisk",
    "uptime",
    "netin",
    "netout",
    "diskread",
    "diskwrite",
)
NODE_FIELDS = ("node", "status", *METRIC_FIELDS)
RESOURCE_FIELDS = ("id", "name", "node", "status", "type", "vmid", *METRIC_FIELDS)


def ssl_context() -> ssl.SSLContext:
    """Verifies against the Proxmox CA when given; the API cert is not public."""
    if not VERIFY_TLS:
        return ssl.create_default_context()

    if VERIFY_TLS.lower() not in {"false", "0", "no"}:
        context = ssl.create_default_context(cafile=VERIFY_TLS)
        # The PVE Cluster Manager CA omits the keyUsage extension, which OpenSSL's
        # strict profile (default from Python 3.13) rejects. Chain, hostname, and
        # expiry are still verified.
        context.verify_flags &= ~getattr(ssl, "VERIFY_X509_STRICT", 0)
        return context

    context = ssl.create_default_context()
    context.check_hostname = False
    context.verify_mode = ssl.CERT_NONE
    return context


def proxmox_get(path: str):
    request = urllib.request.Request(
        BASE_URL + path,
        headers={"Authorization": f"PVEAPIToken={TOKEN_ID}={TOKEN_SECRET}"},
    )
    with urllib.request.urlopen(request, timeout=10, context=ssl_context()) as response:
        return json.load(response)["data"]


def select_fields(row: dict, fields: tuple[str, ...]) -> dict:
    return {field: row[field] for field in fields if row.get(field) is not None}


def collect() -> dict:
    nodes = [select_fields(node, NODE_FIELDS) for node in proxmox_get("/api2/json/nodes")]
    resources = [
        select_fields(resource, RESOURCE_FIELDS)
        for resource in proxmox_get("/api2/json/cluster/resources?type=vm")
    ]

    return {
        "checkedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "nodes": nodes,
        "resources": resources,
        "source": "internal-poller",
    }


def publish(snapshot: dict) -> None:
    request = urllib.request.Request(
        INGEST_URL,
        data=json.dumps(snapshot).encode(),
        method="POST",
        headers={
            "Authorization": f"Bearer {INGEST_SECRET}",
            "Content-Type": "application/json",
        },
    )
    with urllib.request.urlopen(request, timeout=15) as response:
        json.load(response)


def once() -> bool:
    try:
        snapshot = collect()
    except Exception as error:  # noqa: BLE001 - keep the loop alive
        # No snapshot is published, so the portal ages out to gray rather than
        # reporting a false outage.
        print(f"proxmox read failed: {error}", file=sys.stderr, flush=True)
        return False

    try:
        publish(snapshot)
    except urllib.error.HTTPError as error:
        print(f"ingest failed: HTTP {error.code}", file=sys.stderr, flush=True)
        return False
    except Exception as error:  # noqa: BLE001
        print(f"ingest failed: {error}", file=sys.stderr, flush=True)
        return False

    print(
        f"published {len(snapshot['resources'])} resources, "
        f"{len(snapshot['nodes'])} nodes",
        flush=True,
    )
    return True


def main() -> int:
    if "--once" in sys.argv:
        return 0 if once() else 1

    while True:
        once()
        time.sleep(INTERVAL)


if __name__ == "__main__":
    sys.exit(main())
