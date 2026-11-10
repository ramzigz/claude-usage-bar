# usage-bar

A Claude Code mod that shows your context and usage limits as a one-line band above the prompt:

```
[Compact] ctx ▬▬▬▬▬▬ 42% 168K/400K │ 5h ▬▬▬▬▬▬ 18% ↻ 2h 14m  week ▬▬▬▬▬▬ 31% ↻ 3d 4h
```

- **ctx**: how full the context window is, with the token count.
- **5h** and **week**: how much of your 5-hour and weekly usage limits you've used, with a countdown to each reset.
- **Compact**: runs `/compact` in one click.

Each bar turns orange, then red with ⚠, as it nears its limit. When the context crosses the alert mark, a toast reminds you to compact. On a narrow window the band drops the resets first, then the token count, then the week bar, so it always fits on one row.

It works in the terminal and in the Claude desktop app.

## Install

In Claude Code, run:

```
/plugin marketplace add ramzigz/claude-usage-bar
/plugin install usage-bar@claude-usage-bar
```

Then run `/reload-plugins`, or start a new session.

To update later, run this in a shell, then `/reload-plugins`:

```
claude plugin marketplace update claude-usage-bar && claude plugin update usage-bar@claude-usage-bar
```

## Settings

In Claude Code, run `/plugin configure usage-bar@claude-usage-bar`. From a shell, the same command without the slash shows the current values, and you can set any of them like this:

```
echo '{"contextWarnPercent": "60"}' | claude plugin configure usage-bar@claude-usage-bar --values-stdin
```

| Setting | Default | Effect |
| --- | --- | --- |
| Context warning (%) | 50 | The ctx bar turns orange. |
| Context alert (%) | 80 | The ctx bar turns red with ⚠, and a toast appears. |
| Usage limit warning (%) | 70 | The 5h and week bars turn orange. |
| Usage limit alert (%) | 90 | The 5h and week bars turn red with ⚠. |

## Development

```
claude plugin validate .
claude plugin test .
```

To try a local copy, start Claude Code with `claude --plugin-dir <path to this folder>`.

## License

MIT
