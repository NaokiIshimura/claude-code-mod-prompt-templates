import { describe, expect, test } from 'claude-code/testing'

import {
  assignHotkeys,
  buildTemplates,
  findTemplate,
  mergeTemplates,
  parseTemplate,
  sortTemplates,
  toHint,
  toOptionLabel,
} from './parse'

describe('parseTemplate', () => {
  test('uses the whole file as the body and defaults without frontmatter', () => {
    expect(parseTemplate('review.md', 'Review this\n', 'user')).toEqual({
      key: 'review',
      label: 'review',
      mode: 'insert',
      order: null,
      body: 'Review this',
      source: 'user',
    })
  })

  test('reads label / mode / order from the frontmatter', () => {
    const text = '---\nlabel: "Code Review"\nmode: replace\norder: 2\nunknown: x\n---\n\nline 1\nline 2\n'
    expect(parseTemplate('review.md', text, 'project')).toEqual({
      key: 'review',
      label: 'Code Review',
      mode: 'replace',
      order: 2,
      body: 'line 1\nline 2',
      source: 'project',
    })
  })

  test('handles \\r\\n line endings', () => {
    const template = parseTemplate('a.md', '---\r\nlabel: A\r\n---\r\nbody\r\n', 'user')
    expect(template.label).toBe('A')
    expect(template.body).toBe('body')
  })

  test('uses the whole file as the body without a closing ---', () => {
    const template = parseTemplate('a.md', '---\nlabel: A\nbody', 'user')
    expect(template.label).toBe('a')
    expect(template.body).toBe('---\nlabel: A\nbody')
  })

  test('falls back to defaults for an invalid mode / order and an empty label', () => {
    const template = parseTemplate('a.md', "---\nlabel: ''\nmode: wrong\norder: first\n---\nbody", 'user')
    expect(template.label).toBe('a')
    expect(template.mode).toBe('insert')
    expect(template.order).toBeNull()
  })

  test('ignores lines without : and keeps : inside a value', () => {
    const template = parseTemplate('a.md', '---\nnote\nlabel: a:b\n---\nbody', 'user')
    expect(template.label).toBe('a:b')
  })
})

describe('mergeTemplates / sortTemplates / assignHotkeys', () => {
  const make = (key: string, order: number | null, source: 'user' | 'project' = 'user') =>
    parseTemplate(`${key}.md`, order === null ? key : `---\norder: ${order}\n---\n${key}`, source)

  test('keeps the project template for the same key', () => {
    const merged = mergeTemplates([make('a', null), make('b', null)], [make('a', null, 'project')])
    expect(merged.map(one => [one.key, one.source])).toEqual([
      ['a', 'project'],
      ['b', 'user'],
    ])
  })

  test('sorts by ascending order, then templates without order by label', () => {
    const sorted = sortTemplates([make('c', null), make('b', 2), make('a', null), make('d', 1)])
    expect(sorted.map(one => one.key)).toEqual(['d', 'b', 'a', 'c'])
  })

  test('breaks order ties by label', () => {
    const sorted = sortTemplates([make('b', 1), make('a', 1)])
    expect(sorted.map(one => one.key)).toEqual(['a', 'b'])
  })

  test('assigns 1-9 to the first nine templates', () => {
    const keys = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j']
    const assigned = assignHotkeys(keys.map(key => make(key, null)))
    expect(assigned.map(one => one.hotkey)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', null])
  })

  test('buildTemplates merges, sorts and assigns hotkeys', () => {
    const built = buildTemplates([make('b', null)], [make('a', null, 'project')])
    expect(built.map(one => [one.key, one.hotkey])).toEqual([
      ['a', '1'],
      ['b', '2'],
    ])
  })
})

describe('findTemplate / toOptionLabel', () => {
  const templates = buildTemplates(
    [parseTemplate('review.md', '---\nlabel: Code Review\n---\nx', 'user')],
    [parseTemplate('code review.md', 'y', 'project')],
  )

  test('prefers a key match over a label match, case-insensitively', () => {
    expect(findTemplate(templates, 'REVIEW')?.key).toBe('review')
    expect(findTemplate(templates, 'code review')?.key).toBe('code review')
  })

  test('finds by label and returns undefined when nothing matches', () => {
    const onlyLabel = buildTemplates([parseTemplate('r.md', '---\nlabel: Review\n---\nx', 'user')], [])
    expect(findTemplate(onlyLabel, 'review')?.key).toBe('r')
    expect(findTemplate(onlyLabel, 'none')).toBeUndefined()
  })

  test('shows "1: label" with a hotkey and the label alone without one', () => {
    const review = findTemplate(templates, 'review')!
    expect(toOptionLabel({ ...review, hotkey: '1' })).toBe('1: Code Review')
    expect(toOptionLabel({ ...review, hotkey: null })).toBe('Code Review')
  })
})

describe('toHint', () => {
  test('hints the number key on an empty prompt and ctrl + x > tab otherwise', () => {
    expect(toHint(true)).toBe('(press a number on an empty prompt)')
    expect(toHint(false)).toBe('(focus buttons: ctrl + x > tab)')
  })
})
