import { test, expect } from 'claude-code/testing'
import {
  barParts, contextPercent, fitLayout, LAYOUTS, levelOf, limitsFrom, thousands, thresholdsFrom, untilLabel,
} from './hooks/register'
import type { Meter } from './hooks/register'

test('fills the bar in proportion to the percentage', () => {
  expect(barParts(0)).toEqual({ filled: '', empty: '▬▬▬▬▬▬' })
  expect(barParts(42)).toEqual({ filled: '▬▬▬', empty: '▬▬▬' })
  expect(barParts(150).filled).toBe('▬▬▬▬▬▬')
})

test('reads the 5h and weekly windows and ignores others', () => {
  expect(limitsFrom([
    { kind: 'seven_day', percentUsed: 31 },
    { kind: 'five_hour', percentUsed: 18 },
    { kind: 'spend_limit', percentUsed: 5 },
  ])).toMatchObject({ fiveHour: 18, sevenDay: 31 })
  expect(limitsFrom([]).fiveHour).toBeUndefined()
})

test('rates a percent against the warn and alert marks', () => {
  const marks = { warn: 50, alert: 80 }
  expect(levelOf(49.9, marks)).toBe('ok')
  expect(levelOf(50, marks)).toBe('warn')
  expect(levelOf(79.9, marks)).toBe('warn')
  expect(levelOf(80, marks)).toBe('over')
})

test('reads the thresholds from the options, defaults for the rest', () => {
  expect(thresholdsFrom({})).toEqual({ context: { warn: 50, alert: 80 }, limit: { warn: 70, alert: 90 } })
  expect(thresholdsFrom({ contextWarnPercent: 30, limitAlertPercent: '95', contextAlertPercent: '' })).toEqual({
    context: { warn: 30, alert: 80 }, limit: { warn: 70, alert: 95 },
  })
})

test('uses the engine percent, else tokens over the window', () => {
  expect(contextPercent({ tokens: 100_000, window: 200_000, percent: 51 })).toBe(51)
  expect(contextPercent({ tokens: 100_000, window: 200_000 })).toBe(50)
  expect(contextPercent({ tokens: 100_000 })).toBeUndefined()
  expect(contextPercent({})).toBeUndefined()
})

test('writes token counts as K or M', () => {
  expect(thousands(152_400)).toBe('152K')
  expect(thousands(1_000_000)).toBe('1M')
  expect(thousands(1_250_000)).toBe('1.3M')
})

test('counts down to the reset in minutes, hours or days', () => {
  const now = Date.parse('2026-11-09T10:00:00Z')
  expect(untilLabel('2026-11-09T12:14:00Z', now)).toBe('↻ 2h 14m')
  expect(untilLabel('2026-11-12T14:00:00Z', now)).toBe('↻ 3d 4h')
  expect(untilLabel('2026-11-09T10:00:30Z', now)).toBe('↻ 1m')
  expect(untilLabel('2026-11-09T09:00:00Z', now)).toBe('↻ 0m')
  expect(untilLabel(undefined, now)).toBe('')
  expect(untilLabel('not a date', now)).toBe('')
})

test('drops resets, then token counts, then the week bar as the band narrows', () => {
  const meters: Meter[] = [
    { key: 'ctx', label: 'ctx', percent: 90, level: 'over', detail: '360K/400K' },
    { key: '5h', label: '5h', percent: 18, level: 'ok', reset: '↻ 2h 14m' },
    { key: 'week', label: 'week', percent: 31, level: 'ok', reset: '↻ 3d 4h' },
  ]
  expect(fitLayout(meters, true, undefined)).toBe(LAYOUTS[0])
  expect(fitLayout(meters, true, 100)).toBe(LAYOUTS[0])
  expect(fitLayout(meters, true, 90)).toBe(LAYOUTS[0])
  expect(fitLayout(meters, true, 80)).toBe(LAYOUTS[1])
  expect(fitLayout(meters, true, 65)).toBe(LAYOUTS[2])
  expect(fitLayout(meters, true, 50)).toBe(LAYOUTS[3])
  expect(fitLayout(meters, true, 20)).toBe(LAYOUTS[3])
})
