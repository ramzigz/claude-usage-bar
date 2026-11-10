import { atom, read, update } from 'claude-code'
import type { PluginOptions, Register, SessionContextUsage, SessionUsage, SessionUsageArgs } from 'claude-code'

import type { Context, Limits, Tick } from '../types'

const BAR_WIDTH = 6
const GAP = 1
const MINUTE = 60_000
const LEVEL_COLORS = { ok: '#22c55e', warn: '#f97316', over: '#ef4444' } as const

const limits = atom({ plugin: 'usage-bar', key: 'limits' } as const, {} as Limits)
const context = atom({ plugin: 'usage-bar', key: 'context' } as const, {} as Context)
const tick = atom({ plugin: 'usage-bar', key: 'tick' } as const, {} as Tick)

export type Level = keyof typeof LEVEL_COLORS
export type Thresholds = { warn: number; alert: number }

export const levelOf = (percent: number, { warn, alert }: Thresholds): Level =>
  percent >= alert ? 'over' : percent >= warn ? 'warn' : 'ok'

const percentOption = (options: PluginOptions, key: string, fallback: number) => {
  const value = Number(options[key])
  return Number.isFinite(value) && options[key] !== '' ? value : fallback
}

export const thresholdsFrom = (options: PluginOptions) => ({
  context: { warn: percentOption(options, 'contextWarnPercent', 50), alert: percentOption(options, 'contextAlertPercent', 80) },
  limit: { warn: percentOption(options, 'limitWarnPercent', 70), alert: percentOption(options, 'limitAlertPercent', 90) },
})

export const thousands = (tokens: number) =>
  tokens >= 1_000_000 ? `${Number((tokens / 1_000_000).toFixed(1))}M` : `${Math.round(tokens / 1000)}K`

export const barParts = (percent: number) => {
  const filled = Math.round((Math.min(Math.max(percent, 0), 100) / 100) * BAR_WIDTH)
  return { filled: '▬'.repeat(filled), empty: '▬'.repeat(BAR_WIDTH - filled) }
}

export const contextPercent = ({ tokens, window, percent }: Context) =>
  percent ?? (tokens !== undefined && window ? (tokens / window) * 100 : undefined)

type RateLimit = { kind: string; percentUsed: number; resetsAt?: string }

export const limitsFrom = (rateLimits: RateLimit[]): Limits => {
  const fiveHour = rateLimits.find(limit => limit.kind === 'five_hour')
  const sevenDay = rateLimits.find(limit => limit.kind === 'seven_day')
  return {
    fiveHour: fiveHour?.percentUsed,
    sevenDay: sevenDay?.percentUsed,
    fiveHourResetsAt: fiveHour?.resetsAt,
    sevenDayResetsAt: sevenDay?.resetsAt,
  }
}

type UsageReader = { session: { usage: (args?: SessionUsageArgs) => Promise<SessionUsage> } }

const contextFrom = async ($: UsageReader, live: SessionContextUsage): Promise<Context> => {
  if (live.tokens !== undefined || live.percent !== undefined) return { tokens: live.tokens, window: live.window, percent: live.percent }
  const estimate = await $.session.usage({ breakdown: 'summary' }).then(usage => usage.context.breakdown?.totalTokens, () => undefined)
  return { tokens: estimate, window: live.window }
}

const isPast = (isoTime: string | undefined, now: number) => isoTime !== undefined && Date.parse(isoTime) <= now

export const freshLimits = (stored: unknown, now: number): Limits => {
  const limits = (stored && typeof stored === 'object' ? stored : {}) as Limits
  const fiveHourGone = isPast(limits.fiveHourResetsAt, now)
  const sevenDayGone = isPast(limits.sevenDayResetsAt, now)
  return {
    fiveHour: fiveHourGone ? undefined : limits.fiveHour,
    sevenDay: sevenDayGone ? undefined : limits.sevenDay,
    fiveHourResetsAt: fiveHourGone ? undefined : limits.fiveHourResetsAt,
    sevenDayResetsAt: sevenDayGone ? undefined : limits.sevenDayResetsAt,
  }
}

export const untilLabel = (isoTime: string | undefined, now: number) => {
  const at = isoTime ? Date.parse(isoTime) : NaN
  if (Number.isNaN(at)) return ''
  const minutes = Math.max(0, Math.ceil((at - now) / MINUTE))
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)
  return `↻ ${days ? `${days}d ${hours}h` : hours ? `${hours}h ${minutes % 60}m` : `${minutes}m`}`
}

export type Meter = { key: string; label: string; percent: number; level: Level; detail?: string; reset?: string }
export type Show = { detail: boolean; reset: boolean; week: boolean }
type Span = { text: string; color?: string; dim?: boolean; bold?: boolean }

const NARROWEST: Show = { detail: false, reset: false, week: false }
export const LAYOUTS: Show[] = [
  { detail: true, reset: true, week: true },
  { detail: true, reset: false, week: true },
  { detail: false, reset: false, week: true },
  NARROWEST,
]

