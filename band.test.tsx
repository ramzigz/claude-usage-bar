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
      const ui = await $.ui.mount({ ...band(300), surface })
      const ctx = await ui.find({ type: 'Text', text: /context / })
      expect(ctx?.text).toBe(`${percent === 90 ? '⚠ ' : ''}context ${'▬'.repeat(24)} ${percent}% ${percent * 4}K/400K`)
      expect((await ui.find({ type: 'Text', text: new RegExp(`^ ${percent}%$`) }))?.props.color).toBe(color)
      expect(await ui.find({ key: 'compact' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /^│$/ })).toBeDefined()
      expect((await ui.find({ type: 'Box', key: '5h' }))?.text).toMatch(/^5h ▬+ 18% ↻ 2h 14m$/)
      expect((await ui.find({ type: 'Box', key: 'week' }))?.text).toMatch(/^week ▬+ 75% ↻ 3d 4h$/)
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
    expect((await ui.find({ type: 'Box', key: '5h' }))?.text).toMatch(/^⚠ 5h /)
    expect((await ui.find({ type: 'Text', text: /^ 95%$/ }))?.props.color).toBe('#ef4444')
    await ui.unmount()
  }
})

test('a narrow band swaps the bars for pies and keeps every window', async ($, on) => {
  mock.clock(on, { now: NOW })
  beneath(on)
  await measure($, 90)
  const terminal = await $.ui.mount({ ...band(55), surface: 'terminal' })
  expect((await terminal.find({ type: 'Text', text: /context / }))?.text).toBe('⚠ context ● 90%')
  expect((await terminal.find({ type: 'Box', key: '5h' }))?.text).toBe('5h ◔ 18%')
  expect((await terminal.find({ type: 'Box', key: 'week' }))?.text).toBe('week ◕ 75%')
  expect(await terminal.find({ key: 'compact' })).toBeDefined()
  await terminal.unmount()
  const desktop = await $.ui.mount({ ...band(54), surface: 'desktop' })
  expect((await desktop.findAll({ type: 'Svg' })).map(svg => svg.props.alt)).toEqual(['context 90%', '5h 18%', 'week 75%'])
  expect(await desktop.find({ type: 'Text', text: /^week/ })).toBeDefined()
  expect(await desktop.find({ type: 'Text', text: /▬/ })).toBeUndefined()
  expect(await desktop.find({ key: 'compact' })).toBeDefined()
  await desktop.unmount()
})

test('the smallest band drops week, then shortens context to ctx, then drops its label, keeping Compact and the 5h pie', async ($, on) => {
  mock.clock(on, { now: NOW })
  beneath(on)
  await measure($, 90)
  for (const [columns, context] of [[41, '⚠ context ● 90%'], [37, '⚠ ctx ● 90%'], [33, '⚠ ● 90%'], [10, '⚠ ● 90%']] as const) {
    const ui = await $.ui.mount({ ...band(columns), surface: 'terminal' })
    expect((await ui.find({ type: 'Box', key: 'ctx' }))?.text).toBe(`Compact${context}`)
    expect((await ui.find({ type: 'Box', key: '5h' }))?.text).toBe('5h ◔ 18%')
    expect(await ui.find({ type: 'Box', key: 'week' })).toBeUndefined()
    expect(await ui.find({ key: 'compact' })).toBeDefined()
    await ui.unmount()
  }
})

test('a mid-width band turns context into a pie first, keeping the 5h and week bars and resets', async ($, on) => {
  mock.clock(on, { now: NOW })
  beneath(on)
  await measure($, 90)
  const terminal = await $.ui.mount({ ...band(84), surface: 'terminal' })
  expect((await terminal.find({ type: 'Text', text: /context / }))?.text).toBe('⚠ context ● 90%')
  expect((await terminal.find({ type: 'Box', key: '5h' }))?.text).toMatch(/^5h ▬+ 18% ↻ 2h 14m$/)
  expect((await terminal.find({ type: 'Box', key: 'week' }))?.text).toMatch(/^week ▬+ 75% ↻ 3d 4h$/)
  await terminal.unmount()
})

