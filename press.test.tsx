import { expect, mock, test } from 'claude-code/testing'

const BAND = { plugin: 'usage-bar', component: 'AbovePrompt', props: { hasSurvey: false, bodyColumns: 200 } as any } as const

for (const [label, answers, toast] of [
  ['runs /compact with no toast', true, undefined],
  ['shows the real error', false, 'Compact failed: no implementation for command.run'],
] as const) {
  test(`pressing Compact ${label}`, async ($, on) => {
    const toasts: string[] = []
    const commands: string[] = []
    on('ui.toast', (_, e) => { toasts.push(e.text); return { value: undefined } })
    mock.clock(on, { now: 0 })
    on('session.measure', (_, e) => ({ changed: e.changed }))
    if (answers) on('command.run', (_, e) => { commands.push(e.command); return { text: '' } })
    await $.session.measure({
      context: { tokens: 350_000, window: 400_000, percent: 70 },
      rateLimits: [{ kind: 'five_hour', percentUsed: 18 }],
      changed: [],
    })
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ ...BAND, surface })
      await $.ui.press({ plugin: 'usage-bar', key: 'compact', surface })
      await ui.unmount()
    }
    expect(commands).toEqual(answers ? ['compact', 'compact'] : [])
    expect(toasts).toEqual(toast ? [toast, toast] : [])
  })
}
