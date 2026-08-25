# Approval checkpoint — Namecheap DNS + TLS for `labops.drcc.digitalrcc.com`

**Nothing here has been applied.** This is the exact change set to run after approval;
production DNS is not touched by Devin.

## Current state (verified 2026-08-24)

| Fact | Value |
|---|---|
| `digitalrcc.com` nameservers | `dns1.registrar-servers.com`, `dns2.registrar-servers.com` (Namecheap BasicDNS) |
| `digitalrcc.com` A | `23.236.62.147` (marketing site — do not change) |
| `my.digitalrcc.com` | `CNAME 3c0f0e9e14358c9a.vercel-dns-017.com.` (existing portal, Vercel) |
| `drcc.digitalrcc.com` and below | **NXDOMAIN** — the whole `drcc` namespace is free |
| Lab public edge | `108.31.169.90`, nginx 1.18.0 (Ubuntu) already terminating TLS for `crc.ai.tcecure.com` and `training.status.tcecure.com` |

Every DigitalRCC service sits under a shared `drcc` label — `labops.drcc`, `wiki.drcc`,
`guac01.drcc` — so one `*.drcc.digitalrcc.com` certificate can cover them all later. Four
labels means the existing `*.digitalrcc.com` wildcard does not apply, so this host gets its
own certificate (Option A issues one per host anyway).

## Recommended: Option A — self-hosted behind the existing lab edge

The frontend and gateway ship as one Next.js app on `drcc-labops-01`, so the OpenAI key,
the agent-server bearer key and the AWX token all stay on that VM and the browser only
ever reaches the gateway. This is also the pattern the two existing lab hostnames already
use, so there is no new public entry point.

**1. Namecheap** → Domain List → `digitalrcc.com` → Advanced DNS → Add New Record:

| Type | Host | Value | TTL |
|---|---|---|---|
| `A Record` | `labops.drcc` | `108.31.169.90` | `5 min` during cutover, then Automatic |

Do not create a URL-Redirect/parking record for this host — it breaks ACME validation.
Do not touch the apex `A` or the existing `my` CNAME.

**2. Edge nginx** (the host already serving `crc.ai.tcecure.com` at `108.31.169.90` — I
have no SSH key to that VM, so confirm which one it is before editing). New vhost, TLS
terminated here, proxied to the app on `drcc-labops-01`:

```nginx
server {
    listen 80;
    server_name labops.drcc.digitalrcc.com;
    location /.well-known/acme-challenge/ { root /var/www/html; }
    location / { return 301 https://$host$request_uri; }
}

server {
    listen 443 ssl http2;
    server_name labops.drcc.digitalrcc.com;

    ssl_certificate     /etc/letsencrypt/live/labops.drcc.digitalrcc.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/labops.drcc.digitalrcc.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Frame-Options DENY always;
    add_header X-Content-Type-Options nosniff always;
    add_header Referrer-Policy strict-origin-when-cross-origin always;

    location / {
        proxy_pass http://<drcc-labops-01-ip>:3100;   # gateway/frontend, never :8000
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;        # SSE / websocket run stream
        proxy_set_header Connection $connection_upgrade;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_read_timeout 3600s;                      # long-lived run streams
        proxy_buffering off;                           # streaming
    }
}
```

**3. Certificate** (HTTP-01, same as the existing hosts):

```bash
sudo certbot --nginx -d labops.drcc.digitalrcc.com --redirect
sudo certbot renew --dry-run       # confirm the renewal timer covers the new name
```

Port 80/443 forwarding to this edge already exists, so no firewall change is needed at the
router. **No port forward is created for `drcc-labops-01` itself and none for `:8000`.**

## Alternative: Option B — Vercel-hosted frontend

Add `labops.drcc.digitalrcc.com` to the Vercel project and create the `CNAME` Vercel shows
(the portal uses the project-specific `…vercel-dns-017.com` form). Vercel issues and
renews the certificate automatically.

The cost of this option: Vercel is outside the lab network, so the gateway on
`drcc-labops-01` would need its own public ingress for the frontend to call, and the
OpenAI/AWX credentials would end up split across Vercel and the VM. That contradicts
"the key lives only on the LabOps VM", so Option A is what I've built toward. Option B
remains viable if the frontend is later split from the gateway.

## What never gets a public name

`drcc-labops-01` and the OpenHands Agent Server (`:8000`) get **no DNS record and no port
forward**. They are reachable only from the gateway process on the same host. Admin access
stays on the internal network/VPN.

## Verification after the change

```bash
dig +short labops.drcc.digitalrcc.com                       # 108.31.169.90
curl -sSI http://labops.drcc.digitalrcc.com/                # 301 -> https
curl -sSI https://labops.drcc.digitalrcc.com/               # 200/307, valid cert, HSTS
curl -sS  https://labops.drcc.digitalrcc.com/api/labops/health   # JSON, no secrets
openssl s_client -connect labops.drcc.digitalrcc.com:443 -servername labops.drcc.digitalrcc.com </dev/null 2>/dev/null | openssl x509 -noout -subject -dates
# regressions — must be unchanged
curl -sSI https://crc.ai.tcecure.com/ ; curl -sSI https://training.status.tcecure.com/ ; curl -sSI https://my.digitalrcc.com/
# negatives — must fail
curl -m 5 http://labops.drcc.digitalrcc.com:8000/ || echo "agent server correctly unreachable"
curl -m 5 http://108.31.169.90:8000/          || echo "no agent port forward"
```

## Rollback

Delete the `labops` A record, disable the nginx vhost (`rm /etc/nginx/sites-enabled/labops
&& nginx -t && systemctl reload nginx`) and leave the certificate to expire. Nothing else
shares the record or the vhost, so rollback cannot affect `crc.ai`, the tracker or
`my.digitalrcc.com`.

## Approval requested

- [ ] Option A (recommended) or Option B.
- [ ] Create the DNS record as specified.
- [ ] Confirm which VM is the `108.31.169.90` edge nginx, and grant access if I should install the vhost.
