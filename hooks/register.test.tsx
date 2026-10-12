import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine, Mounted } from 'claude-code/testing'
import type { FsEntry, On, PaneOpenArgs, PromptEditInput, PromptFillInput } from 'claude-code'

const PLUGIN = 'prompt-templates'

const HOME = '/home/user'

const USER_DIR = `${HOME}/.claude/prompt-templates`

const PROJECT_DIR = '.claude/prompt-templates'

const BAND = {
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 120,
    scroll: { offset: 0, bodyRows: 9 },
    view: {},
  },
} as const

const PANE = {
  component: 'Pane',
  requestId: 'prompt-templates',
  props: {
    title: 'Prompt templates',
    isFocused: true,
    bodyColumns: 80,
    placement: 'inline',
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
} as const

// Run a command the way a person typing it into the prompt would
const run = async ($: Engine, command: string, args = '') =>
  (
    await $.command.run({
      command,
      args,
      origin: { kind: 'composer' },
      presentation: { isFullscreen: false, columns: 120 },
    })
  ).text

type Files = Readonly<Record<string, Readonly<Record<string, string>>>>

// A path relative to the working directory reaches the hooks as an absolute path
const toKey = (path: string) => (path.endsWith(`/${PROJECT_DIR}`) && !path.startsWith(HOME) ? PROJECT_DIR : path)

const entry = (name: string, kind: FsEntry['kind'] = 'file'): FsEntry => ({
  name,
  kind,
  size: 0,
  mtimeMs: 0,
  isLink: false,
})

// Engine operations (fs, ui and so on) are answered with { value }
const answer = <T,>(value: T) => ({ value })

type Options = Readonly<{
  // Paths of files whose read fails
  unreadable?: readonly string[]
  // Why the prompt refuses an insertion
  refusal?: 'dialog'
}>

// Answer fs, env, the prompt and panes in place of the engine, recording what was called
const setup = (on: On, files: Files, options: Options = {}) => {
  const fills: PromptFillInput[] = []
  const opened: PaneOpenArgs[] = []
  const closed: string[] = []
  const toasts: string[] = []
  // The prompt draft. The text in a fill result reaches the plugin through prompt.read
  let draft = ''

  mock.env(on, { HOME })
  on('fs.list', (_$, e) => {
    const dir = files[toKey(e.path)]
    if (dir === undefined) {
      throw new Error(`no such directory: ${e.path}`)
    }
    return answer([...Object.keys(dir).map(name => entry(name)), entry('sub', 'dir'), entry('memo.txt')])
  })
  on('fs.read', (_$, e) => {
    const at = e.path.lastIndexOf('/')
    const text = files[toKey(e.path.slice(0, at))]?.[e.path.slice(at + 1)]
    if (text === undefined || options.unreadable?.includes(e.path)) {
      throw new Error(`cannot read: ${e.path}`)
    }
    return answer(text)
  })
  on('prompt.fill', (_$, e) => {
    fills.push(e)
    if (options.refusal) {
      return { isFilled: false, refusal: options.refusal, text: draft }
    }
    draft = e.mode === 'replace' ? e.text : draft + e.text
    return { isFilled: true, text: draft }
  })
  on('prompt.read', () => answer({ text: draft, cursor: draft.length }))
  on('ui.toast', (_$, e) => {
    toasts.push(e.text)
    return answer(undefined)
  })
  on('ui.open', (_$, e) => {
    opened.push(e)
    return answer({ isPlaced: true } as const)
  })
  on('ui.close', (_$, e) => {
    closed.push(e.id)
    return answer(undefined)
  })
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box key="engine" />
  })

  // Change the prompt without a prompt.edit, as ctrl+c does
  const setDraft = (text: string) => {
    draft = text
  }

  return { fills, opened, closed, toasts, setDraft }
}

const FILES: Files = {
  [USER_DIR]: {
    'review.md': '---\nlabel: Code Review\nmode: replace\norder: 1\n---\nReview this\n',
    'explain.md': 'Explain this\n',
  },
  [PROJECT_DIR]: {
    'explain.md': '---\nlabel: explain\n---\nExplain this project\n',
  },
}

const manyFiles = (count: number): Files => ({
  [USER_DIR]: Object.fromEntries(
    Array.from({ length: count }, (_, index) => [`t${String(index).padStart(2, '0')}.md`, `body ${index}`]),
  ),
})

