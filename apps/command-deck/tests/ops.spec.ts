import { describe, expect, it } from 'vitest'

import type { OpsAgent, OpsSnapshot, RunEvent } from '../deck/contract.ts'
import { layoutOps, satellitePoint } from '../deck/layout-ops.ts'
import { chooseReading, cycleStation, factsAsOf, formatAge, isOpsSnapshot, ledgerStation, liveLimitMs, stationCounts, stationOf } from '../deck/ops.ts'
import { liveDelayMs, placeFrame } from '../deck/ops-store.ts'

const NOW = Date.parse('2026-09-28T23:40:00.000Z')

/** A snapshot generated `ageMs` before {@link NOW}, with the given agents. */
function snapshot(ageMs: number, agents: OpsAgent[] = [], intervalSeconds?: number): OpsSnapshot {
  return {
    schema: 2,
    generatedAt: new Date(NOW - ageMs).toISOString(),
    producer: 'loop',
    ...intervalSeconds === undefined ? {} : { intervalSeconds },
    window: { since: new Date(NOW - 86_400_000).toISOString(), until: new Date(NOW).toISOString() },
    sources: [],
    heartbeats: [],
    agents,
    attention: [],
    big: {
      seats: null,
      tickets: { queued: 37, halted: 2, shipped: 3, rejected: 1 },
      cycles: null,
      throughput: null,
      shipped: null,
      ci: null,
      host: null,
    },
    seats: null,
    runs: [],
    activity: [],
  }
}

function agent(overrides: Partial<OpsAgent>): OpsAgent {
  return {
    id: 'session:x',
    kind: 'department',
    label: 'T-0001 · Agent Steward',
    doing: 'bash: Run typecheck',
    startedAt: '2026-09-28T23:00:00.000Z',
    lastEventAt: '2026-09-28T23:39:00.000Z',
    elapsedSeconds: 2400,
    idleSeconds: 60,
    state: 'working',
    ...overrides,
  }
}

describe('the three modes', () => {
  it('is live while the feed\'s snapshot is younger than six intervals, and never stricter than ninety seconds', () => {
    expect(liveLimitMs(snapshot(0, [], 15))).toBe(90_000)
    expect(liveLimitMs(snapshot(0, [], 60))).toBe(360_000)
    const reading = chooseReading({ snapshot: snapshot(30_000, [], 15) }, {}, NOW, 'https://relay')
    expect(reading).toMatchObject({ mode: 'live', origin: 'feed', feed: 'https://relay' })
    expect(reading.reason).toBeUndefined()
  })

  it('shows the newest readable snapshot as recent, saying why it is not live', () => {
    const stale = chooseReading({ snapshot: snapshot(3_600_000, [], 15) }, { snapshot: snapshot(600_000) }, NOW, 'https://relay')
    expect(stale.mode).toBe('recent')
    expect(stale.origin).toBe('fixture')
    expect(stale.reason).toBe('the feed\'s newest snapshot is 60 min old, so the operations loop is not pushing')
    const unreachable = chooseReading({ reason: 'the feed is unreachable' }, { snapshot: snapshot(7_200_000) }, NOW, 'https://relay')
    expect(unreachable).toMatchObject({ mode: 'recent', origin: 'fixture', reason: 'the feed is unreachable' })
  })

  it('is offline when neither the feed nor the bundle holds a snapshot', () => {
    expect(chooseReading({ reason: 'the feed answered 503' }, { reason: 'the bundled snapshot answered 404' }, NOW, 'https://relay')).toEqual({
      mode: 'offline',
      feed: 'https://relay',
      reason: 'the feed answered 503; the bundled snapshot answered 404',
    })
  })

  it('reads only a snapshot of the schema it was built for', () => {
    expect(isOpsSnapshot(snapshot(0))).toBe(true)
    expect(isOpsSnapshot({ ...snapshot(0), schema: 1 })).toBe(false)
    expect(isOpsSnapshot({ ...snapshot(0), heartbeats: undefined })).toBe(false)
    expect(isOpsSnapshot({ error: 'the mirror has not received this snapshot yet' })).toBe(false)
  })

  it('dates a panel by the oldest of its sources, and by nothing when one was not read', () => {
    const read = {
      ...snapshot(0),
      sources: [
        { id: 'roster', state: 'ok', detail: '', asOf: '2026-09-28T20:06:11.397Z' },
        { id: 'ledger', state: 'ok', detail: '', asOf: '2026-09-28T23:36:00.000Z' },
        { id: 'ci', state: 'unknown', detail: 'GitHub could not be read' },
      ],
    } satisfies OpsSnapshot
    expect(factsAsOf(read, ['roster', 'ledger'])).toBe('2026-09-28T20:06:11.397Z')
    expect(factsAsOf(read, ['ledger', 'ci'])).toBeUndefined()
    expect(factsAsOf(read)).toBe(read.generatedAt)
  })

  it('states ages in the largest short unit', () => {
    const ages = [12_000, 600_000, 7_200_000, 11_100_000, 3 * 86_400_000, Number.NaN]
    expect(ages.map(formatAge))
      .toEqual(['12 s', '10 min', '2 h', '3 h 5 min', '3 d', 'an unknown time'])
  })
})

