#!/bin/sh
# Local helper: restart the dev server (embedded Postgres + app).
PID=$(ps -eo pid,args | awk '$2=="node" && $3=="scripts/dev.js"{print $1}')
[ -n "$PID" ] && kill $PID && sleep 3
nohup node scripts/dev.js > "${LOG:-dev.log}" 2>&1 &
sleep 6; tail -4 "${LOG:-dev.log}"
