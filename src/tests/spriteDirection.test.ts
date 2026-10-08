import { describe, expect, it } from 'vitest';
import { spriteDirection } from '../rendering/characters/sprite/spriteDirection';

const at = { x: 0, z: 0 };
const cam = { x: 0, z: 10 }; // camera on +z looking toward -z; screen-right is +x

describe('spriteDirection', () => {
  it('shows the front when the character faces the camera', () => {
    expect(spriteDirection(0, at, cam)).toBe('S'); // facing +z
  });
  it('shows the back when facing away from the camera', () => {
    expect(spriteDirection(Math.PI, at, cam)).toBe('N');
  });
  it('shows the right profile when facing screen-right', () => {
    expect(spriteDirection(Math.PI / 2, at, cam)).toBe('E'); // facing +x
    expect(spriteDirection(-Math.PI / 2, at, cam)).toBe('W');
  });
  it('handles diagonals', () => {
    expect(spriteDirection(Math.PI / 4, at, cam)).toBe('SE');
    expect(spriteDirection((3 * Math.PI) / 4, at, cam)).toBe('NE');
    expect(spriteDirection(-Math.PI / 4, at, cam)).toBe('SW');
  });
  it('depends on camera position, not only on world facing', () => {
    // Same world facing (+x), camera now on the +x side: character faces the camera.
    expect(spriteDirection(Math.PI / 2, at, { x: 10, z: 0 })).toBe('S');
  });
});
