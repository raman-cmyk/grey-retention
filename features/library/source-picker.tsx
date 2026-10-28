'use client'

import { useState } from 'react'
import { Field, controlClass } from '@/components/ui/workspace'

export type StructureSource =
  'fixture_structure' | 'own_template' | 'reference_structure'
type StructureOption = { source: StructureSource; id: string; label: string }
const labels: Record<StructureSource, string> = {
  fixture_structure: 'Original fixture structure',
  own_template: 'Own confirmed-send skeletons',
  reference_structure: 'Subscribed reference structures'
}
const optionValue = (option: StructureOption) => `${option.source}:${option.id}`

export function StructurePicker({
  label,
  templates,
  references,
  allowFixture = false,
  defaultSource,
  defaultId = ''
}: {
  label: string
  templates: { id: string; name: string }[]
  references: { id: string; subject: string }[]
  allowFixture?: boolean
  defaultSource?: string
  defaultId?: string
}) {
  const options: StructureOption[] = [
    ...(allowFixture
      ? [
          {
            source: 'fixture_structure' as const,
            id: '',
            label: labels.fixture_structure
          }
        ]
      : []),
    ...templates.map((t) => ({
      source: 'own_template' as const,
      id: t.id,
      label: t.name
    })),
    ...references.map((r) => ({
      source: 'reference_structure' as const,
      id: r.id,
      label: `${r.subject} · structure only`
    }))
  ]
  const fallback = options[0],
    initial =
      options.find((o) => o.source === defaultSource && o.id === defaultId) ??
      fallback
  const [value, setValue] = useState(initial ? optionValue(initial) : '')
  const selected = options.find((o) => optionValue(o) === value) ?? fallback
  return (
    <div className="sm:col-span-2">
      <Field label={label}>
        <select
          className={controlClass}
          value={selected ? optionValue(selected) : ''}
          onChange={(event) => setValue(event.target.value)}
          required
        >
          {!options.length && (
            <option value="">No authorized structures available</option>
          )}
          {Object.entries(labels).map(([source, groupLabel]) => {
            const group = options.filter((o) => o.source === source)
            return group.length ? (
              <optgroup key={source} label={groupLabel}>
                {group.map((o) => (
                  <option key={optionValue(o)} value={optionValue(o)}>
                    {o.label}
                  </option>
                ))}
              </optgroup>
            ) : null
          })}
        </select>
      </Field>
      <input type="hidden" name="source" value={selected?.source ?? ''} />
      <input type="hidden" name="sourceId" value={selected?.id ?? ''} />
    </div>
  )
}
