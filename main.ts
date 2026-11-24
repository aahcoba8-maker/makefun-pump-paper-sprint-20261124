// Entry for the make.fun bounty "Pump.fun Paper Sprint: Any Bot Can Win"
// (u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b).
//
// The grader runs `node /bot/main.ts` (Node 22, no build, no install). The
// wire protocol (agent-fun/replay/v2) lives in vendor/makefun-bot.ts, the
// kit's SDK shim vendored byte for byte; the trading strategy — a filtered
// launch snipe that pyramids into strength and exits mechanically — lives
// in strategy.ts.

import { runBot } from './vendor/makefun-bot.ts';
import { createStrategy, DEFAULT_PARAMS } from './strategy.ts';

await runBot(createStrategy(DEFAULT_PARAMS));
