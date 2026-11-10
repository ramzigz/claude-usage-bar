import { atom, read, update } from 'claude-code'
import type { PluginOptions, Register, SessionContextUsage, SessionUsage, SessionUsageArgs } from 'claude-code'

import type { Context, Limits, Tick } from '../types'

const BAR_WIDTH = 6
const GAP = 1
// A cell of padding at each end keeps the band off the edges.
const PAD = 1
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

const clamp = (percent: number) => Math.min(Math.max(percent, 0), 100)

export const barParts = (percent: number, width = BAR_WIDTH) => {
  const filled = Math.round((clamp(percent) / 100) * width)
  return { filled: '▬'.repeat(filled), empty: '▬'.repeat(width - filled) }
}

const PIES = ['○', '◔', '◑', '◕', '●']
export const pieGlyph = (percent: number) => PIES[Math.round(clamp(percent) / 25)]

const DONUT_SIZE = 14
const donutSvg = (percent: number, color: string) => {
  const length = 2 * Math.PI * 5
  const ring = (stroke: string, dash = '') =>
    `<circle cx="7" cy="7" r="5" fill="none" stroke="${stroke}" stroke-width="3"${dash} transform="rotate(-90 7 7)"/>`
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${DONUT_SIZE} ${DONUT_SIZE}">${ring('#8888')}${ring(color, ` stroke-dasharray="${((clamp(percent) / 100) * length).toFixed(2)} ${length.toFixed(2)}"`)}</svg>`
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

// Measured against the compaction window, as /context is: it can be far smaller than the model's window.
const contextFrom = async ($: UsageReader, live: SessionContextUsage): Promise<Context> => {
  const breakdown = await $.session.usage({ breakdown: 'summary' }).then(usage => usage.context.breakdown, () => undefined)
  const window = breakdown?.rawMaxTokens
  if (live.tokens !== undefined && window) return { tokens: live.tokens, window }
  if (live.tokens !== undefined || live.percent !== undefined) return { tokens: live.tokens, window: live.window, percent: live.percent }
  return { tokens: breakdown?.totalTokens, window: window ?? live.window }
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
export type Show = { detail: boolean; reset: boolean; pie: 'none' | 'ctx' | 'all'; bar?: number; hide?: string; ctxLabel?: string }
type Span = { text: string; color?: string; dim?: boolean; bold?: boolean; chart?: 'bar' | 'pie' }
export type Cells = { text: number; bar: number; pie: number; compact: number }

const TERMINAL_CELLS: Cells = { text: 1, bar: 1, pie: 1, compact: 12 }
// Measured on the desktop: a cell is about 7.9px, a letter about 7px, a ▬ and the donut about 14px, Compact with its gap about 86px.
const REMOTE_CELLS: Cells = { text: 0.9, bar: 1.8, pie: 1.8, compact: 11 }

const THREE_PIES: Show = { detail: false, reset: false, pie: 'all' }
// Narrower still: week goes, then context shortens to ctx, then loses its label, leaving Compact and the two pies.
const NARROWEST: Show = { ...THREE_PIES, hide: 'week', ctxLabel: '' }
export const LAYOUTS: Show[] = [
  { detail: true, reset: true, pie: 'none' },
  { detail: false, reset: true, pie: 'ctx' },
  { detail: false, reset: true, pie: 'all' },
  THREE_PIES,
  { ...THREE_PIES, hide: 'week' },
  { ...THREE_PIES, hide: 'week', ctxLabel: 'ctx' },
  NARROWEST,
]
export const shownMeters = (meters: Meter[], show: Show) => meters.filter(meter => meter.key !== show.hide)

// The band never wraps and no part is cut to "…": a section that still overflows is clipped at its edge.
const ROW = { flexWrap: 'nowrap' } as const
const SHRINK = { flexShrink: 1, minWidth: 0, overflow: 'hidden' } as const
const KEEP = { flexShrink: 0 } as const
const isPie = (meter: Meter, show: Show) => show.pie === 'all' || (show.pie === 'ctx' && meter.key === 'ctx')

export const meterSpans = (meter: Meter, show: Show): Span[] => {
  const { filled, empty } = barParts(meter.percent, show.bar)
  const color = LEVEL_COLORS[meter.level]
  const over = meter.level === 'over'
  const label = meter.key === 'ctx' && show.ctxLabel !== undefined ? show.ctxLabel : meter.label
  return [
    ...(over ? [{ text: '⚠ ', color, bold: true }] : []),
    ...(label ? [{ text: `${label} `, dim: true }] : []),
    ...(isPie(meter, show)
      ? [{ text: pieGlyph(meter.percent), color, chart: 'pie' as const }]
      : [{ text: filled, color, chart: 'bar' as const }, { text: empty, dim: true, chart: 'bar' as const }]),
    { text: ` ${Math.round(meter.percent)}%`, color: meter.level === 'ok' ? undefined : color, bold: over },
    ...(show.detail && meter.detail ? [{ text: ` ${meter.detail}`, dim: true }] : []),
    ...(show.reset && meter.reset ? [{ text: ` ${meter.reset}`, dim: true }] : []),
  ]
}

const COMPACT_LABEL = 'Compact'
const SEPARATOR = '│'

const spanWidth = (span: Span, cells: Cells) =>
  span.chart === 'pie' ? cells.pie : span.text.length * (span.chart === 'bar' ? cells.bar : cells.text)

export const bandWidth = (all: Meter[], show: Show, hasCompact: boolean, cells: Cells = TERMINAL_CELLS) => {
  const meters = shownMeters(all, show)
  const text = meters.reduce((sum, meter) => sum + meterSpans(meter, show).reduce((n, span) => n + spanWidth(span, cells), 0), 0)
  const between = Math.max(meters.length - 1, 0)
  // A limit's label, chart and reset are parts of their own, a cell apart.
  const parts = meters.reduce((sum, meter) => sum + (meter.key === 'ctx' ? 0 : show.reset && meter.reset ? 2 : 1), 0)
  return text + parts + between * (GAP + SEPARATOR.length + GAP) + (hasCompact ? cells.compact : 0) + 2 * PAD
}

export const fitLayout = (meters: Meter[], hasCompact: boolean, columns: number | undefined, cells: Cells = TERMINAL_CELLS) =>
  LAYOUTS.find(show => !columns || bandWidth(meters, show, hasCompact, cells) <= columns) ?? NARROWEST

// Spare width lengthens the bars, all alike, keeping a few cells for the spread between parts.
const MAX_BAR = 24
const BAR_SLACK = 6
export const barLength = (meters: Meter[], show: Show, hasCompact: boolean, columns: number | undefined, cells: Cells = TERMINAL_CELLS) => {
  const bars = meters.filter(meter => !isPie(meter, show)).length
  if (!columns || !bars) return BAR_WIDTH
  const spare = columns - BAR_SLACK - bandWidth(meters, show, hasCompact, cells)
  return Math.min(MAX_BAR, BAR_WIDTH + Math.max(0, Math.floor(spare / (bars * cells.bar))))
}

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
        label: 'context',
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
    const cells = e.surface === 'terminal' ? TERMINAL_CELLS : REMOTE_CELLS
    const fitted = fitLayout(meters, hasCompact, e.props.bodyColumns, cells)
    const show = { ...fitted, bar: barLength(meters, fitted, hasCompact, e.props.bodyColumns, cells) }

    const elements = $.ui.resolve(e)
    const { Box, Button, Text } = elements
    const Svg = e.surface !== 'terminal' && 'Svg' in elements ? elements.Svg : undefined
    const compact = async () => {
      try {
        await $.command.run({ command: 'compact' })
      } catch (err) {
        $.ui.toast(`Compact failed: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    const spanViews = (spans: Span[]) => spans.map(({ text, dim, chart: _chart, ...style }) => <Text {...style} dimColor={dim}>{text}</Text>)
    const partView = (meter: Meter, spans: Span[]) => {
      const pie = spans.findIndex(span => span.chart === 'pie')
      if (pie < 0 || !Svg) return <Box {...ROW} {...KEEP}><Text wrap="truncate-end">{spanViews(spans)}</Text></Box>
      return (
        <Box {...ROW} {...KEEP} alignItems="center">
          <Text wrap="truncate-end">{spanViews(spans.slice(0, pie))}</Text>
          <Svg
            source={donutSvg(meter.percent, LEVEL_COLORS[meter.level])}
            alt={`${meter.label} ${Math.round(meter.percent)}%`}
            width={DONUT_SIZE}
            height={DONUT_SIZE}
          />
          <Text wrap="truncate-end">{spanViews(spans.slice(pie + 1))}</Text>
        </Box>
      )
    }
    // Each section spreads its parts over its share of the row: the label, the chart with its percent, the reset.
    const sectionParts = (meter: Meter) => {
      const spans = meterSpans(meter, show)
      if (meter.key === 'ctx') return [spans]
      const label = spans.findIndex(span => span.text === `${meter.label} `) + 1
      const reset = show.reset && meter.reset ? spans.length - 1 : spans.length
      return [spans.slice(0, label), spans.slice(label, reset), spans.slice(reset)].filter(part => part.length)
    }

    return (
      <Box {...ROW} justifyContent="space-between" gap={GAP} paddingX={PAD}>
        {shownMeters(meters, show).flatMap((meter, index, shown) => [
          <Box key={meter.key} {...ROW} {...(meter.key === 'ctx' ? { flexShrink: 1, minWidth: 0 } : SHRINK)} flexGrow={meter.key === 'ctx' ? 0 : 1} justifyContent="space-between" alignItems="center" gap={1}>
            {meter.key === 'ctx' && hasCompact ? (
              <Box {...ROW} flexShrink={0}>
                <Button key="compact" label={COMPACT_LABEL} variant="primary" onPress={compact}><Text size="footnote" weight="medium">{COMPACT_LABEL}</Text></Button>
              </Box>
            ) : null}
            {sectionParts(meter).map(part => partView(meter, part))}
          </Box>,
          ...(index < shown.length - 1 ? [<Box {...ROW} flexShrink={0}><Text dimColor>{SEPARATOR}</Text></Box>] : []),
        ])}
      </Box>
    )
  })
}
