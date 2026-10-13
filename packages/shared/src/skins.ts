/**
 * Cosmetic skins (UI v3): 6 player models x 8 colors, packed into one small integer
 * (`skin = model + color * MODEL_COUNT`) so it can ride the Colyseus state as a single uint8.
 * Purely cosmetic: the server only validates the range, gameplay never reads it.
 */
export const MODEL_COUNT = 6
export const COLOR_COUNT = 8
export const SKIN_COUNT = MODEL_COUNT * COLOR_COUNT

export const MODEL_NAMES = ['Blobby', 'Cuby', 'Zappy', 'Hexo', 'Boo', 'Kitty'] as const
export const COLOR_NAMES = [
  'Bubblegum',
  'Cyan',
  'Lime',
  'Sunny',
  'Grape',
  'Tangerine',
  'Mint',
  'Cherry',
] as const

export function makeSkin(model: number, color: number): number {
  const m = ((Math.trunc(model) % MODEL_COUNT) + MODEL_COUNT) % MODEL_COUNT
  const c = ((Math.trunc(color) % COLOR_COUNT) + COLOR_COUNT) % COLOR_COUNT
  return m + c * MODEL_COUNT
}

export function skinModel(skin: number): number {
  return ((Math.trunc(skin) % MODEL_COUNT) + MODEL_COUNT) % MODEL_COUNT
}

export function skinColor(skin: number): number {
  return Math.floor((((Math.trunc(skin) % SKIN_COUNT) + SKIN_COUNT) % SKIN_COUNT) / MODEL_COUNT)
}