describe('loading and the button row', () => {
  test('loads both folders, lays out buttons and inserts on press', async ($, on) => {
    const { fills } = setup(on, FILES)
    expect(await run($, 'tpl-reload')).toBe('Loaded 2 templates')

    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ plugin: PLUGIN, surface, ...BAND })
      const buttons = await ui.findAll({ type: 'Button' })
      expect(buttons.map(button => button.key)).toEqual(['tpl:review', 'tpl:explain'])

      await ui.press({ key: 'tpl:review' })
      expect(fills.at(-1)).toMatchObject({ text: 'Review this', mode: 'replace' })

      await ui.press({ key: 'tpl:explain' })
      expect(fills.at(-1)).toMatchObject({ text: 'Explain this project', mode: 'insert' })

      await ui.unmount()
    }
  })

  test('shows where to put templates when no folder exists', async ($, on) => {
    setup(on, {})
    await run($, 'tpl-reload')

    const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
    expect(await ui.findAll({ type: 'Button' })).toHaveLength(0)
    expect(await ui.find({ type: 'Text', text: /Put templates in/ })).toBeDefined()
    await ui.unmount()
  })

  test('skips files that cannot be read', async ($, on) => {
    setup(on, FILES, { unreadable: [`${USER_DIR}/review.md`] })

    expect(await run($, 'tpl-reload')).toBe('Loaded 1 template')
  })

  test('shows 0: More… with 10 or more templates and opens the list', async ($, on) => {
    const { opened } = setup(on, manyFiles(10))
    await run($, 'tpl-reload')

    const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
    expect(await ui.findAll({ type: 'Button' })).toHaveLength(10)
    await ui.press({ key: 'more' })
    expect(opened.at(-1)).toMatchObject({ id: 'prompt-templates', focus: true, closeOnEscape: true })
    await ui.unmount()
  })

  test('/tpl-bar hides the row and shows it again', async ($, on) => {
    setup(on, FILES)
    await run($, 'tpl-reload')

    const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
    expect(await run($, 'tpl-bar')).toBe('Hid the template buttons')
    expect(await ui.find({ key: 'engine' })).toBeDefined()

    expect(await run($, 'tpl-bar')).toBe('Showing the template buttons')
    expect(await ui.find({ key: 'tpl:review' })).toBeDefined()
    await ui.unmount()
  })

  test('yields to the engine while a survey shows', async ($, on) => {
    setup(on, FILES)
    await run($, 'tpl-reload')

    const ui = await $.ui.mount({
      plugin: PLUGIN,
      surface: 'terminal',
      ...BAND,
      props: { ...BAND.props, hasSurvey: true },
    })
    expect(await ui.findAll({ type: 'Button' })).toHaveLength(0)
    expect(await ui.find({ key: 'engine' })).toBeDefined()
    await ui.unmount()
  })

  test('shows a toast when the insertion is refused', async ($, on) => {
    const { toasts } = setup(on, FILES, { refusal: 'dialog' })
    await run($, 'tpl-reload')

    const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
    await ui.press({ key: 'tpl:review' })
    // A hook's refusal carries no reason (engine behaviour), so it reads unknown
    expect(toasts).toEqual(['Could not insert the template: unknown'])
    await ui.unmount()
  })
})

describe('the list pane', () => {
  test('inserts the pick and closes the pane', async ($, on) => {
    const { fills, closed } = setup(on, FILES)
    await run($, 'tpl-reload')

    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ plugin: PLUGIN, surface, ...PANE })
      await ui.select({ key: 'templates', value: 'explain' })
      expect(fills.at(-1)).toMatchObject({ text: 'Explain this project' })
      expect(closed.at(-1)).toBe('prompt-templates')
      await ui.unmount()
    }
  })

  test('picks with buttons on mobile, which has no Select', async ($, on) => {
    const { fills, closed } = setup(on, FILES)
    await run($, 'tpl-reload')

    const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'mobile', ...PANE })
    await ui.press({ key: 'pick:review' })
    expect(fills.at(-1)).toMatchObject({ text: 'Review this' })
    expect(closed.at(-1)).toBe('prompt-templates')
    await ui.unmount()
  })

  test('shows where to put templates when there are none', async ($, on) => {
    setup(on, {})
    await run($, 'tpl-reload')

    const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE })
    expect(await ui.find({ type: 'Text', text: /Put templates in/ })).toBeDefined()
    await ui.unmount()
  })
})

describe('/tpl', () => {
  test('inserts by name and lists the candidates when nothing matches', async ($, on) => {
    const { fills } = setup(on, FILES)
    await run($, 'tpl-reload')

    expect(await run($, 'tpl', 'code review')).toBe('Inserted Code Review')
    expect(fills.at(-1)).toMatchObject({ text: 'Review this', mode: 'replace' })

    expect(await run($, 'tpl', 'none')).toBe(
      'Not found. Available: review, explain',
    )
  })

  test('opens the list without an argument', async ($, on) => {
    const { opened } = setup(on, FILES)

    expect(await run($, 'tpl')).toBe('Opened the template list')
    expect(opened.at(-1)).toMatchObject({ id: 'prompt-templates' })
  })

  test('lists no candidates when there are no templates', async ($, on) => {
    setup(on, {})
    await run($, 'tpl-reload')

    expect(await run($, 'tpl', 'x')).toBe('Not found. Available: none')
  })
})

