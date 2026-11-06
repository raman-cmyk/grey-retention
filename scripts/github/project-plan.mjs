// Builds the GitHub roadmap plan (labels, milestones, epics and issues) from
// docs/feature-register.json and .github/project/roadmap.json.
// Usage: node scripts/github/project-plan.mjs [--summary|--json|--markdown]
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const REPOSITORY_URL = 'https://github.com/raman-cmyk/grey-retention'
const ID_PATTERN = /^([A-Z]+)-\d{3}$/
const EPIC_TITLE = /^Epic: ([A-Z]+) · /
const ISSUE_TITLE = /^([A-Z]+-\d{3}) /

export function loadInputs(
  root = join(dirname(fileURLToPath(import.meta.url)), '../..')
) {
  return {
    register: JSON.parse(
      readFileSync(join(root, 'docs/feature-register.json'), 'utf8')
    ),
    roadmap: JSON.parse(
      readFileSync(join(root, '.github/project/roadmap.json'), 'utf8')
    )
  }
}

export function prefixOf(id) {
  const match = ID_PATTERN.exec(id)
  if (!match) throw new Error(`Invalid item ID: ${id}`)
  return match[1]
}

export function slugify(text) {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/g, '')
}

export function branchName(id, title) {
  return `claude/${id.toLowerCase()}-${slugify(title)}`
}

/** Returns the stable roadmap key of an issue title: an item ID or `epic:<PREFIX>`. */
export function issueKey(title) {
  const epic = EPIC_TITLE.exec(title)
  if (epic) return `epic:${epic[1]}`
  const item = ISSUE_TITLE.exec(title)
  return item ? item[1] : null
}

function categoryLabel(name) {
  return name.replace(/ — highest priority$/, '')
}

function validate(register, roadmap) {
  const milestoneKeys = new Set(roadmap.milestones.map((m) => m.key))
  const ids = new Set()
  for (const feature of register.features) {
    if (ids.has(feature.id))
      throw new Error(`Duplicate register ID ${feature.id}`)
    ids.add(feature.id)
    const category = roadmap.categories[prefixOf(feature.id)]
    if (!category) throw new Error(`No roadmap category for ${feature.id}`)
    if (!milestoneKeys.has(category.milestone))
      throw new Error(
        `Unknown milestone ${category.milestone} for ${feature.id}`
      )
  }
  for (const [id, key] of Object.entries(roadmap.milestoneOverrides)) {
    if (!ids.has(id)) throw new Error(`Override for unknown register ID ${id}`)
    if (!milestoneKeys.has(key))
      throw new Error(`Unknown milestone ${key} for ${id}`)
  }
  for (const id of Object.keys(roadmap.typeOverrides ?? {}))
    if (!ids.has(id))
      throw new Error(`Type override for unknown register ID ${id}`)
  for (const item of roadmap.workItems) {
    if (ids.has(item.id) || roadmap.categories[prefixOf(item.id)])
      throw new Error(`Work item ${item.id} collides with the feature register`)
    if (!milestoneKeys.has(item.milestone))
      throw new Error(`Unknown milestone ${item.milestone} for ${item.id}`)
    ids.add(item.id)
  }
}

function milestoneDescription(milestone) {
  return `${milestone.goal}\n\nDone when: ${milestone.doneWhen}`
}

function itemBody(feature, milestone, category) {
  const lines = [
    `**Register:** \`${feature.id}\` · ${feature.priority} · ${categoryLabel(feature.category)}`,
    `**Register status:** \`${feature.status}\`${
      feature.implementation_tasks?.length
        ? ` · earlier work: ${feature.implementation_tasks.join(', ')}`
        : ''
    }`,
    `**Milestone:** ${milestone.title} · **Area:** \`area:${category.area}\``,
    '',
    '### Acceptance',
    '',
    feature.acceptance
  ]
  if (feature.remaining)
    lines.push(
      '',
      '### Still missing (from the register)',
      '',
      feature.remaining
    )
  lines.push(
    '',
    '### Done when',
    '',
    '- [ ] The acceptance above is met and proven by tests (behaviour, authorization, state changes, failure paths).',
    `- [ ] \`pnpm verify\` is green, \`${feature.id}\` is \`verified_fixture\` in the feature register and the ledger has a handoff entry.`,
    '',
    `Branch: \`${branchName(feature.id, feature.feature)}\``
  )
  return lines.join('\n')
}

function workItemBody(item, milestone) {
  const lines = [
    `**Work item:** \`${item.id}\` · ${item.priority} · ${milestone.title} · project task (not in the feature register)`
  ]
  if (item.blockedBy) lines.push(`**Blocked by:** ${item.blockedBy}`)
  lines.push(
    '',
    '### Problem',
    '',
    item.problem,
    '',
    '### Scope',
    '',
    ...item.scope.map((step) => `- ${step}`),
    '',
    '### Done when',
    '',
    item.doneWhen,
    '',
    '- [ ] Proven by tests (behaviour, authorization, state changes, failure paths); `pnpm verify` is green; the ledger has a handoff entry.',
    '',
    `Branch: \`${branchName(item.id, item.title)}\``
  )
  return lines.join('\n')
}

