import { useRef } from 'react';
import type { CharacterDefinition, SpriteDirection } from '../domain/characters/definition';
import { STATIC_SPRITE_FILES } from '../rendering/characters/sprite/spriteDirection';
import { toast, useUi } from './store';

const FILE_TO_DIRECTION = Object.fromEntries(
  Object.entries(STATIC_SPRITE_FILES).map(([dir, file]) => [file, dir as SpriteDirection]),
) as Record<string, SpriteDirection>;

/**
 * Swaps how one actor looks (spec §64, Demo D). Only the renderer changes: the play
 * definition, attributes and simulation are untouched.
 */
export function AppearancePicker({ actorId, definition }: { actorId: string; definition: CharacterDefinition }) {
  const appearance = useUi((s) => s.appearance);
  const set = useUi((s) => s.set);
  const glbInput = useRef<HTMLInputElement>(null);
  const spriteInput = useRef<HTMLInputElement>(null);
  const current = appearance[actorId] ?? definition.renderer;
  const setAppearance = (cfg: (typeof appearance)[string]) => set({ appearance: { ...appearance, [actorId]: cfg } });

  const onGlb = (files: FileList | null) => {
    const f = files?.[0];
    if (!f) return;
    setAppearance({ type: 'gltf', url: URL.createObjectURL(f) });
    toast(`Loaded ${f.name}`);
  };

  const onSprites = (files: FileList | null) => {
    if (!files?.length) return;
    const directions: Partial<Record<SpriteDirection, string>> = {};
    for (const f of Array.from(files)) {
      const stem = f.name.replace(/\.[^.]+$/, '').toLowerCase();
      const dir = FILE_TO_DIRECTION[stem] ?? (files.length === 1 ? 'S' : undefined);
      if (dir) directions[dir] = URL.createObjectURL(f);
    }
    if (!Object.keys(directions).length) {
      toast('Name sprite files front.png, front_left.png, left.png, … back.png');
      return;
    }
    setAppearance({ type: 'sprite', mode: 'static', directions });
    toast(`Loaded ${Object.keys(directions).length} sprite view(s)`);
  };

  return (
    <>
      <h3>Appearance (behavior unchanged)</h3>
      <div className="buttons">
        <button className={current.type === 'gltf' && !current.url ? 'on' : ''} onClick={() => setAppearance({ type: 'gltf' })}>
          Humanoid
        </button>
        <button
          className={current.type === 'sprite' && !current.directions ? 'on' : ''}
          onClick={() => setAppearance({ type: 'sprite', mode: 'static', tint: '#f4f1ea' })}
        >
          Sprite
        </button>
        <button className={current.type === 'gltf' && current.url ? 'on' : ''} onClick={() => glbInput.current?.click()}>
          GLB…
        </button>
        <button className={current.type === 'sprite' && current.directions ? 'on' : ''} onClick={() => spriteInput.current?.click()}>
          PNGs…
        </button>
      </div>
      <input ref={glbInput} type="file" accept=".glb,.gltf" hidden onChange={(e) => onGlb(e.target.files)} />
      <input ref={spriteInput} type="file" accept="image/png,image/webp" multiple hidden onChange={(e) => onSprites(e.target.files)} />
    </>
  );
}
