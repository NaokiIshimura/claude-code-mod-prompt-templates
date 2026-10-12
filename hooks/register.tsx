import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Template, TemplateSource } from '../types'
import { buildTemplates, findTemplate, parseTemplate, TEMPLATE_DIR, toHint, toOptionLabel } from './parse'
import type { ParsedTemplate } from './parse'

// The engine does not let $ or atoms cross an import, so everything that touches $ or state lives in this file

const templatesAtom = atom({ plugin: 'prompt-templates', key: 'templates' } as const, [])

const isHiddenAtom = atom({ plugin: 'prompt-templates', key: 'isHidden' } as const, false)

const isDraftEmptyAtom = atom({ plugin: 'prompt-templates', key: 'isDraftEmpty' } as const, true)

const PANE_ID = 'prompt-templates'

// Clearing the prompt with ctrl+c or Esc Esc raises no prompt.edit, so re-read it at this interval while it is not empty
const DRAFT_POLL_MS = 300

const EMPTY_MESSAGE = `Put templates in ~/${TEMPLATE_DIR}/*.md`

// Skip a missing directory (list rejects) and files that cannot be read
const readTemplateDir = async (
  $: EngineInterface,
  dir: string,
  source: TemplateSource,
): Promise<ParsedTemplate[]> => {
  try {
    const entries = await $.fs.list(dir)
    const files = entries.filter(entry => entry.kind === 'file' && /\.md$/i.test(entry.name))
    const parsed = await Promise.all(
      files.map(async file => {
        try {
          return parseTemplate(file.name, await $.fs.read(`${dir}/${file.name}`), source)
        } catch {
          return null
        }
      }),
    )

    return parsed.filter(template => template !== null)
  } catch {
    return []
  }
}

// Load from the user's (~/.claude) and the project's (working directory) folders and store the result
const loadTemplates = async ($: EngineInterface) => {
  const home = await $.env.get('HOME')
  const user = home ? await readTemplateDir($, `${home}/${TEMPLATE_DIR}`, 'user') : []
  const project = await readTemplateDir($, TEMPLATE_DIR, 'project')
  const templates = buildTemplates(user, project)
  await update($, templatesAtom, () => templates)

  return templates
}

// Called on every keystroke, so write (and redraw) only when empty <-> non-empty flips.
// A failure only costs the hint, so it never blocks the prompt
const setDraftEmpty = async ($: EngineInterface, isDraftEmpty: boolean) => {
  try {
    if ((await read($, isDraftEmptyAtom)) !== isDraftEmpty) {
      await update($, isDraftEmptyAtom, () => isDraftEmpty)
    }
  } catch {
    // Ignore
  }
}

// With no prompt box (headless and the like) text is '', which counts as empty
const syncDraftEmpty = async ($: EngineInterface) => {
  try {
    const { text } = await $.prompt.read()
    await setDraftEmpty($, text === '')
  } catch {
    // Ignore
  }
}

const pollDraftEmpty = async ($: EngineInterface) => {
  try {
    if (!(await read($, isDraftEmptyAtom))) {
      await syncDraftEmpty($)
    }
  } catch {
    // Ignore
  }
}

// Only fills the prompt; never submits
const insertTemplate = async ($: EngineInterface, template: Template) => {
  const filled = await $.prompt.fill({ text: template.body, mode: template.mode })
  if (filled.isFilled) {
    await setDraftEmpty($, filled.text === '')
  } else {
    $.ui.toast(`Could not insert the template: ${filled.refusal ?? 'unknown'}`)
  }

  return filled.isFilled
}

const openPicker = async ($: EngineInterface) => {
  await loadTemplates($)
  await $.ui.open({ id: PANE_ID, title: 'Prompt templates', focus: true, closeOnEscape: true })
}

