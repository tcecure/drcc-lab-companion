# Lab domain cutover — `*.tcecure.com` to `*.digitalrcc.com`

Every public lab name resolves to one edge (nginx on `crc-proxy-gateway-01`,
`108.31.169.90`) that terminates TLS with a per-host Let's Encrypt certificate and
proxies to an internal address. The cutover therefore happens name by name at that
edge; no service moves host and no internal address changes.

## Name map

| Old name | New name | Backend |
|---|---|---|
| `crc.lms.tcecure.com` | `lms.digitalrcc.com` | `https://192.168.1.169` (Moodle) |
| `crc.awx.tcecure.com` | `awx.digitalrcc.com` | `http://192.168.1.103:30080` (AWX) |
| `crc.guac.01.tcecure.com` | `guac.01.digitalrcc.com` | `http://192.168.1.51:8080/guacamole/` |
| `crc.guac.02.tcecure.com` | `guac.02.digitalrcc.com` | `http://192.168.50.10:8080/guacamole/` |
| `crc.wiki.tcecure.com`, `drcc.wiki.digitalrcc.com` | `wiki.digitalrcc.com` | `http://192.168.1.42:80` (Wiki.js) |
| `crc.ide.tcecure.com` | `ide.digitalrcc.com` | `http://192.168.1.61:3000` |
| `training.status.tcecure.com` | `training.digitalrcc.com` | portal backend |
| `labops.drcc.digitalrcc.com` | `labops.digitalrcc.com` | `http://192.168.1.65:3100` |
| `crc.ai.tcecure.com` | retired — superseded by LabOps | `http://192.168.1.61:4000` |

`my.digitalrcc.com` (Vercel) is unchanged.

## Order of operations

1. **DNS** — Namecheap `digitalrcc.com`, one `A` record per new host to
   `108.31.169.90`, TTL 5 minutes during the cutover. No URL-redirect records: they
   break ACME HTTP-01 validation.
2. **Edge** — for each name, add a new vhost carrying the old one's proxy body
   verbatim and issue its certificate (`certbot --nginx -d <new name>`). The old
   vhost is left untouched, so both names serve the same backend (dual-serve) and
   links in flight, bookmarks and printed guides keep working. Retiring an old name
   later is a separate, reversible step: replace its `location /` with
   `return 301 https://<new name>$request_uri`.
3. **Applications** — each app that knows its own name has to be told the new one:
   - Moodle: `$CFG->wwwroot` in `/var/www/moodle/config.php`, then
     `php admin/tool/replace/cli/replace.php --search=https://crc.lms.tcecure.com
     --replace=https://lms.digitalrcc.com` to rewrite links stored in course content.
     Purge caches afterwards.
   - AWX: `spec.hostname` and `spec.extra_settings.CSRF_TRUSTED_ORIGINS` on the `awx`
     custom resource. Without the CSRF entry, logins on the new name fail.
   - Wiki.js: Administration → General → Site URL.
   - Guacamole: nothing — it is proxied and stores no absolute URL.
4. **Portal** — `MOODLE_BASE_URL` in Vercel, and the constants in this repo
   (`lib/student-lab.ts`, `lib/digital-guides.ts`, `lib/training-progress.ts`,
   `lib/cohort-progress.ts`), plus `GUAC_WEB_URL` in
   `/etc/drcc/guacamole-session-collector.env` on the Guacamole host.
5. **Student-facing copy** — the six lab completion guides in `crc-awx-labops/docs`,
   their rendered PDFs in `public/guides/`, and the Wiki.js pages.

## Cutover status (2026-09-18)

Done: `lms`, `awx`, `guac.01`, `guac.02`, `wiki`, `ide` — certificates issued and
dual-serving; Moodle `wwwroot` + stored links + caches, AWX `hostname` and
`CSRF_TRUSTED_ORIGINS` (both origins trusted), Wiki.js Site URL, the collector's
`GUAC_WEB_URL`, and Vercel `MOODLE_BASE_URL` (applies on the next deployment).

Outstanding: `training.digitalrcc.com` and `labops.digitalrcc.com` do not resolve at
the authoritative nameservers, so neither has a certificate and
`TRAINING_TRACKER_BASE_URL` in Vercel still points at `training.status.tcecure.com`.
`ide.digitalrcc.com` returns `504`, matching `crc.ide.tcecure.com` — its backend
(`192.168.1.61:3000`) is down, unrelated to the rename.

## Verification per name

```bash
curl -sSI https://<new name>/                    # 200/301/307, no TLS warning
curl -sSI https://<old name>/                    # still serving (dual-serve)
openssl s_client -connect <new name>:443 -servername <new name> </dev/null 2>/dev/null \
  | openssl x509 -noout -subject -dates
```

Moodle additionally needs a login round trip (the `wwwroot` mismatch symptom is a
redirect loop), and AWX needs a real login (CSRF failures only show on POST).

## Rollback

Per name, and independent of the others:

1. Nothing to restore at the edge while both names serve: `rm
   /etc/nginx/sites-enabled/<new name>` then `nginx -t && systemctl reload nginx` is
   enough to take the new name out of service.
2. Revert the application's own base URL (Moodle `wwwroot` + the reverse
   `tool_replace` run, AWX `hostname`/`CSRF_TRUSTED_ORIGINS`, Wiki.js Site URL).
3. Revert the portal constants and `MOODLE_BASE_URL`, redeploy. Moodle's config is
   backed up on the LMS host as `/root/config.php.bak.<timestamp>`.

The old DNS records stay in place throughout, so rollback never waits on DNS
propagation. New certificates are left to expire; they are harmless once unused.
