[![make.fun · u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b](https://make.fun/badge/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b.svg)](https://make.fun/bounty/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b?utm_source=github&utm_medium=readme&utm_campaign=u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b)
[![rank](https://make.fun/badge/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b/aahcoba8-maker/makefun-pump-paper-sprint-20261124/rank.svg)](https://make.fun/bounty/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b)
[![reward](https://make.fun/badge/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b/aahcoba8-maker/makefun-pump-paper-sprint-20261124/reward.svg)](https://make.fun/bounty/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b?utm_source=github&utm_medium=readme&utm_campaign=u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b)

# Pump.fun Paper Sprint — filtered launch snipe

An entry for the make.fun bounty [Pump.fun Paper Sprint: Any Bot Can Win](https://make.fun/bounty/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b): a paper-trading bot for the pump.fun bonding-curve replay (agent-fun/replay/v2). The house replays every entry on the same frozen market window; the highest net PnL wins. No real funds are involved.

## Strategy

Most new pump.fun curves die within minutes; a small minority run 5–50x. This bot is built to be paid by the minority through breadth, not prediction:

- **Filtered launch entries.** A first buy is only decided in a launch's first slots, after the opening tape can be read: the creator's own buy size, how many wallets were bundled into the create slot (a crowd there is usually the creator's dump cluster), whether the creator already sold, whether an early whale dump already hit the curve, and how far the price has already run from the create price.
- **Size only into strength.** The first buy is one small stake. Later tranches are added on later batches only while the price steps up from the previous buy and the position is in profit, so false starts stay cheap and runners get size.
- **Mechanical exits.** Half off at the first take-profit, a trailing stop once a position has run (wider once the curve nears completion), a hard stop loss, a hard time limit, an instant exit when the creator sells, and an exit when the tape goes quiet.
- **Guards above the trading.** An equity guard stops new entries at a 15% drawdown from peak equity and flattens everything at 25% — far inside the contest's 50% guardrail. A pacing guard keeps the run above the minimum activity bar (round trips of at least 0.01 SOL on at least 20 coins) with tiny probe round trips on liquid curves whenever real trading lags the pace.

The bot is a pure function of the batches it is fed — no clock, no randomness, no I/O — so the replay's two executions produce identical action logs.

## Layout

- `main.ts` — the entrypoint the grader runs (`node /bot/main.ts`, Node 22).
- `strategy.ts` — the strategy and its parameters.
- `vendor/makefun-bot.ts` — the make.fun replay SDK shim, vendored byte for byte from the bounty kit.

## License

MIT — see [LICENSE](LICENSE).
