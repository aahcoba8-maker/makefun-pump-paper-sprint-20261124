// Momentum-confirmed launch strategy for the pump.fun paper replay
// (agent-fun/replay/v2), written for the make.fun Pump.fun Paper Sprint.
//
// Design, from the shape of a pump.fun window and from local backtests on
// the kit's dev window:
// - Sniping raw launches loses: most new curves are dead within minutes and
//   the few that run dump just as fast, so neither blind early entries nor
//   patient holding pays. What pays is confirmation — a curve that, a
//   couple of minutes after launch, still shows net SOL flowing in, several
//   distinct buyers, a price rising but not yet vertical, sitting near its
//   recent high, with the newer half of the tape bringing in at least as
//   much as the older half (demand accelerating, not fading).
// - The launch rug filters still apply before any of that: the creator must
//   not have sold, the creator's own buy must not be outsized, no single
//   early whale dump, and sell pressure must stay a minority of buy volume.
// - Size builds only into strength. The first buy is one stake; later
//   tranches are added on later batches, only while the price steps up from
//   the previous buy and the position is in profit. Each buy is also capped
//   by the harness's per-reply share of the curve's real SOL reserve, so a
//   position naturally grows as the curve itself grows.
// - Exits are mechanical and quick: half off at the first take-profit, a
//   trailing stop once the position has run, a hard stop loss, a hard time
//   limit, an instant exit when the creator sells, and an exit when the
//   tape goes quiet. A curve that completes is closed by the replay itself.
// - Two guards sit above the trading: an equity guard (new entries stop at
//   a 15% drawdown from the peak, everything is flattened at 25%, far
//   inside the 50% guardrail) and a pacing guard that keeps the run above
//   the minimum bar (round trips of at least 0.01 SOL on at least 20 coins,
//   and a healthy fill count) with tiny probe round trips on liquid curves
//   when the real trading lags the pace.
//
// A pure function of the batches it is fed: no clock, no randomness, no I/O.
// Iteration is only over insertion-ordered maps fed by the batch stream, so
// the replay's two executions produce identical action logs.

import { BPS, type Batch, type Bot, type BotState, type OrderInput, type Pubkey } from './vendor/makefun-bot.ts';