describe('spacing and hints', () => {
  const MAIN_SCREEN = { columns: 160, rows: 40, isFullscreen: false }

  // Apply a prompt edit in place of the engine
  const applyEdit = (e: PromptEditInput) => {
    const text = e.text.slice(0, e.start) + e.inputText + e.text.slice(e.end)
    return { text, cursor: e.start + e.inputText.length }
  }

  const edit = (text: string, start: number, end: number, inputText: string): PromptEditInput => ({
    origin: { kind: 'composer' },
    text,
    cursor: end,
    start,
    end,
    inputText,
  })

  // Raise the prompt.edit a person's editing raises (the test Engine type lacks edit, but it runs)
  const typeInto = ($: Engine, e: PromptEditInput) =>
    ($.prompt as unknown as { edit: (e: PromptEditInput) => Promise<unknown> }).edit(e)

  const hintOf = async (ui: Mounted<'terminal', 'AbovePrompt'>) =>
    (await ui.find({ type: 'Text', text: /^\(/ }))?.text

  test('pads 2 on the left and 2 between buttons', async ($, on) => {
    setup(on, FILES)
    await run($, 'tpl-reload')

    const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND, viewport: MAIN_SCREEN })
    expect(await ui.drawn()).toMatchObject({ type: 'Box', props: { paddingLeft: 2, columnGap: 2 } })
    await ui.unmount()
  })

  test('switches the hint with the prompt state', async ($, on) => {
    setup(on, FILES)
    on('prompt.edit', (_$, e) => applyEdit(e))
    await run($, 'tpl-reload')

    const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND, viewport: MAIN_SCREEN })
    expect(await hintOf(ui)).toBe('(press a number on an empty prompt)')

    await typeInto($, edit('', 0, 0, 'a'))
    expect(await hintOf(ui)).toBe('(focus buttons: ctrl + x > tab)')

    await typeInto($, edit('a', 0, 1, ''))
    expect(await hintOf(ui)).toBe('(press a number on an empty prompt)')

    await ui.press({ key: 'tpl:explain' })
    expect(await hintOf(ui)).toBe('(focus buttons: ctrl + x > tab)')

    await ui.unmount()
  })

  test('resets on a person\'s submit but not on a plugin\'s', async ($, on) => {
    setup(on, FILES)
    on('prompt.edit', (_$, e) => applyEdit(e))
    on('prompt.submit', (_$, e) => ({ text: e.text }))
    await run($, 'tpl-reload')

    const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND, viewport: MAIN_SCREEN })
    await typeInto($, edit('', 0, 0, 'hello'))

    await $.prompt.submit({ text: 'other', wait: false, origin: { kind: 'plugin', name: 'other' } })
    expect(await hintOf(ui)).toBe('(focus buttons: ctrl + x > tab)')

    await $.prompt.submit({ text: 'hello', wait: false, origin: { kind: 'composer' } })
    expect(await hintOf(ui)).toBe('(press a number on an empty prompt)')

    await ui.unmount()
  })

  test('re-reads the prompt and restores the hint when it is cleared without a prompt.edit', async ($, on) => {
    const { setDraft } = setup(on, FILES)
    const clock = mock.clock(on)
    on('prompt.edit', (_$, e) => applyEdit(e))
    on('command.register', (_$, e) => answer({ command: e.name }))
    on('session.start', (_$, e) => ({ cwd: e.cwd }))
    await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })

    const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND, viewport: MAIN_SCREEN })
    await typeInto($, edit('', 0, 0, 'abc'))
    setDraft('abc')
    await clock.advance(300)
    expect(await hintOf(ui)).toBe('(focus buttons: ctrl + x > tab)')

    setDraft('')
    await clock.advance(300)
    expect(await hintOf(ui)).toBe('(press a number on an empty prompt)')

    await ui.unmount()
  })

  test('shows no hint in fullscreen', async ($, on) => {
    setup(on, FILES)
    await run($, 'tpl-reload')

    const ui = await $.ui.mount({
      plugin: PLUGIN,
      surface: 'terminal',
      ...BAND,
      viewport: { ...MAIN_SCREEN, isFullscreen: true },
    })
    expect(await hintOf(ui)).toBeUndefined()
    await ui.unmount()
  })
})