export const meterSpans = (meter: Meter, show: Show): Span[] => {
  const { filled, empty } = barParts(meter.percent)
  const color = LEVEL_COLORS[meter.level]
  const over = meter.level === 'over'
  return [
    ...(over ? [{ text: '⚠ ', color, bold: true }] : []),
    { text: `${meter.label} `, dim: true },
    { text: filled, color },
    { text: empty, dim: true },
    { text: ` ${Math.round(meter.percent)}%`, color: meter.level === 'ok' ? undefined : color, bold: over },
    ...(show.detail && meter.detail ? [{ text: ` ${meter.detail}`, dim: true }] : []),
    ...(show.reset && meter.reset ? [{ text: ` ${meter.reset}`, dim: true }] : []),
  ]
}

const COMPACT_LABEL = 'Compact'
const COMPACT_WIDTH = COMPACT_LABEL.length + 5
const SEPARATOR = '│'

export const visibleMeters = (meters: Meter[], show: Show) => meters.filter(meter => show.week || meter.key !== 'week')

export const bandWidth = (meters: Meter[], show: Show, hasCompact: boolean) => {
  const shown = visibleMeters(meters, show)
  const text = shown.reduce((sum, meter) => sum + meterSpans(meter, show).reduce((n, span) => n + span.text.length, 0), 0)
  const separator = shown[0]?.key === 'ctx' && shown.length > 1 ? SEPARATOR.length + GAP : 0
  return text + GAP * Math.max(shown.length - 1, 0) + separator + (hasCompact ? COMPACT_WIDTH : 0)
}

export const fitLayout = (meters: Meter[], hasCompact: boolean, columns: number | undefined) =>
  LAYOUTS.find(show => !columns || bandWidth(meters, show, hasCompact) <= columns) ?? NARROWEST

export const register: Register = (on, options) => {
  const thresholds = thresholdsFrom(options)
  let warnedOver = false

  on('session.start', async ($, e, next) => {
    const usage = await $.session.usage()
    const known = usage.rateLimits.length ? limitsFrom(usage.rateLimits) : freshLimits(await $.store.get('limits').catch(() => undefined), await $.clock.now())
    await update($, limits, () => known)
    const started = await contextFrom($, usage.context)
    await update($, context, () => started)
    const stamp = async () => { const now = await $.clock.now(); await update($, tick, () => ({ now })) }
    await stamp()
    $.clock.every(MINUTE, () => { void stamp() })
    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    if (e.rateLimits.length) {
      const measured = limitsFrom(e.rateLimits)
      await update($, limits, () => measured)
      await $.store.set('limits', measured).catch(() => {})
    }
    const measured = await contextFrom($, e.context)
    await update($, context, () => measured)
    const used = contextPercent(measured)
    const isOver = used !== undefined && levelOf(used, thresholds.context) === 'over'
    if (isOver && !warnedOver) $.ui.toast(`Context is ${Math.round(used ?? 0)}% full: press Compact above the prompt`)
    warnedOver = isOver
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const { fiveHour, sevenDay, fiveHourResetsAt, sevenDayResetsAt } = await read($, limits)
    const ctx = await read($, context)
    const now = (await read($, tick)).now ?? (await $.clock.now())
    const ctxPercent = contextPercent(ctx)
    if (e.props.hasSurvey || (fiveHour === undefined && sevenDay === undefined && ctxPercent === undefined)) return next(e)

    const meters: Meter[] = []
    if (ctxPercent !== undefined) {
      meters.push({
        key: 'ctx',
        label: 'ctx',
        percent: ctxPercent,
        level: levelOf(ctxPercent, thresholds.context),
        detail: ctx.tokens !== undefined && ctx.window ? `${thousands(ctx.tokens)}/${thousands(ctx.window)}` : undefined,
      })
    }
    if (fiveHour !== undefined) {
      meters.push({ key: '5h', label: '5h', percent: fiveHour, level: levelOf(fiveHour, thresholds.limit), reset: untilLabel(fiveHourResetsAt, now) })
    }
    if (sevenDay !== undefined) {
      meters.push({ key: 'week', label: 'week', percent: sevenDay, level: levelOf(sevenDay, thresholds.limit), reset: untilLabel(sevenDayResetsAt, now) })
    }
    const hasCompact = meters[0]?.key === 'ctx'
    const show = fitLayout(meters, hasCompact, e.props.bodyColumns)

    const { Box, Button, Text } = $.ui.resolve(e)
    const compact = async () => {
      try {
        await $.command.run({ command: 'compact' })
      } catch (err) {
        $.ui.toast(`Compact failed: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    const meterView = (meter: Meter) => (
      <Text wrap="truncate-end">
        {meterSpans(meter, show).map(({ text, dim, ...style }) => <Text {...style} dimColor={dim}>{text}</Text>)}
      </Text>
    )

    return (
      <Box justifyContent="space-between" gap={GAP}>
        {visibleMeters(meters, show).flatMap((meter, index, shown) => [
          meter.key === 'ctx' && hasCompact ? (
            <Box gap={1}>
              <Button key="compact" label={COMPACT_LABEL} variant="primary" onPress={compact}><Text size="footnote" weight="medium">{COMPACT_LABEL}</Text></Button>
              {meterView(meter)}
            </Box>
          ) : (
            meterView(meter)
          ),
          ...(meter.key === 'ctx' && index < shown.length - 1 ? [<Text dimColor>{SEPARATOR}</Text>] : []),
        ])}
      </Box>
    )
  })
}
