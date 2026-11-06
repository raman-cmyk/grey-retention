// Applies .github/project/roadmap.json to GitHub: creates or updates labels and
// milestones, then moves roadmap issues into their milestone. It never creates,
// closes or edits issue text. Runs in GitHub Actions with GITHUB_TOKEN.
// Usage: GITHUB_TOKEN=… GITHUB_REPOSITORY=owner/repo node scripts/github/sync-project.mjs [--dry-run]
import { fileURLToPath } from 'node:url'
import {
  buildPlan,
  issueKey,
  loadInputs,
  milestoneByIssueKey
} from './project-plan.mjs'

export function planLabelOps(current, desired) {
  const byName = new Map(
    current.map((label) => [label.name.toLowerCase(), label])
  )
  const ops = []
  for (const label of desired) {
    const existing = byName.get(label.name.toLowerCase())
    if (!existing) ops.push({ kind: 'create-label', label })
    else if (
      existing.color.toLowerCase() !== label.color.toLowerCase() ||
      (existing.description ?? '') !== label.description ||
      existing.name !== label.name
    )
      ops.push({ kind: 'update-label', currentName: existing.name, label })
  }
  return ops
}

export function planMilestoneOps(current, desired) {
  const byTitle = new Map(
    current.map((milestone) => [milestone.title, milestone])
  )
  const ops = []
  for (const milestone of desired) {
    const existing = byTitle.get(milestone.title)
    if (!existing) ops.push({ kind: 'create-milestone', milestone })
    else if (
      (existing.description ?? '') !== milestone.description ||
      existing.state !== 'open'
    )
      ops.push({ kind: 'update-milestone', number: existing.number, milestone })
  }
  return ops
}

/** Issues are matched by their roadmap key (item ID or epic prefix), never by number. */
export function planIssueMilestoneOps(issues, milestones, desiredByKey) {
  const numberByTitle = new Map(milestones.map((m) => [m.title, m.number]))
  const ops = []
  for (const issue of issues) {
    if (issue.pull_request) continue
    const key = issueKey(issue.title)
    const title = key ? desiredByKey.get(key) : undefined
    if (!title) continue
    const number = numberByTitle.get(title)
    if (number === undefined) throw new Error(`Milestone "${title}" is missing`)
    if (issue.milestone?.number !== number)
      ops.push({
        kind: 'set-issue-milestone',
        issue: issue.number,
        key,
        milestone: number,
        title
      })
  }
  return ops
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function client(token, repository, { pauseMs = 1000 } = {}) {
  const base = `https://api.github.com/repos/${repository}`
  async function request(method, path, body, attempt = 0) {
    const response = await fetch(
      path.startsWith('https://') ? path : `${base}${path}`,
      {
        method,
        headers: {
          accept: 'application/vnd.github+json',
          authorization: `Bearer ${token}`,
          'x-github-api-version': '2022-11-28',
          ...(body ? { 'content-type': 'application/json' } : {})
        },
        body: body ? JSON.stringify(body) : undefined
      }
    )
    const limited =
      response.status === 429 ||
      (response.status === 403 &&
        response.headers.get('x-ratelimit-remaining') === '0') ||
      (response.status === 403 && response.headers.has('retry-after'))
    if (limited && attempt < 4) {
      const wait = Number(response.headers.get('retry-after') ?? 60) * 1000
      console.log(`Rate limited; waiting ${wait / 1000}s`)
      await sleep(wait)
      return request(method, path, body, attempt + 1)
    }
    if (!response.ok)
      throw new Error(
        `${method} ${path} failed: ${response.status} ${await response.text()}`
      )
    if (method !== 'GET') await sleep(pauseMs)
    return {
      data: response.status === 204 ? null : await response.json(),
      response
    }
  }
  async function list(path) {
    const items = []
    let next = `${base}${path}${path.includes('?') ? '&' : '?'}per_page=100`
    while (next) {
      const { data, response } = await request('GET', next)
      items.push(...data)
      next = /<([^>]+)>;\s*rel="next"/.exec(
        response.headers.get('link') ?? ''
      )?.[1]
    }
    return items
  }
  return { request, list }
}

async function apply(api, ops, dryRun) {
  for (const op of ops) {
    console.log(`${dryRun ? '[dry-run] ' : ''}${describe(op)}`)
    if (dryRun) continue
    if (op.kind === 'create-label')
      await api.request('POST', '/labels', op.label)
    if (op.kind === 'update-label')
      await api.request(
        'PATCH',
        `/labels/${encodeURIComponent(op.currentName)}`,
        {
          new_name: op.label.name,
          color: op.label.color,
          description: op.label.description
        }
      )
    if (op.kind === 'create-milestone')
      await api.request('POST', '/milestones', {
        title: op.milestone.title,
        description: op.milestone.description,
        state: 'open'
      })
    if (op.kind === 'update-milestone')
      await api.request('PATCH', `/milestones/${op.number}`, {
        description: op.milestone.description,
        state: 'open'
      })
    if (op.kind === 'set-issue-milestone')
      await api.request('PATCH', `/issues/${op.issue}`, {
        milestone: op.milestone
      })
  }
}

function describe(op) {
  if (op.kind === 'create-label') return `create label ${op.label.name}`
  if (op.kind === 'update-label') return `update label ${op.label.name}`
  if (op.kind === 'create-milestone')
    return `create milestone ${op.milestone.title}`
  if (op.kind === 'update-milestone')
    return `update milestone ${op.milestone.title}`
  return `issue #${op.issue} (${op.key}) → ${op.title}`
}

async function main() {
  const dryRun = process.argv.includes('--dry-run')
  const { GITHUB_TOKEN: token, GITHUB_REPOSITORY: repository } = process.env
  if (!token || !repository)
    throw new Error('GITHUB_TOKEN and GITHUB_REPOSITORY are required')
  const { register, roadmap } = loadInputs()
  const plan = buildPlan(register, roadmap)
  const api = client(token, repository)

  await apply(api, planLabelOps(await api.list('/labels'), plan.labels), dryRun)
  await apply(
    api,
    planMilestoneOps(await api.list('/milestones?state=all'), plan.milestones),
    dryRun
  )
  const milestones = await api.list('/milestones?state=all')
  if (dryRun) {
    const known = new Set(milestones.map((m) => m.title))
    let next = -1
    for (const m of plan.milestones)
      if (!known.has(m.title))
        milestones.push({ title: m.title, number: next-- })
  }
  const issueOps = planIssueMilestoneOps(
    await api.list('/issues?state=all'),
    milestones,
    milestoneByIssueKey(plan)
  )
  await apply(api, issueOps, dryRun)
  console.log(`Done: ${issueOps.length} issue milestone change(s).`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1])
  main().catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
