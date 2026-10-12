import type { Template, TemplateMode, TemplateSource } from '../types'

export type ParsedTemplate = Omit<Template, 'hotkey'>

export const TEMPLATE_DIR = '.claude/prompt-templates'

const MODES: readonly TemplateMode[] = ['insert', 'replace', 'append']

const HOTKEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const

const unquote = (value: string) => value.replace(/^(["'])(.*)\1$/, '$2')

// Read the lines between the leading `---` and the next `---` as `key: value`; the rest is the body
const splitFrontmatter = (text: string) => {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === '---')
  if (lines[0]?.trim() !== '---' || end === -1) {
    return { meta: new Map<string, string>(), body: lines.join('\n') }
  }

  const meta = new Map<string, string>()
  for (const line of lines.slice(1, end)) {
    const at = line.indexOf(':')
    if (at !== -1) {
      meta.set(line.slice(0, at).trim(), unquote(line.slice(at + 1).trim()))
    }
  }

  const rest = lines.slice(end + 1)
  if (rest[0]?.trim() === '') {
    rest.shift()
  }

  return { meta, body: rest.join('\n') }
}

const toMode = (value: string | undefined): TemplateMode =>
  MODES.find(mode => mode === value) ?? 'insert'

const toOrder = (value: string | undefined): number | null =>
  value !== undefined && /^-?\d+(\.\d+)?$/.test(value) ? Number(value) : null

export const parseTemplate = (
  fileName: string,
  text: string,
  source: TemplateSource,
): ParsedTemplate => {
  const key = fileName.replace(/\.md$/i, '')
  const { meta, body } = splitFrontmatter(text)

  return {
    key,
    label: meta.get('label') || key,
    mode: toMode(meta.get('mode')),
    order: toOrder(meta.get('order')),
    // Trailing newlines would get in the way of typing after the insertion
    body: body.replace(/\n+$/, ''),
    source,
  }
}

// For the same key, the project's template wins
export const mergeTemplates = (
  user: readonly ParsedTemplate[],
  project: readonly ParsedTemplate[],
): ParsedTemplate[] => [
  ...new Map([...user, ...project].map(template => [template.key, template])).values(),
]

// Templates with an order come first, ascending; ties go by label
export const sortTemplates = (templates: readonly ParsedTemplate[]): ParsedTemplate[] =>
  [...templates].sort((a, b) => {
    if (a.order !== b.order) {
      if (a.order === null) return 1
      if (b.order === null) return -1
      return a.order - b.order
    }
    return a.label.localeCompare(b.label)
  })

export const assignHotkeys = (templates: readonly ParsedTemplate[]): Template[] =>
  templates.map((template, index) => ({ ...template, hotkey: HOTKEYS[index] ?? null }))

export const buildTemplates = (
  user: readonly ParsedTemplate[],
  project: readonly ParsedTemplate[],
): Template[] => assignHotkeys(sortTemplates(mergeTemplates(user, project)))

// The hint at the end of the button row: a bare number key works on an empty prompt; otherwise the row needs focus first
export const EMPTY_PROMPT_HINT = '(press a number on an empty prompt)'

export const FOCUS_BAND_HINT = '(focus buttons: ctrl + x > tab)'

export const toHint = (isDraftEmpty: boolean) => (isDraftEmpty ? EMPTY_PROMPT_HINT : FOCUS_BAND_HINT)

// The name shown in the list ("1: review" when there is a hotkey)
export const toOptionLabel = (template: Template) =>
  template.hotkey ? `${template.hotkey}: ${template.label}` : template.label

// Match the key first, then the label (case-insensitive)
export const findTemplate = (
  templates: readonly Template[],
  name: string,
): Template | undefined => {
  const lower = name.toLowerCase()

  return (
    templates.find(template => template.key.toLowerCase() === lower) ??
    templates.find(template => template.label.toLowerCase() === lower)
  )
}
