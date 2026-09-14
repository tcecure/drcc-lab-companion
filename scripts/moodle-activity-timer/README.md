# Moodle activity collection timer

The hosting plan allows one Vercel cron invocation per day, so activity
collection runs from the AWX host (192.168.1.103) alongside the existing
`drcc-moodle-sync.timer`. Both read the shared secret from
`/etc/drcc/moodle-sync.env` (chmod 600) — no new credential.

```bash
install -m 644 drcc-moodle-activity.service /etc/systemd/system/
install -m 644 drcc-moodle-activity.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now drcc-moodle-activity.timer
systemctl list-timers drcc-moodle-activity.timer
```

The route is cursor based and refuses unauthenticated callers with 401, so a
duplicate or replayed run cannot produce duplicate events. Rollback:
`systemctl disable --now drcc-moodle-activity.timer`.
