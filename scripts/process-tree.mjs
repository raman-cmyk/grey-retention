import { execFileSync } from 'node:child_process'
const snapshot = () =>
  execFileSync('ps', ['-eo', 'pid=,ppid=,lstart='], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore']
  })
    .trim()
    .split('\n')
    .map((line) => {
      const [pid, ppid, ...started] = line.trim().split(/\s+/)
      return {
        pid: Number(pid),
        ppid: Number(ppid),
        started: started.join(' ')
      }
    })
/** Only the captured descendants of this tracked child are terminated. Birth times prevent PID reuse from targeting another process. */
export async function stopProcessTree(rootPid, signal = 'SIGTERM') {
  const rows = snapshot(),
    owned = new Set([rootPid])
  let changed = true
  while (changed) {
    changed = false
    for (const row of rows)
      if (owned.has(row.ppid) && !owned.has(row.pid)) {
        owned.add(row.pid)
        changed = true
      }
  }
  const targets = rows.filter((r) => owned.has(r.pid)).reverse()
  for (const row of targets)
    try {
      process.kill(row.pid, signal)
    } catch {}
  await new Promise((resolve) => setTimeout(resolve, 500))
  const alive = snapshot()
  for (const row of targets)
    if (alive.some((r) => r.pid === row.pid && r.started === row.started))
      try {
        process.kill(row.pid, 'SIGKILL')
      } catch {}
  await new Promise((resolve) => setTimeout(resolve, 250))
  return targets.map((r) => r.pid)
}