test('a small band shows three pies, each with its reset', async ($, on) => {
  mock.clock(on, { now: NOW })
  beneath(on)
  await measure($, 90)
  const terminal = await $.ui.mount({ ...band(74), surface: 'terminal' })
  expect((await terminal.find({ type: 'Box', key: '5h' }))?.text).toBe('5h ◔ 18% ↻ 2h 14m')
  expect((await terminal.find({ type: 'Box', key: 'week' }))?.text).toBe('week ◕ 75% ↻ 3d 4h')
  expect((await terminal.findAll({ type: 'Text', text: /^│$/ })).length).toBe(2)
  await terminal.unmount()
  const desktop = await $.ui.mount({ ...band(75), surface: 'desktop' })
  expect((await desktop.findAll({ type: 'Svg' })).length).toBe(3)
  expect((await desktop.find({ type: 'Text', text: /3d 4h/ }))).toBeDefined()
  await desktop.unmount()
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
    const before = (await ui.find({ type: 'Box', key: '5h' }))?.text
    await clock.advance(60_000)
    expect(before).toMatch(new RegExp(`↻ 2h ${minutes}m$`))
    minutes -= 1
    expect((await ui.find({ type: 'Box', key: '5h' }))?.text).toMatch(new RegExp(`↻ 2h ${minutes}m$`))
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
    expect((await ui.find({ type: 'Box', key: '5h' }))?.text).toMatch(/^5h ▬+ 18% ↻ 2h 14m$/)
    expect((await ui.find({ type: 'Box', key: 'week' }))?.text).toMatch(/^week ▬+ 75% ↻ 3d 4h$/)
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
    expect(await ui.find({ type: 'Box', key: '5h' })).toBeUndefined()
    expect((await ui.find({ type: 'Box', key: 'week' }))?.text).toMatch(/^week ▬+ 75%/)
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

test('before the first response the ctx meter and Compact show the estimated fill', async ($, on) => {
  mock.clock(on, { now: NOW })
  beneath(on)
  on('session.usage', (_: unknown, e: any) => ({
    value: { rateLimits: RATE_LIMITS, context: { window: 1_000_000, ...(e.breakdown ? { breakdown: { totalTokens: 94_000 } } : {}) } },
  }) as any)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.session.measure({ context: { window: 1_000_000 }, rateLimits: RATE_LIMITS, changed: ['rateLimits'] } as any)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...band(200), surface })
    expect((await ui.find({ type: 'Text', text: /^context / }))?.text).toMatch(/^context ▬* 9% 94K\/1M$/)
    expect(await ui.find({ type: 'Button', label: 'Compact' })).toBeDefined()
    await ui.unmount()
  }
})

test('context is measured against the compaction window, as /context is', async ($, on) => {
  mock.clock(on, { now: NOW })
  beneath(on)
  on('session.usage', (_: unknown, e: any) => ({
    value: { rateLimits: RATE_LIMITS, context: { window: 1_000_000, ...(e.breakdown ? { breakdown: { totalTokens: 110_000, rawMaxTokens: 200_000 } } : {}) } },
  }) as any)
  await $.session.measure({ context: { tokens: 108_000, window: 1_000_000, percent: 11 }, rateLimits: RATE_LIMITS, changed: ['context'] })
  const ui = await $.ui.mount({ ...band(200), surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /^context / }))?.text).toMatch(/^context ▬* 54% 108K\/200K$/)
  await ui.unmount()
})

test('the band stays on one row at every width', async ($, on) => {
  mock.clock(on, { now: NOW })
  beneath(on)
  await measure($, 90)
  for (const surface of ['terminal', 'desktop'] as const) {
    for (let columns = 10; columns <= 200; columns += 5) {
      const ui = await $.ui.mount({ ...band(columns), surface })
      const boxes = await ui.findAll({ type: 'Box' })
      expect(boxes.map(box => box.props.flexWrap)).toEqual(boxes.map(() => 'nowrap'))
      const parts = (await ui.findAll({ type: 'Text' })).filter(text => text.props.wrap)
      expect(parts.length).toBeGreaterThan(0)
      expect(parts.map(text => text.props.wrap)).toEqual(parts.map(() => 'truncate-end'))
      await ui.unmount()
    }
  }
})

test('each section spreads its parts over its share of the row, context taking only what it needs', async ($, on) => {
  mock.clock(on, { now: NOW })
  beneath(on)
  await measure($, 30)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...band(200), surface })
    expect((await ui.find({ type: 'Box', key: 'ctx' }))?.props.flexGrow).toBe(0)
    for (const key of ['5h', 'week']) {
      const section = await ui.find({ type: 'Box', key })
      expect(section?.props).toMatchObject({ flexGrow: 1, justifyContent: 'space-between' })
    }
    expect(await ui.find({ type: 'Text', text: /^5h $/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^ ↻ 2h 14m$/ })).toBeDefined()
    await ui.unmount()
  }
})

const usageText = (session: number, week: number) =>
  `Current session: ${session}% used · resets Nov 9, 12:14pm (UTC)\nCurrent week (all models): ${week}% used · resets Nov 12, 2pm (UTC)\n`

test('an interactive session reads /usage at start and every 2 minutes', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  beneath(on)
  const runs: (readonly string[])[] = []
  let text = usageText(22, 76)
  on('process.run', (_, e) => { runs.push(e.argv); return { value: { exitCode: 0, stdout: text, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } } })
  on('session.usage', () => ({ value: { rateLimits: RATE_LIMITS, context: { tokens: 40_000, window: 400_000, percent: 10 } } }) as any)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.advance(0)
  const ui = await $.ui.mount({ ...band(200), surface: 'terminal' })
  expect((await ui.find({ type: 'Box', key: '5h' }))?.text).toMatch(/ 22% ↻ 2h 14m$/)
  expect((await ui.find({ type: 'Box', key: 'week' }))?.text).toMatch(/ 76% ↻ 3d 4h$/)
  text = usageText(30, 77)
  await clock.advance(120_000)
  expect((await ui.find({ type: 'Box', key: '5h' }))?.text).toMatch(/ 30% ↻ 2h 12m$/)
  expect(runs[0]).toEqual(['claude', '-p', '/usage', '--no-session-persistence'])
  expect(runs.length).toBe(2)
  await ui.unmount()
})

test('a non-interactive session never runs /usage', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  beneath(on)
  let runs = 0
  on('process.run', () => { runs += 1; return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } } })
  on('session.usage', () => ({ value: { rateLimits: RATE_LIMITS, context: { tokens: 40_000, window: 400_000, percent: 10 } } }) as any)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: false })
  await clock.advance(240_000)
  expect(runs).toBe(0)
})