export interface Params {
  /** Tape window (slots) the entry signal is computed over. */
  entryWindow: number;
  /** A coin must be at least this old (slots since create) before a first buy. */
  minAgeSlots: number;
  /** Oldest age at which a first buy may still be decided. */
  maxAgeSlots: number;
  /** Net SOL inflow (buys minus sells, lamports) over the entry window, at least. */
  minNetFlowLamports: number;
  /** Buy trades and distinct buyers over the entry window, at least. */
  minWindowBuys: number;
  minWindowBuyers: number;
  /** Price change over the entry window (bps): must sit inside this band. */
  minWindowUpBps: number;
  maxWindowUpBps: number;
  /** Price now at least this share (bps) of the entry window's high. */
  nearHighBps: number;
  /** Newer-half net inflow must be at least the older half's (acceleration). */
  accel: boolean;
  /** Lamports aimed at for the first buy of a coin (the reserve cap may cut it). */
  stakeLamports: number;
  /** Smallest single buy worth paying the transaction fee for. */
  minBuyLamports: number;
  /** Lamports per add-on buy, and how many adds a position may take. */
  addLamports: number;
  maxAdds: number;
  /** An add needs the decision price at least this far (bps) above the previous buy's. */
  addStepBps: number;
  /** An add needs the position's close value at least this far (bps) above its cost. */
  addIfUpBps: number;
  /** Real SOL reserve window at entry (lamports). */
  minRealSol: number;
  maxRealSol: number;
  /** The creator's own buy in the create slot must not exceed this (lamports). */
  maxDevBuy: number;
  /** Distinct non-creator buyers in the create slot, at most (bundle filter). */
  maxCreateSlotBuyers: number;
  /** Lamports sold by others over lamports bought, as bps, at most. */
  maxSellRatioBps: number;
  /** Largest single non-creator sell seen, as bps of the real SOL reserve before it, at most. */
  maxBigSellBps: number;
  /** Skip a coin whose creator already sold. */
  skipDevSold: boolean;
  /** Slippage allowed on buys (bps). Sells always go out at 10000. */
  buySlippageBps: number;
  /** First take-profit: sell tp1PartBps of the position at tp1Bps over cost. */
  tp1Bps: number;
  tp1PartBps: number;
  /** Trailing stop: armed at trailArmBps over cost, exits trailBps under the best value. */
  trailArmBps: number;
  trailBps: number;
  /** Wider trailing stop (bps) once the curve's real SOL passes rideRealSol. */
  trailWideBps: number;
  rideRealSol: number;
  /** Hard stop loss (bps under cost). */
  stopLossBps: number;
  /** Exit after holding this many slots. */
  maxHoldSlots: number;
  /** Exit when no trade has hit the coin for this many slots. */
  staleSlots: number;
  /** Exit when the creator sells while the position is held. */
  exitOnDevSell: boolean;
  /** Most positions open at once. */
  maxOpen: number;
  /** Most lamports at cost across all positions at once. */
  maxExposureLamports: number;
  /** Lamports of cash always kept back for fees and probes. */
  cashReserveLamports: number;
  /** Equity guard: stop new entries at this drawdown (bps) from the peak equity. */
  haltDdBps: number;
  /** Equity guard: flatten everything and stop trading at this drawdown (bps). */
  flattenDdBps: number;
  /** Guardrail pacing targets: coins round-tripped and own fills over the window. */
  targetCoins: number;
  targetFills: number;
  /** Block-time seconds the pacing targets are prorated over. */
  paceSecs: number;
  /** Lamports per probe round trip. */
  probeLamports: number;
  /** Most probe round trips open at once. */
  maxProbes: number;
}

export const DEFAULT_PARAMS: Params = {
  entryWindow: 120,
  minAgeSlots: 90,
  maxAgeSlots: 1200,
  minNetFlowLamports: 500_000_000,
  minWindowBuys: 5,
  minWindowBuyers: 4,
  minWindowUpBps: 300,
  maxWindowUpBps: 15_000,
  nearHighBps: 9_200,
  accel: true,
  stakeLamports: 150_000_000,
  minBuyLamports: 5_000_000,
  addLamports: 100_000_000,
  maxAdds: 2,
  addStepBps: 2_000,
  addIfUpBps: 2_000,
  minRealSol: 5_000_000_000,
  maxRealSol: 60_000_000_000,
  maxDevBuy: 2_500_000_000,
  maxCreateSlotBuyers: 5,
  maxSellRatioBps: 5_000,
  maxBigSellBps: 1_000,
  skipDevSold: true,
  buySlippageBps: 10_000,
  tp1Bps: 5_000,
  tp1PartBps: 5_000,
  trailArmBps: 4_000,
  trailBps: 3_000,
  trailWideBps: 4_000,
  rideRealSol: 40_000_000_000,
  stopLossBps: 2_000,
  maxHoldSlots: 450,
  staleSlots: 300,
  exitOnDevSell: true,
  maxOpen: 10,
  maxExposureLamports: 8_000_000_000,
  cashReserveLamports: 500_000_000,
  haltDdBps: 1_500,
  flattenDdBps: 2_500,
  targetCoins: 25,
  targetFills: 240,
  paceSecs: 21_600,
  probeLamports: 12_000_000,
  maxProbes: 2,
};

const FEE_BPS = 125n; // protocol 95 + creator 30, from the dataset fee tiers

/** What selling `tokens` against reserves (vq, vt) pays after curve fees, in lamports. */
function sellValue(tokens: bigint, vq: bigint, vt: bigint): bigint {
  if (tokens <= 0n || vt <= 0n || vq <= 0n) return 0n;
  const q = (tokens * vq) / (vt + tokens);
  return q - (q * FEE_BPS + BPS - 1n) / BPS;
}

