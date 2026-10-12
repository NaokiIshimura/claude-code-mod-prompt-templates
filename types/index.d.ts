export type TemplateMode = 'insert' | 'replace' | 'append'

export type TemplateSource = 'user' | 'project'

export type Template = {
  key: string
  label: string
  mode: TemplateMode
  order: number | null
  body: string
  source: TemplateSource
  hotkey: string | null
}

declare module 'claude-code' {
  interface PluginState {
    'prompt-templates': { templates: Template[]; isHidden: boolean; isDraftEmpty: boolean }
  }
}
