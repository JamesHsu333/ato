import Ajv, { type ErrorObject } from 'ajv';
import { parse as parseYaml, stringify as stringifyYaml, YAMLParseError } from 'yaml';
import { BUILTIN_CHARACTERS } from '../../characters/builtins';
import { SEMANTIC_SPOTS } from '../../court/spots';
import { PLAY_SCHEMA_V0_1 } from './playSchema';
import type { ActionDef, ConditionDef, PlayDefinition, TargetDef } from './playDefinition';

export interface PlayIssue {
  path: string;
  message: string;
}

export type ParseResult =
  | { ok: true; play: PlayDefinition; warnings: PlayIssue[] }
  | { ok: false; errors: PlayIssue[] };

const ajv = new Ajv({ allErrors: true, strict: true, strictRequired: false, allowUnionTypes: true });
const validateSchema = ajv.compile(PLAY_SCHEMA_V0_1);

const ACTOR_POINTS = new Set(['center', 'right_shoulder', 'left_shoulder', 'front', 'back']);

/** Parses YAML (a superset of JSON) or JSON text and fully validates it. */
export function parsePlayText(text: string): ParseResult {
  let data: unknown;
  try {
    data = parseYaml(text, { prettyErrors: true });
  } catch (e) {
    const msg = e instanceof YAMLParseError ? e.message : String(e);
    return { ok: false, errors: [{ path: '', message: `YAML syntax: ${msg}` }] };
  }
  return validatePlay(data);
}

export function validatePlay(data: unknown): ParseResult {
  if (!validateSchema(data)) return { ok: false, errors: schemaIssues(validateSchema.errors ?? []) };
  const play = data as PlayDefinition;
  const { errors, warnings } = validatePlaySemantics(play);
  return errors.length ? { ok: false, errors } : { ok: true, play, warnings };
}

export function serializePlay(play: PlayDefinition, format: 'yaml' | 'json'): string {
  return format === 'json' ? JSON.stringify(play, null, 2) + '\n' : stringifyYaml(play, { lineWidth: 0 });
}

function toPath(instancePath: string): string {
  return instancePath
    .split('/')
    .filter(Boolean)
    .map((seg, i) => (/^\d+$/.test(seg) ? `[${seg}]` : i === 0 ? seg : `.${seg}`))
    .join('');
}