interface Tick {
  slot: number;
  buy: boolean;
  sol: bigint;
  user: Pubkey;
  /** Post-trade price (virtual quote per virtual token) as a float ratio. */
  price: number;
}

interface Coin {
  createSlot: number;
  creator: Pubkey;
  devBuy: bigint;
  devSold: boolean;
  createSlotBuyers: Set<Pubkey>;
  bought: bigint;
  soldByOthers: bigint;
  bigSellBps: bigint;
  lastTradeSlot: number;
  /** Recent trades, oldest first; pruned to the entry window plus margin. */
  tape: Tick[];
  buysSent: number;
  addsSent: number;
  spentSent: bigint;
  lastBuyVq: bigint;
  lastBuyVt: bigint;
  /** Never buy this coin again. */
  done: boolean;
  complete: boolean;
}

interface Held {
  openedSlot: number;
  /** Best close value seen (lamports, after curve fees, before the sell's tx fee). */
  best: bigint;
  tookTp1: boolean;
  exiting: boolean;
}

export function createStrategy(p: Params = DEFAULT_PARAMS): Bot {
  const coins = new Map<Pubkey, Coin>();
  const held = new Map<Pubkey, Held>();
  /** Probe round trips in flight, by mint. */
  const probes = new Set<Pubkey>();
  /** Mints with one of my sells in flight. */
  const selling = new Set<Pubkey>();
  let myFills = 0;
  const myCoins = new Set<Pubkey>();
  let firstTime: number | null = null;
  let lastTime: number | null = null;
  let peakEquity = 0n;
  let halted = false;
  let flattened = false;

  const hasPending = (state: BotState, mint: Pubkey, side: 'buy' | 'sell'): boolean => {
    for (const po of state.pending.values()) if (po.order.mint === mint && po.order.side === side) return true;
    return false;
  };

  /** The entry signal: demand confirmed on the coin's tape at slot `now`. */
  const entrySignal = (c: Coin, now: number): boolean => {
    const from = now - p.entryWindow;
    const mid = now - p.entryWindow / 2;
    let netOld = 0n;
    let netNew = 0n;
    let buys = 0;
    const buyers = new Set<Pubkey>();
    let startPrice = -1;
    let high = 0;
    let last = 0;
    for (const t of c.tape) {
      if (t.slot <= from) {
        startPrice = t.price;
        continue;
      }
      if (startPrice < 0) startPrice = t.price;
      const signed = t.buy ? t.sol : -t.sol;
      if (t.slot <= mid) netOld += signed;
      else netNew += signed;
      if (t.buy) {
        buys++;
        buyers.add(t.user);
      }
      if (t.price > high) high = t.price;
      last = t.price;
    }
    if (startPrice <= 0 || last <= 0 || high <= 0) return false;
    if (buys < p.minWindowBuys || buyers.size < p.minWindowBuyers) return false;
    if (netOld + netNew < BigInt(p.minNetFlowLamports)) return false;
    const upBps = Math.round(((last - startPrice) / startPrice) * 10_000);
    if (upBps < p.minWindowUpBps || upBps > p.maxWindowUpBps) return false;
    if (last < (high * p.nearHighBps) / 10_000) return false;
    if (p.accel && (netNew <= 0n || netNew < netOld)) return false;
    return true;
  };

  return {
    onBatch(state: BotState, batch: Batch): OrderInput[] {
      const now = batch.slot;
      const cap = state.hello.caps.max_orders_per_batch;
      const tx = state.txFeeLamports();

      // ---- fold the batch in: fills, then the event tape -----------------
      for (const f of batch.fills) {
        if (f.client_id.startsWith('_')) {
          held.delete(f.mint);
          probes.delete(f.mint);
          selling.delete(f.mint);
          continue;
        }
        if (f.status === 'filled') {
          myFills++;
          myCoins.add(f.mint);
        }
        if (f.side === 'sell' && f.status !== 'rejected') selling.delete(f.mint);
      }
      const tradedNow = new Set<Pubkey>();
      for (const e of batch.events) {
        if (e.block_time !== null) {
          if (firstTime === null) firstTime = e.block_time;
          if (lastTime === null || e.block_time > lastTime) lastTime = e.block_time;
        }
        if (e.event === 'CreateEvent') {
          if (!coins.has(e.mint)) {
            coins.set(e.mint, {
              createSlot: e.slot,
              creator: e.creator,
              devBuy: 0n,
              devSold: false,
              createSlotBuyers: new Set(),
              bought: 0n,
              soldByOthers: 0n,
              bigSellBps: 0n,
              lastTradeSlot: e.slot,
              tape: [],
              buysSent: 0,
              addsSent: 0,
              spentSent: 0n,
              lastBuyVq: 0n,
              lastBuyVt: 1n,
              done: false,
              complete: false,
            });
          }
          tradedNow.add(e.mint);
        } else if (e.event === 'TradeEvent') {
          tradedNow.add(e.mint);
          const c = coins.get(e.mint);
          if (c === undefined) continue;
          const sol = BigInt(e.sol_amount);
          c.lastTradeSlot = e.slot;
          const vt = Number(e.virtual_token_reserves);
          const price = vt > 0 ? Number(e.virtual_quote_reserves) / vt : 0;
          c.tape.push({ slot: e.slot, buy: e.is_buy, sol, user: e.user, price });
          const isDev = e.user === c.creator;
          if (e.is_buy) {
            c.bought += sol;
            if (isDev && e.slot === c.createSlot) c.devBuy += sol;
            else if (!isDev && e.slot === c.createSlot) c.createSlotBuyers.add(e.user);
          } else if (isDev) {
            c.devSold = true;
          } else {
            c.soldByOthers += sol;
            const rqBefore = BigInt(e.real_quote_reserves) + sol;
            if (rqBefore > 0n) {
              const bps = (sol * BPS) / rqBefore;
              if (bps > c.bigSellBps) c.bigSellBps = bps;
            }
          }
        } else {
          const c = coins.get(e.mint);
          if (c !== undefined) {
            c.complete = true;
            c.done = true;
          }
        }
      }
      const keepFrom = now - p.entryWindow - 10;
      for (const mint of tradedNow) {
        const c = coins.get(mint);
        if (c === undefined) continue;
        let cut = 0;
        while (cut < c.tape.length && c.tape[cut]!.slot <= keepFrom) cut++;
        if (cut > 0) c.tape.splice(0, cut);
      }
      for (const mint of [...selling]) if (!hasPending(state, mint, 'sell')) selling.delete(mint);
      for (const mint of [...held.keys()]) {
        if (!state.positions.has(mint) && !selling.has(mint) && !hasPending(state, mint, 'buy')) held.delete(mint);
      }
      for (const mint of [...probes]) {
        if (!state.positions.has(mint) && !hasPending(state, mint, 'buy') && !hasPending(state, mint, 'sell')) probes.delete(mint);
      }

      // ---- equity guard ---------------------------------------------------
      const marks = new Map<Pubkey, { vq: bigint; vt: bigint; rq: bigint }>();
      for (const m of batch.marks) {
        marks.set(m.mint, { vq: BigInt(m.virtual_quote_reserves), vt: BigInt(m.virtual_token_reserves), rq: BigInt(m.real_quote_reserves) });
      }
      const valueOf = (mint: Pubkey, tokens: bigint): bigint => {
        const mk = marks.get(mint);
        if (mk !== undefined) return sellValue(tokens, mk.vq, mk.vt);
        const cv = state.curves.get(mint);
        if (cv === undefined) return 0n;
        return sellValue(tokens, cv.virtual_quote_reserves, cv.virtual_token_reserves);
      };
      let equity = state.cash;
      for (const [mint, pos] of state.positions) equity += valueOf(mint, pos.token_amount);
      if (equity > peakEquity) peakEquity = equity;
      if (peakEquity > 0n) {
        const dd = ((peakEquity - equity) * BPS) / peakEquity;
        if (dd >= BigInt(p.flattenDdBps)) flattened = true;
        halted = dd >= BigInt(p.haltDdBps);
      }

      const orders: OrderInput[] = [];

      // ---- exits first ----------------------------------------------------
      for (const [mint, pos] of state.positions) {
        if (orders.length >= cap) break;
        if (selling.has(mint)) continue;
        const c = coins.get(mint);
        const curve = state.curves.get(mint);
        if (curve === undefined || curve.complete) continue;
        let h = held.get(mint);
        if (h === undefined) {
          h = { openedSlot: now, best: 0n, tookTp1: false, exiting: false };
          held.set(mint, h);
        }
        const value = valueOf(mint, pos.token_amount) - tx;
        const cost = pos.cost_lamports;
        if (value > h.best) h.best = value;
        let exit = flattened || h.exiting;
        if (!exit && cost > 0n) {
          if (!h.tookTp1 && value * BPS >= cost * (BPS + BigInt(p.tp1Bps))) {
            const part = (pos.token_amount * BigInt(p.tp1PartBps)) / BPS;
            if (part > 0n && part < pos.token_amount) {
              orders.push({ side: 'sell', mint, token_amount: part, max_slippage_bps: 10_000 });
              selling.add(mint);
              h.tookTp1 = true;
              h.best = 0n;
              if (c !== undefined) c.done = true;
              continue;
            }
          }
          if (value * BPS <= cost * (BPS - BigInt(p.stopLossBps))) exit = true;
          const rq = marks.get(mint)?.rq ?? curve.real_quote_reserves;
          const trail = rq >= BigInt(p.rideRealSol) ? BigInt(p.trailWideBps) : BigInt(p.trailBps);
          if (h.best * BPS >= cost * (BPS + BigInt(p.trailArmBps)) && value * BPS <= h.best * (BPS - trail)) exit = true;
        }
        if (!exit && now - h.openedSlot >= p.maxHoldSlots) exit = true;
        if (!exit && c !== undefined) {
          if (p.exitOnDevSell && c.devSold) exit = true;
          if (now - c.lastTradeSlot >= p.staleSlots) exit = true;
        }
        if (!exit) continue;
        h.exiting = true;
        orders.push({ side: 'sell', mint, token_amount: pos.token_amount, max_slippage_bps: 10_000 });
        selling.add(mint);
        if (c !== undefined) c.done = true;
      }

      // ---- probe sells: close a probe as soon as its buy has landed -------
      for (const mint of probes) {
        if (orders.length >= cap) break;
        const pos = state.positions.get(mint);
        if (pos === undefined || selling.has(mint) || held.has(mint)) continue;
        const curve = state.curves.get(mint);
        if (curve === undefined || curve.complete) continue;
        orders.push({ side: 'sell', mint, token_amount: pos.token_amount, max_slippage_bps: 10_000 });
        selling.add(mint);
      }

      if (flattened) return orders;

      // ---- entries and adds ----------------------------------------------
      let free = state.freeCashLamports() - BigInt(p.cashReserveLamports) - tx * BigInt(orders.length);
      let exposure = 0n;
      for (const pos of state.positions.values()) exposure += pos.cost_lamports;
      let open = state.committedPositionCount();

      for (const mint of tradedNow) {
        if (orders.length >= cap) break;
        const c = coins.get(mint);
        if (c === undefined || c.done || c.complete) continue;
        const curve = state.curves.get(mint);
        if (curve === undefined || curve.complete) continue;
        if (hasPending(state, mint, 'buy') || probes.has(mint) || selling.has(mint)) continue;
        const vq = curve.virtual_quote_reserves;
        const vt = curve.virtual_token_reserves;
        const rq = curve.real_quote_reserves;

        if (c.buysSent > 0) {
          // Add into strength only: price stepped up, position in profit.
          const h = held.get(mint);
          const pos = state.positions.get(mint);
          if (h === undefined || pos === undefined || h.exiting || c.addsSent >= p.maxAdds) continue;
          if (vq * c.lastBuyVt * BPS < c.lastBuyVq * vt * BigInt(10_000 + p.addStepBps)) continue;
          const value = sellValue(pos.token_amount, vq, vt);
          if (value * BPS < pos.cost_lamports * (BPS + BigInt(p.addIfUpBps))) continue;
          const capBuy = state.maxBuyLamports(mint);
          let amount = BigInt(p.addLamports);
          if (amount > capBuy) amount = capBuy;
          if (amount < BigInt(p.minBuyLamports)) continue;
          if (free < amount + tx || exposure + amount > BigInt(p.maxExposureLamports)) continue;
          orders.push({ side: 'buy', mint, quote_lamports: amount, max_slippage_bps: p.buySlippageBps });
          free -= amount + tx;
          exposure += amount;
          c.addsSent++;
          c.spentSent += amount;
          c.lastBuyVq = vq;
          c.lastBuyVt = vt;
          continue;
        }

        // First buy: rug filters, then the momentum confirmation.
        if (halted) break;
        const age = now - c.createSlot;
        if (age < p.minAgeSlots) continue;
        if (age > p.maxAgeSlots) {
          c.done = true;
          continue;
        }
        if (open >= Math.min(p.maxOpen, state.hello.caps.max_open_positions)) continue;
        if (rq < BigInt(p.minRealSol) || rq > BigInt(p.maxRealSol)) continue;
        if (c.devBuy > BigInt(p.maxDevBuy)) continue;
        if (p.skipDevSold && c.devSold) {
          c.done = true;
          continue;
        }
        if (c.createSlotBuyers.size > p.maxCreateSlotBuyers) continue;
        if (c.bought > 0n && c.soldByOthers * BPS > c.bought * BigInt(p.maxSellRatioBps)) continue;
        if (c.bigSellBps > BigInt(p.maxBigSellBps)) continue;
        if (!entrySignal(c, now)) continue;
        const capBuy = state.maxBuyLamports(mint);
        let amount = BigInt(p.stakeLamports);
        if (amount > capBuy) amount = capBuy;
        if (amount < BigInt(p.minBuyLamports)) continue;
        if (free < amount + tx || exposure + amount > BigInt(p.maxExposureLamports)) continue;
        orders.push({ side: 'buy', mint, quote_lamports: amount, max_slippage_bps: p.buySlippageBps });
        free -= amount + tx;
        exposure += amount;
        c.buysSent++;
        c.spentSent += amount;
        c.lastBuyVq = vq;
        c.lastBuyVt = vt;
        open++;
      }

      // ---- guardrail pacing: probe round trips when trading lags ---------
      if (!halted && probes.size < p.maxProbes && firstTime !== null && lastTime !== null) {
        const pace = Math.min(1, (lastTime - firstTime) / p.paceSecs);
        const needCoins = myCoins.size < Math.ceil(p.targetCoins * pace);
        const needFills = myFills < Math.ceil(p.targetFills * pace);
        if (needCoins || needFills) {
          const minRq = (BigInt(p.probeLamports) * BPS) / BigInt(state.hello.caps.max_order_bps_of_real_reserve);
          for (const mint of tradedNow) {
            if (orders.length >= cap || probes.size >= p.maxProbes) break;
            if (coins.get(mint)?.done || held.has(mint) || probes.has(mint) || state.positions.has(mint)) continue;
            if (hasPending(state, mint, 'buy')) continue;
            if (needCoins && !needFills && myCoins.has(mint)) continue;
            const curve = state.curves.get(mint);
            if (curve === undefined || curve.complete) continue;
            if (curve.real_quote_reserves < (minRq * 3n) / 2n) continue;
            if (free < BigInt(p.probeLamports) + 2n * tx) break;
            orders.push({ side: 'buy', mint, quote_lamports: BigInt(p.probeLamports), max_slippage_bps: p.buySlippageBps });
            probes.add(mint);
            free -= BigInt(p.probeLamports) + tx;
          }
        }
      }
      return orders;
    },
  };
}
