import { expect, mock, test } from 'claude-code/testing'

const NOW = Date.parse('2026-11-09T10:00:00Z')
const RATE_LIMITS = [
  { kind: 'five_hour', percentUsed: 18, resetsAt: '2026-11-09T12:14:00Z' },
  { kind: 'seven_day', percentUsed: 75, resetsAt: '2026-11-12T14:00:00Z' },
]
const band = (bodyColumns: number) =>
  ({ plugin: 'usage-bar', component: 'AbovePrompt', props: { hasSurvey: false, bodyColumns } as any }) as const

const beneath = (on: any) => {
  on('session.measure', (_: unknown, e: any) => ({ changed: e.changed }))
  on('session.start', (_: unknown, e: any) => ({ cwd: e.cwd }))
  on('ui.toast', () => ({ value: undefined }))
}

const measure = ($: any, percent: number, rateLimits = RATE_LIMITS) =>
  $.session.measure({ context: { tokens: percent * 4000, window: 400_000, percent }, rateLimits, changed: [] })

for (const [percent, color] of [[30, undefined], [60, '#f97316'], [90, '#ef4444']] as const) {
  test(`ctx at ${percent}%: percent ${color ?? 'plain'}, Compact shown`, async ($, on) => {
    mock.clock(on, { now: NOW })
    beneath(on)
    await measure($, percent)
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ ...band(200), surface })
      const ctx = await ui.find({ type: 'Text', text: /ctx / })
      expect(ctx?.text).toBe(`${percent === 90 ? '⚠ ' : ''}ctx ${'▬'.repeat(6)} ${percent}% ${percent * 4}K/400K`)
      expect((await ui.find({ type: 'Text', text: new RegExp(`^ ${percent}%$`) }))?.props.color).toBe(color)
      expect(await ui.find({ key: 'compact' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /^│$/ })).toBeDefined()
      expect((await ui.find({ type: 'Text', text: /^(⚠ )?5h / }))?.text).toMatch(/^5h ▬+ 18% ↻ 2h 14m$/)
      expect((await ui.find({ type: 'Text', text: /^week / }))?.text).toMatch(/^week ▬+ 75% ↻ 3d 4h$/)
      expect((await ui.find({ type: 'Text', text: /^ 75%$/ }))?.props.color).toBe('#f97316')
      await ui.unmount()
    }
  })
}

test('a limit past its alert mark is red with ⚠', async ($, on) => {
  mock.clock(on, { now: NOW })
  beneath(on)
  await measure($, 10, [{ kind: 'five_hour', percentUsed: 95, resetsAt: '2026-11-09T12:14:00Z' }])
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...band(200), surface })
    expect((await ui.find({ type: 'Text', text: /^(⚠ )?5h / }))?.text).toMatch(/^⚠ 5h /)
    expect((await ui.find({ type: 'Text', text: /^ 95%$/ }))?.props.color).toBe('#ef4444')
    await ui.unmount()
  }
})

test('a narrow band keeps the bars and drops the rest', async ($, on) => {
  mock.clock(on, { now: NOW })
  beneath(on)
  await measure($, 90)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...band(50), surface })
    expect((await ui.find({ type: 'Text', text: /ctx / }))?.text).toBe(`⚠ ctx ${'▬'.repeat(6)} 90%`)
    expect((await ui.find({ type: 'Text', text: /^(⚠ )?5h / }))?.text).toMatch(/^5h ▬+ 18%$/)
    expect(await ui.find({ type: 'Text', text: /^week / })).toBeUndefined()
    expect(await ui.find({ key: 'compact' })).toBeDefined()
    await ui.unmount()
  }
})

test('the thresholds come from the options', { options: { contextWarnPercent: 20 } }, async ($, on) => {
  mock.clock(on, { now: NOW })
  beneath(on)
  await measure($, 30)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...band(200), surface })
    expect((await ui.find({ type: 'Text', text: /^ 30%$/ }))?.props.color).toBe('#f97316')
    expect(await ui.find({ key: 'compact' })).toBeDefined()
    await ui.unmount()
  }
})

test('the countdown moves on every minute', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  beneath(on)
  on('session.usage', () => ({ value: { rateLimits: RATE_LIMITS, context: { tokens: 40_000, window: 400_000, percent: 10 } } }) as any)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  let minutes = 14
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...band(200), surface })
    const before = (await ui.find({ type: 'Text', text: /^5h / }))?.text
    await clock.advance(60_000)
    expect(before).toMatch(new RegExp(`↻ 2h ${minutes}m$`))
    minutes -= 1
    expect((await ui.find({ type: 'Text', text: /^5h / }))?.text).toMatch(new RegExp(`↻ 2h ${minutes}m$`))
    await ui.unmount()
  }
})

test('the context toast shows once each time it crosses the alert mark', async ($, on) => {
  const toasts: string[] = []
  on('session.measure', (_, e) => ({ changed: e.changed }))
  on('ui.toast', (_, e) => { toasts.push(e.text); return { value: undefined } })
  for (const percent of [85, 88, 40, 82]) await measure($, percent)
  expect(toasts).toEqual([
    'Context is 85% full: press Compact above the prompt',
    'Context is 82% full: press Compact above the prompt',
  ])
})

const resume = ($: any, on: any) => {
  on('session.usage', () => ({ value: { rateLimits: [], context: { tokens: 94_000, window: 1_000_000, percent: 9 } } }) as any)
  return $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
}

test('a resumed session shows the last known limits before its first response', async ($, on) => {
  mock.clock(on, { now: NOW })
  beneath(on)
  mock.store(on, { limits: { fiveHour: 18, sevenDay: 75, fiveHourResetsAt: '2026-11-09T12:14:00Z', sevenDayResetsAt: '2026-11-12T14:00:00Z' } })
  await resume($, on)
  await measure($, 9, [])
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...band(200), surface })
    expect((await ui.find({ type: 'Text', text: /^5h / }))?.text).toMatch(/^5h ▬+ 18% ↻ 2h 14m$/)
    expect((await ui.find({ type: 'Text', text: /^week / }))?.text).toMatch(/^week ▬+ 75% ↻ 3d 4h$/)
    await ui.unmount()
  }
})

test('a stored window whose reset has passed is not shown', async ($, on) => {
  mock.clock(on, { now: NOW })
  beneath(on)
  mock.store(on, { limits: { fiveHour: 18, sevenDay: 75, fiveHourResetsAt: '2026-11-09T09:00:00Z', sevenDayResetsAt: '2026-11-12T14:00:00Z' } })
  await resume($, on)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...band(200), surface })
    expect(await ui.find({ type: 'Text', text: /^5h / })).toBeUndefined()
    expect((await ui.find({ type: 'Text', text: /^week / }))?.text).toMatch(/^week ▬+ 75%/)
    await ui.unmount()
  }
})

test('a measurement with limits is stored for the next session', async ($, on) => {
  mock.clock(on, { now: NOW })
  beneath(on)
  const saved: Record<string, unknown> = {}
  on('store.set', (_: unknown, e: any) => { saved[e.key] = e.value; return { value: undefined } })
  await measure($, 10)
  await measure($, 10, [])
  expect(saved.limits).toMatchObject({ fiveHour: 18, sevenDay: 75 })
})
