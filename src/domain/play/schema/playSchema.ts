import { SEMANTIC_SPOTS } from '../../court/spots';
import { ACTION_ALIASES, PLAY_FORMAT_VERSION, SEMANTIC_ACTIONS } from './playDefinition';

const SPOTS = Object.keys(SEMANTIC_SPOTS);
const IDENT = '^[a-z][a-z0-9_]*$';
const COVERAGES = ['man', 'go_over', 'under', 'drop', 'switch', 'hedge'];

/**
 * JSON Schema for play format v0.1 (spec rule 10). Validates the authoring format,
 * shorthands included; cross-references are checked by validatePlaySemantics().
 */
export const PLAY_SCHEMA_V0_1 = {
  $id: `https://ato.local/schemas/play/${PLAY_FORMAT_VERSION}.json`,
  type: 'object',
  required: ['version', 'play', 'actors', 'setup', 'graph'],
  additionalProperties: false,
  properties: {
    version: { const: PLAY_FORMAT_VERSION },
    play: {
      type: 'object',
      required: ['id', 'name'],
      additionalProperties: false,
      properties: {
        id: { type: 'string', pattern: '^[a-z0-9][a-z0-9_-]*$' },
        name: { type: 'string', minLength: 1 },
        description: { type: 'string' },
        start: { type: 'string', pattern: IDENT },
      },
    },
    court: {
      type: 'object',
      additionalProperties: false,
      properties: { type: { enum: ['nba_half'] } },
    },
    actors: {
      type: 'object',
      minProperties: 1,
      maxProperties: 10,
      propertyNames: { pattern: IDENT },
      additionalProperties: { $ref: '#/definitions/actor' },
    },
    setup: {
      type: 'object',
      propertyNames: { pattern: IDENT },
      additionalProperties: { $ref: '#/definitions/setup' },
    },
    graph: {
      type: 'object',
      minProperties: 1,
      propertyNames: { pattern: IDENT },
      additionalProperties: { $ref: '#/definitions/node' },
    },
    simulation: {
      type: 'object',
      additionalProperties: false,
      properties: {
        seed: { type: 'integer', minimum: 0 },
        shot_outcome: {
          oneOf: [
            { type: 'object', required: ['mode'], additionalProperties: false, properties: { mode: { const: 'simulated' } } },
            {
              type: 'object',
              required: ['mode', 'result'],
              additionalProperties: false,
              properties: { mode: { const: 'forced' }, result: { enum: ['make', 'miss'] } },
            },
          ],
        },
        defense: {
          type: 'object',
          additionalProperties: false,
          properties: { coverage: { enum: COVERAGES }, deny: { type: 'boolean' } },
        },
      },
    },
  },
  definitions: {
    vec2: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 },
    spot: { enum: SPOTS },
    position: {
      oneOf: [
        { $ref: '#/definitions/spot' },
        {
          type: 'object',
          required: ['x', 'z'],
          additionalProperties: false,
          properties: { x: { type: 'number' }, z: { type: 'number' } },
        },
        {
          type: 'object',
          required: ['spot'],
          additionalProperties: false,
          properties: { spot: { $ref: '#/definitions/spot' }, offset: { $ref: '#/definitions/vec2' } },
        },
      ],
    },
    target: {
      anyOf: [
        { $ref: '#/definitions/position' },
        { type: 'string', pattern: '^[a-z][a-z0-9_]*(\\.[a-z][a-z0-9_]*)?$' },
        {
          type: 'object',
          required: ['relative_to'],
          additionalProperties: false,
          properties: {
            relative_to: { type: 'string', pattern: IDENT },
            purpose: { enum: ['screen'] },
            side: { enum: ['left', 'right', 'auto'] },
            offset: { $ref: '#/definitions/vec2' },
          },
        },
      ],
    },
    condition: {
      oneOf: [
        { type: 'string', minLength: 1 },
        { type: 'object', required: ['event'], additionalProperties: false, properties: { event: { type: 'string', minLength: 1 } } },
        { type: 'object', required: ['coverage'], additionalProperties: false, properties: { coverage: { enum: COVERAGES } } },
        { type: 'object', required: ['elapsed'], additionalProperties: false, properties: { elapsed: { type: 'number', minimum: 0 } } },
        {
          type: 'object',
          required: ['all'],
          additionalProperties: false,
          properties: { all: { type: 'array', minItems: 1, items: { $ref: '#/definitions/condition' } } },
        },
        {
          type: 'object',
          required: ['any'],
          additionalProperties: false,
          properties: { any: { type: 'array', minItems: 1, items: { $ref: '#/definitions/condition' } } },
        },
      ],
    },
    actor: {
      type: 'object',
      required: ['character', 'team'],
      additionalProperties: false,
      properties: {
        character: { type: 'string', minLength: 1 },
        team: { enum: ['offense', 'defense'] },
        role: { type: 'string' },
        assignment: { type: 'string', pattern: IDENT },
      },
    },
    setup: {
      type: 'object',
      additionalProperties: false,
      properties: {
        position: { $ref: '#/definitions/position' },
        possession: { const: 'ball' },
        facing: { anyOf: [{ type: 'number' }, { $ref: '#/definitions/spot' }] },
        relative_to: { type: 'string', pattern: IDENT },
        defensive_position: { enum: ['on_ball', 'matchup', 'help'] },
      },
    },
    action: {
      type: 'object',
      required: ['actor', 'action'],
      additionalProperties: false,
      properties: {
        actor: { type: 'string', pattern: IDENT },
        action: { enum: [...SEMANTIC_ACTIONS, ...Object.keys(ACTION_ALIASES)] },
        to: { $ref: '#/definitions/target' },
        via: { $ref: '#/definitions/target' },
        target: { type: 'string', pattern: IDENT },
        type: { type: 'string' },
        side: { enum: ['left', 'right', 'auto'] },
        angle: { anyOf: [{ const: 'auto' }, { type: 'number' }] },
        hold_until: { $ref: '#/definitions/condition' },
        duration: { type: 'number', minimum: 0 },
        speed: { enum: ['walk', 'jog', 'run', 'sprint'] },
        when: { $ref: '#/definitions/condition' },
        for: { type: 'string', pattern: IDENT },
        around: { type: 'string', pattern: IDENT },
        close_to: { $ref: '#/definitions/target' },
        path: {
          type: 'object',
          required: ['mode'],
          additionalProperties: false,
          properties: {
            mode: { enum: ['auto', 'override'] },
            points: { type: 'array', items: { $ref: '#/definitions/vec2' } },
          },
        },
      },
      allOf: [
        { if: { properties: { action: { const: 'move' } } }, then: { required: ['to'] } },
        { if: { properties: { action: { enum: ['pass', 'lob', 'alley_oop', 'alleyOop', 'handoff'] } } }, then: { required: ['target'] } },
        { if: { properties: { action: { enum: ['screen', 'pin_down', 'pinDown', 'flare_screen', 'flareScreen'] } } }, then: { anyOf: [{ required: ['target'] }, { required: ['for'] }] } },
        { if: { properties: { action: { enum: ['cut', 'flare', 'v_cut', 'vCut'] } } }, then: { required: ['to'] } },
        { if: { properties: { action: { const: 'curl' } } }, then: { required: ['around'] } },
        { if: { properties: { action: { const: 'elevator' } } }, then: { required: ['for', 'to', 'close_to'] } },
        { if: { properties: { action: { const: 'drive' } } }, then: { anyOf: [{ required: ['to'] }, { required: ['via'] }] } },
        { if: { properties: { action: { const: 'wait' } } }, then: { anyOf: [{ required: ['duration'] }, { required: ['when'] }, { required: ['hold_until'] }] } },
      ],
    },
    node: {
      type: 'object',
      additionalProperties: false,
      properties: {
        actions: { type: 'array', items: { $ref: '#/definitions/action' } },
        player_options: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            required: ['id', 'action'],
            additionalProperties: false,
            properties: {
              id: { type: 'string', pattern: IDENT },
              label: { type: 'string' },
              action: { $ref: '#/definitions/action' },
            },
          },
        },
        transitions: {
          type: 'array',
          items: {
            type: 'object',
            required: ['when', 'to'],
            additionalProperties: false,
            properties: { when: { $ref: '#/definitions/condition' }, to: { type: 'string', pattern: IDENT } },
          },
        },
      },
    },
  },
} as const;