/** Turns Ajv output into a short list of readable issues (oneOf noise collapsed). */
function schemaIssues(errors: ErrorObject[]): PlayIssue[] {
  const out: PlayIssue[] = [];
  const seen = new Set<string>();
  // Prefer the deepest errors; parents of a failing child mostly repeat it.
  const maxDepth = new Map<string, number>();
  for (const e of errors) {
    const p = toPath(e.instancePath);
    maxDepth.set(p, Math.max(maxDepth.get(p) ?? 0, e.schemaPath.split('/').length));
  }
  for (const e of errors) {
    if (e.keyword === 'oneOf' || e.keyword === 'anyOf' || e.keyword === 'if') continue;
    const path = toPath(e.instancePath);
    let message = e.message ?? 'invalid';
    if (e.keyword === 'additionalProperties') message = `unknown property "${(e.params as { additionalProperty: string }).additionalProperty}"`;
    if (e.keyword === 'enum') message = `must be one of: ${(e.params as { allowedValues: unknown[] }).allowedValues.join(', ')}`;
    if (e.keyword === 'const') message = `must be ${JSON.stringify((e.params as { allowedValue: unknown }).allowedValue)}`;
    if (e.keyword === 'minProperties') message = `needs at least ${(e.params as { limit: number }).limit} entry`;
    if (e.keyword === 'maxProperties') message = `allows at most ${(e.params as { limit: number }).limit} entries`;
    if (e.keyword === 'required') message = `missing required property "${(e.params as { missingProperty: string }).missingProperty}"`;
    const key = `${path}|${message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ path, message });
  }
  if (!out.length && errors.length) out.push({ path: toPath(errors[0].instancePath), message: errors[0].message ?? 'invalid' });
  return out.slice(0, 12);
}

/** Cross-reference checks the JSON Schema cannot express. */
export function validatePlaySemantics(
  play: PlayDefinition,
  characters: Record<string, unknown> = BUILTIN_CHARACTERS,
): { errors: PlayIssue[]; warnings: PlayIssue[] } {
  const errors: PlayIssue[] = [];
  const warnings: PlayIssue[] = [];
  const err = (path: string, message: string) => errors.push({ path, message });
  const actors = play.actors;
  const actorIds = new Set(Object.keys(actors));
  const team = (id: string) => actors[id]?.team;

  for (const t of ['offense', 'defense'] as const) {
    const n = Object.values(actors).filter((a) => a.team === t).length;
    if (n > 5) err('actors', `at most 5 ${t} players (found ${n})`);
  }
  for (const [id, a] of Object.entries(actors)) {
    if (!(a.character in characters)) err(`actors.${id}.character`, `unknown character "${a.character}"`);
    if (a.assignment !== undefined) {
      if (a.team !== 'defense') err(`actors.${id}.assignment`, 'only defenders have assignments');
      else if (!actorIds.has(a.assignment)) err(`actors.${id}.assignment`, `unknown actor "${a.assignment}"`);
      else if (team(a.assignment) !== 'offense') err(`actors.${id}.assignment`, `"${a.assignment}" is not an offensive player`);
    }
  }

  let holders = 0;
  for (const [id, s] of Object.entries(play.setup)) {
    const path = `setup.${id}`;
    if (!actorIds.has(id)) {
      err(path, `setup for unknown actor "${id}"`);
      continue;
    }
    if (s.possession === 'ball') {
      holders++;
      if (team(id) !== 'offense') err(`${path}.possession`, 'only the offense can start with the ball');
    }
    if (s.relative_to !== undefined && !actorIds.has(s.relative_to)) err(`${path}.relative_to`, `unknown actor "${s.relative_to}"`);
    if (!s.position && !s.relative_to) err(path, 'needs a position or relative_to');
  }
  for (const id of actorIds) if (!(id in play.setup)) err(`setup`, `missing setup for actor "${id}"`);
  if (holders > 1) err('setup', 'only one actor can start with the ball');

  const nodes = Object.keys(play.graph);
  const start = play.play.start ?? (play.graph.start ? 'start' : nodes[0]);
  if (!(start in play.graph)) err('play.start', `start node "${start}" does not exist`);

  const checkTarget = (path: string, t: TargetDef | undefined) => {
    if (t === undefined || typeof t !== 'string') {
      if (t && typeof t === 'object' && 'relative_to' in t && !actorIds.has(t.relative_to)) err(`${path}.relative_to`, `unknown actor "${t.relative_to}"`);
      return;
    }
    if (t in SEMANTIC_SPOTS) return;
    const [actor, point] = t.split('.');
    if (!actorIds.has(actor)) err(path, `"${t}" is neither a court spot nor an actor`);
    else if (point !== undefined && !ACTOR_POINTS.has(point)) err(path, `unknown point "${point}" (use ${[...ACTOR_POINTS].join(', ')})`);
  };
  const checkCondition = (path: string, c: ConditionDef | undefined) => {
    if (c === undefined) return;
    const name = typeof c === 'string' ? c : 'event' in c ? c.event : null;
    if (name !== null) {
      const head = name.split('.')[0];
      if (name.includes('.') && !actorIds.has(head) && !['screen', 'shot', 'ball', 'pass', 'play'].includes(head)) {
        warnings.push({ path, message: `event "${name}" does not name a known actor` });
      }
    } else if (typeof c === 'object' && 'all' in c) c.all.forEach((x, i) => checkCondition(`${path}.all[${i}]`, x));
    else if (typeof c === 'object' && 'any' in c) c.any.forEach((x, i) => checkCondition(`${path}.any[${i}]`, x));
  };
  const checkAction = (path: string, a: ActionDef) => {
    if (!actorIds.has(a.actor)) {
      err(`${path}.actor`, `unknown actor "${a.actor}"`);
      return;
    }
    checkTarget(`${path}.to`, a.to);
    checkTarget(`${path}.via`, a.via);
    checkTarget(`${path}.close_to`, a.close_to);
    for (const key of ['for', 'around'] as const) {
      const ref = a[key];
      if (ref === undefined) continue;
      if (!actorIds.has(ref)) err(`${path}.${key}`, `unknown actor "${ref}"`);
      else if (team(ref) !== team(a.actor)) err(`${path}.${key}`, `"${ref}" must be a teammate`);
    }
    checkCondition(`${path}.hold_until`, a.hold_until);
    checkCondition(`${path}.when`, a.when);
    if (a.target !== undefined) {
      if (!actorIds.has(a.target)) err(`${path}.target`, `unknown actor "${a.target}"`);
      else if (['pass', 'lob', 'alley_oop', 'alleyOop', 'handoff'].includes(a.action) && team(a.target) !== team(a.actor))
        err(`${path}.target`, 'passes go to a teammate');
      else if (['screen', 'pin_down', 'pinDown', 'flare_screen', 'flareScreen', 'elevator'].includes(a.action) && team(a.target) === team(a.actor))
        err(`${path}.target`, 'a screen targets an opposing defender');
    }
  };

  const reachable = new Set<string>([start]);
  for (const [nid, node] of Object.entries(play.graph)) {
    node.actions?.forEach((a, i) => checkAction(`graph.${nid}.actions[${i}]`, a));
    node.player_options?.forEach((o, i) => checkAction(`graph.${nid}.player_options[${i}].action`, o.action));
    node.transitions?.forEach((t, i) => {
      checkCondition(`graph.${nid}.transitions[${i}].when`, t.when);
      if (!(t.to in play.graph)) err(`graph.${nid}.transitions[${i}].to`, `unknown node "${t.to}"`);
      reachable.add(t.to);
    });
  }
  for (const n of nodes) if (!reachable.has(n)) warnings.push({ path: `graph.${n}`, message: 'node is not reachable from the start node' });
  return { errors, warnings };
}
