import type { ConditionDef, CoverageName } from '../play/schema/playDefinition';

/** Normalized condition (spec §21, §30). Events beat timestamps. */
export type Condition =
  | { kind: 'event'; name: string }
  | { kind: 'coverage'; coverage: CoverageName }
  | { kind: 'elapsed'; seconds: number }
  | { kind: 'all'; of: Condition[] }
  | { kind: 'any'; of: Condition[] };

export function normalizeCondition(c: ConditionDef): Condition {
  if (typeof c === 'string') return { kind: 'event', name: c };
  if ('event' in c) return { kind: 'event', name: c.event };
  if ('coverage' in c) return { kind: 'coverage', coverage: c.coverage };
  if ('elapsed' in c) return { kind: 'elapsed', seconds: c.elapsed };
  if ('all' in c) return { kind: 'all', of: c.all.map(normalizeCondition) };
  return { kind: 'any', of: c.any.map(normalizeCondition) };
}

/** What a condition may observe. Deliberately minimal: no access to future graph nodes. */
export interface ConditionContext {
  /** Events observed since the scope (node or action) began. */
  hasEvent(name: string): boolean;
  /** Seconds since the scope began. */
  elapsed: number;
  /** Coverage the defense is actually playing, as exposed by the defense runtime. */
  coverage: CoverageName | null;
}

export function evaluateCondition(c: Condition, ctx: ConditionContext): boolean {
  switch (c.kind) {
    case 'event':
      return ctx.hasEvent(c.name);
    case 'coverage':
      return ctx.coverage === c.coverage;
    case 'elapsed':
      return ctx.elapsed >= c.seconds;
    case 'all':
      return c.of.every((x) => evaluateCondition(x, ctx));
    case 'any':
      return c.of.some((x) => evaluateCondition(x, ctx));
  }
}

export function conditionEvents(c: Condition): string[] {
  if (c.kind === 'event') return [c.name];
  if (c.kind === 'all' || c.kind === 'any') return c.of.flatMap(conditionEvents);
  return [];
}
