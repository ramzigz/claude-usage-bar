export type Limits = { fiveHour?: number; sevenDay?: number; fiveHourResetsAt?: string; sevenDayResetsAt?: string }
export type Context = { tokens?: number; window?: number; percent?: number }
export type Tick = { now?: number }

declare module 'claude-code' {
  interface PluginState {
    'usage-bar': { limits: Limits; context: Context; tick: Tick }
  }
}