const pickTemplate = async ($: EngineInterface, template: Template) => {
  await insertTemplate($, template)
  await $.ui.close({ id: PANE_ID })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'tpl',
      description: 'Insert a prompt template into the prompt (no argument opens the list)',
    })
    await $.command.register({ name: 'tpl-bar', description: 'Show or hide the template button row' })
    await $.command.register({ name: 'tpl-reload', description: 'Reload the prompt templates' })
    await loadTemplates($)
    await syncDraftEmpty($)
    $.clock.every(DRAFT_POLL_MS, () => {
      void pollDraftEmpty($)
    })

    return next(e)
  })

  // Keystrokes and pastes. The engine's result is returned untouched
  on('prompt.edit', async ($, e, next) => {
    const edited = await next(e)
    await setDraftEmpty($, edited.text === '')

    return edited
  })

  // A submit from the composer empties the prompt (a plugin's submit does not touch it)
  on('prompt.submit', async ($, e, next) => {
    if (e.origin.kind === 'composer') {
      await setDraftEmpty($, true)
    }

    return next(e)
  })

  // Slash commands skip prompt.submit, so re-read the prompt after one runs
  on('command.run', async ($, e, next) => {
    const result = await next(e)
    await syncDraftEmpty($)

    return result
  })

  // Lay the buttons out right above the prompt as "Templates: 1: review 2: explain ..."
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || (await read($, isHiddenAtom))) {
      return next(e)
    }

    const { Box, Button, Text } = $.ui.resolve(e)
    const templates = await read($, templatesAtom)

    if (templates.length === 0) {
      return (
        <Box paddingLeft={2}>
          <Text dimColor>Templates: {EMPTY_MESSAGE}</Text>
        </Box>
      )
    }

    const withHotkey = templates.filter(template => template.hotkey !== null)
    const hasMore = withHotkey.length < templates.length
    const isDraftEmpty = await read($, isDraftEmptyAtom)

    return (
      <Box paddingLeft={2} columnGap={2} flexWrap="wrap">
        <Text dimColor>Templates:</Text>
        {withHotkey.map(template => (
          <Button
            key={`tpl:${template.key}`}
            label={template.label}
            hotkey={template.hotkey ?? undefined}
            plain
            onPress={() => insertTemplate($, template)}
          />
        ))}
        {hasMore && <Button key="more" label="More…" hotkey="0" plain onPress={() => openPicker($)} />}
        {/* Clicks only reach a fullscreen terminal, so on the main screen show how to press for the current prompt */}
        {e.viewport?.isFullscreen === false && <Text dimColor>{toHint(isDraftEmpty)}</Text>}
      </Box>
    )
  })

  // The full list. Mobile cannot draw Select (its table names it, but the drawing drops it), so stack buttons there
  on('ui.render', { component: 'Pane', requestId: PANE_ID }, async ($, e) => {
    const table = $.ui.resolve(e)
    const { Box, Button, Text } = table
    const templates = await read($, templatesAtom)

    if (templates.length === 0) {
      return (
        <Box>
          <Text dimColor>{EMPTY_MESSAGE}</Text>
        </Box>
      )
    }

    if (e.surface === 'mobile' || !('Select' in table)) {
      return (
        <Box flexDirection="column">
          {templates.map(template => (
            <Button
              key={`pick:${template.key}`}
              label={toOptionLabel(template)}
              onPress={() => pickTemplate($, template)}
            />
          ))}
        </Box>
      )
    }

    const { Select } = table

    return (
      <Box flexDirection="column">
        <Select
          key="templates"
          autoFocus
          options={templates.map(template => ({ value: template.key, label: toOptionLabel(template) }))}
          onSelect={(value: string) => {
            const template = templates.find(one => one.key === value)
            if (template) {
              void pickTemplate($, template)
            }
          }}
        />
      </Box>
    )
  })

  on('command.run', { command: 'tpl' }, async ($, e) => {
    const name = e.args.trim()
    if (name === '') {
      await openPicker($)
      return { text: 'Opened the template list' }
    }

    const templates = await read($, templatesAtom)
    const template = findTemplate(templates, name)
    if (!template) {
      const keys = templates.map(one => one.key).join(', ')
      return { text: `Not found. Available: ${keys || 'none'}` }
    }

    await insertTemplate($, template)
    return { text: `Inserted ${template.label}` }
  })

  on('command.run', { command: 'tpl-bar' }, async $ => {
    await update($, isHiddenAtom, isHidden => !isHidden)
    const isHidden = await read($, isHiddenAtom)

    return { text: isHidden ? 'Hid the template buttons' : 'Showing the template buttons' }
  })

  on('command.run', { command: 'tpl-reload' }, async $ => {
    const templates = await loadTemplates($)

    return { text: `Loaded ${templates.length} template${templates.length === 1 ? '' : 's'}` }
  })
}