describe('stations and frames', () => {
  it('puts each kind of agent at its station, a cycle at the station of its current step', () => {
    expect(stationOf('coordinator', 'x')).toBe('intake')
    expect(stationOf('reviewer', 'x')).toBe('review')
    expect(stationOf('operator-agent', 'x')).toBeUndefined()
    expect(cycleStation('cycle-20260928T221301Z · functions')).toBe('ci')
    expect(stationOf('cycle-step', 'cycle-20260928T221301Z · record')).toBe('ship')
    expect(cycleStation('cycle-20260928T221301Z · after finish')).toBeUndefined()
  })

  it('lands ledger frames where their deliverable belongs', () => {
    const frame = (label: string): RunEvent => ({ ts: NOW, seq: 1, sessionId: 'ledger', kind: 'merge', label, agentId: 'seat' })
    expect([ledgerStation(frame('T-0001 shipped')), ledgerStation(frame('T-0001 halted')), ledgerStation(frame('verify-md-links pass'))]).toEqual(['ship', 'review', 'ci'])
  })

  it('lights a frame\'s seat, else its agent\'s seat, else the agent itself', () => {
    const working = snapshot(0, [agent({ id: 'session:a', seat: 'harness-core-agent-steward' }), agent({ id: 'operator:b', kind: 'operator-agent' })])
    const frame = (sessionId: string, agentId?: string): RunEvent => ({ ts: NOW, seq: 1, sessionId, kind: 'tool', label: 'call', ...agentId === undefined ? {} : { agentId } })
    expect(placeFrame(frame('session:a'), working)).toMatchObject({ target: 'harness-core-agent-steward', station: 'shift' })
    expect(placeFrame(frame('operator:b'), working)).toEqual({ frame: frame('operator:b'), target: 'operator:b' })
    expect(placeFrame(frame('ledger'), working)).toBeUndefined()
    expect(liveDelayMs(snapshot(0, [], 15))).toBe(20_000)
  })

  it('counts what each station prints from the snapshot alone, and says unknown for a source it could not read', () => {
    const counts = stationCounts(snapshot(0, [agent({}), agent({ id: 'session:b', kind: 'reviewer' })]))
    expect(counts.shift).toEqual({ busy: 1, lines: ['1 agent now', '2 halted'] })
    expect(counts.review.lines).toEqual(['1 agent now', '1 rejected · 24 h'])
    expect(counts.ci.lines).toEqual(['0 gates now', 'Branch CI unknown'])
    expect(stationCounts({ ...snapshot(0), big: { ...snapshot(0).big, tickets: null } }).intake.lines).toEqual(['0 agents now', 'queue unknown'])
  })
})

describe('the operations floor layout', () => {
  const seats = ['a', 'b'].flatMap(division => [1, 2, 3].map(index => ({ id: `${division}-${index}`, name: `${division} ${index}`, division, occupied: index === 1, activeToday: false })))

  it('places every seat on one ring, each division one arc, and the stations from intake to ship across it', () => {
    const layout = layoutOps(seats, [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }])
    expect(layout.seats).toHaveLength(6)
    for (const seat of layout.seats) expect(Math.hypot(seat.x, seat.z)).toBeCloseTo(layout.radius, 6)
    expect(layout.divisions.map(division => [division.id, division.count])).toEqual([['a', 3], ['b', 3]])
    expect(layout.stations.intake.x).toBeLessThan(layout.stations.ship.x)
    expect(layout.index.get('b-2')).toBe(4)
    expect(layoutOps(seats, [])).toEqual(layoutOps(seats, []))
  })

  it('circles a seatless agent around its station and the operator\'s agents above the floor', () => {
    const layout = layoutOps(seats, [])
    const around = satellitePoint(0, 2, 'review', layout)
    expect(Math.hypot(around.x - layout.stations.review.x, around.z - layout.stations.review.z)).toBeCloseTo(4.5, 6)
    expect(satellitePoint(0, 3, undefined, layout).y).toBeGreaterThan(layout.stations.review.y)
  })
})