function epicBody(prefix, features, category, milestone) {
  const p0 = features.filter((f) => f.priority === 'P0')
  const later = features.filter((f) => f.priority !== 'P0')
  const count = (priority) =>
    features.filter((f) => f.priority === priority).length
  const lines = [
    `**Category:** ${categoryLabel(features[0].category)} (\`${prefix}\`) · \`area:${category.area}\``,
    `**Planned milestone:** ${milestone.title}${p0.length ? ' (each P0 issue carries its own milestone)' : ''}`,
    `**Items:** ${features.length} — P0 ${count('P0')}, P1 ${count('P1')}, P2 ${count('P2')}`,
    ''
  ]
  lines.push(
    p0.length
      ? `P0 items have their own issues, attached below as sub-issues.`
      : 'This category has no P0 items.',
    ''
  )
  if (later.length) {
    lines.push('### P1 / P2 items', '')
    for (const f of later)
      lines.push(
        `- [ ] \`${f.id}\` ${f.feature} — ${f.priority} · \`${f.status}\``
      )
    lines.push(
      '',
      'Each item gets its own issue when work starts. Acceptance text lives in the feature register.'
    )
  } else lines.push('This category has no P1/P2 items.')
  lines.push(
    '',
    `Source: [feature register](${REPOSITORY_URL}/blob/main/docs/feature-register.json) · [Roadmap](${REPOSITORY_URL}/blob/main/docs/ROADMAP.md)`
  )
  return lines.join('\n')
}

export function buildPlan(register, roadmap) {
  validate(register, roadmap)
  const milestones = roadmap.milestones.map((m) => ({
    key: m.key,
    title: m.title,
    description: milestoneDescription(m)
  }))
  const milestoneByKey = new Map(roadmap.milestones.map((m) => [m.key, m]))
  const areaLabels = Object.entries(roadmap.categories).map(([prefix, c]) => {
    const feature = register.features.find((f) => prefixOf(f.id) === prefix)
    return {
      name: `area:${c.area}`,
      color: roadmap.labels.areaColor,
      description: (feature ? categoryLabel(feature.category) : prefix).slice(
        0,
        100
      )
    }
  })
  const labels = [
    ...roadmap.labels.priority,
    ...roadmap.labels.type,
    ...roadmap.labels.extra,
    ...areaLabels
  ]

  const byPrefix = new Map()
  for (const f of register.features) {
    const prefix = prefixOf(f.id)
    if (!byPrefix.has(prefix)) byPrefix.set(prefix, [])
    byPrefix.get(prefix).push(f)
  }

  const epics = [...byPrefix.entries()].map(([prefix, features]) => {
    const category = roadmap.categories[prefix]
    const milestone = milestoneByKey.get(category.milestone)
    return {
      key: `epic:${prefix}`,
      prefix,
      title: `Epic: ${prefix} · ${categoryLabel(features[0].category)}`,
      labels: ['epic', `area:${category.area}`],
      milestone: milestone.title,
      body: epicBody(prefix, features, category, milestone)
    }
  })

  const workItems = roadmap.workItems.map((item) => {
    const milestone = milestoneByKey.get(item.milestone)
    return {
      key: item.id,
      id: item.id,
      title: `${item.id} ${item.title}`,
      labels: [
        `priority:${item.priority}`,
        `type:${item.type}`,
        `area:${item.area}`
      ],
      milestone: milestone.title,
      body: workItemBody(item, milestone)
    }
  })

  const items = register.features
    .filter((f) => f.priority === 'P0')
    .map((f) => {
      const prefix = prefixOf(f.id)
      const category = roadmap.categories[prefix]
      const milestone = milestoneByKey.get(
        roadmap.milestoneOverrides[f.id] ?? category.milestone
      )
      const type = roadmap.typeOverrides?.[f.id] ?? 'feature'
      return {
        key: f.id,
        id: f.id,
        epic: `epic:${prefix}`,
        title: `${f.id} ${f.feature}`,
        labels: [
          `priority:${f.priority}`,
          `type:${type}`,
          `area:${category.area}`
        ],
        milestone: milestone.title,
        body: itemBody(f, milestone, category)
      }
    })

  return { labels, milestones, epics, workItems, items }
}

/** Maps every roadmap issue key to the milestone title it belongs in. */
export function milestoneByIssueKey(plan) {
  return new Map(
    [...plan.epics, ...plan.workItems, ...plan.items].map((issue) => [
      issue.key,
      issue.milestone
    ])
  )
}

export function summaryMarkdown(plan) {
  const rows = plan.milestones.map((m) => {
    const work = plan.workItems
      .filter((i) => i.milestone === m.title)
      .map((i) => i.id)
    const p0 = plan.items
      .filter((i) => i.milestone === m.title)
      .map((i) => i.id)
    const epics = plan.epics
      .filter((e) => e.milestone === m.title)
      .map((e) => e.prefix)
    return `| ${m.title} | ${work.length + p0.length} | ${
      [...work, ...p0].join(', ') || '—'
    } | ${epics.join(', ') || '—'} |`
  })
  return [
    '| Milestone | P0 issues | Issue IDs | Category epics (P1/P2 checklists) |',
    '| --- | --- | --- | --- |',
    ...rows
  ].join('\n')
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { register, roadmap } = loadInputs()
  const plan = buildPlan(register, roadmap)
  const mode = process.argv[2] ?? '--summary'
  if (mode === '--json')
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`)
  else if (mode === '--markdown')
    process.stdout.write(`${summaryMarkdown(plan)}\n`)
  else {
    const counts = new Map()
    for (const issue of [...plan.workItems, ...plan.items])
      counts.set(issue.milestone, (counts.get(issue.milestone) ?? 0) + 1)
    console.log(
      `labels ${plan.labels.length}, milestones ${plan.milestones.length}`
    )
    console.log(
      `epics ${plan.epics.length}, work items ${plan.workItems.length}, P0 items ${plan.items.length}`
    )
    for (const [milestone, n] of counts) console.log(`  ${milestone}: ${n}`)
  }
}
