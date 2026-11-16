import type { SpellId } from '../engine/index.ts';

const frostArms = [0, 60, 120, 180, 240, 300]
  .map((a) => `<g transform="rotate(${a} 12 12)"><path d="M12 12V2.5M9.6 5L12 7.4 14.4 5"/></g>`)
  .join('');

const PATHS = {
  bolt: '<path d="M3 21l7.5-7.5M5.5 13.5l-2 .8M10.5 18.5l-.8 2"/><circle cx="15" cy="9" r="5"/><path d="M15 6.2v5.6M12.2 9h5.6"/>',
  wall: '<rect x="3" y="5" width="18" height="14" rx="1.5"/><path d="M3 9.7h18M3 14.3h18M9 5v4.7M15 5v4.7M6 9.7v4.6M12 9.7v4.6M18 9.7v4.6M9 14.3V19M15 14.3V19"/>',
  shatter: '<path d="M3 5h7.5L9 9l2.5 2.5-2 3 1 4.5H3z"/><path d="M14 5h7v14h-5.5l1.5-4.5-2-3 2-2.5z"/>',
  thundercloud: '<path d="M6.5 14h11a3.5 3.5 0 0 0 .4-6.98A5.5 5.5 0 0 0 7.3 6.4 3.8 3.8 0 0 0 6.5 14z"/><path d="M13 14l-3 4h3.5l-2.5 4"/>',
  blink: '<path d="M4 20c2-8 7.5-12 13-12.5" stroke-dasharray="2 3"/><path d="M18 2.5l1.1 2.9 2.9 1.1-2.9 1.1L18 10.5l-1.1-2.9L14 6.5l2.9-1.1z"/>',
  gust: '<path d="M3 8h11a3 3 0 1 0-3-3"/><path d="M3 12h15a3 3 0 1 1-3 3"/><path d="M3 16h7"/>',
  frost: frostArms,
  siphon: '<path d="M12 3c3 4 6 7.5 6 11a6 6 0 0 1-12 0c0-3.5 3-7 6-11z"/><path d="M12 9.5v6M9.5 13L12 15.5 14.5 13"/>',
  move: '<path d="M12 3v18M3 12h18M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3"/>',
  pass: '<path d="M6 3h12M6 21h12M7 3v2a5 5 0 0 0 2.5 4.3L12 12l2.5-2.7A5 5 0 0 0 17 5V3M7 21v-2a5 5 0 0 1 2.5-4.3L12 12l2.5 2.7A5 5 0 0 1 17 19v2"/>',
  star: '<path d="M12 2.5l2.2 6.3 6.3 2.2-6.3 2.2L12 19.5l-2.2-6.3L3.5 11l6.3-2.2z"/>',
  zap: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
  storm: '<circle cx="12" cy="12" r="2.6"/><path d="M12 9.4c0-4 3.6-6.4 8-5.4-.6 3.6-2.6 6-5.4 7.2M12 14.6c0 4-3.6 6.4-8 5.4.6-3.6 2.6-6 5.4-7.2"/>',
} satisfies Record<SpellId | 'move' | 'pass' | 'star' | 'zap' | 'storm', string>;

export type IconName = keyof typeof PATHS;

export function icon(name: IconName, className = 'icon'): string {
  return `<svg class="${className}" viewBox="0 0 24 24" aria-hidden="true">${PATHS[name]}</svg>`;
}

export const WIZARD_SVG = `
<svg class="wizard" viewBox="0 0 64 64" aria-hidden="true">
  <ellipse class="w-shadow" cx="32" cy="57" rx="17" ry="4"/>
  <path class="w-staff" d="M47.5 21L50.5 56"/>
  <path class="w-robe" d="M23 33h18l8 22q-17 4-34 0z"/>
  <path class="w-trim" d="M15 55q17 4 34 0"/>
  <circle class="w-face" cx="32" cy="30" r="6"/>
  <circle class="w-eye" cx="29.6" cy="30.6" r="0.9"/>
  <circle class="w-eye" cx="34.4" cy="30.6" r="0.9"/>
  <path class="w-beard" d="M26.5 32q5.5 15 11 0q-5.5 3-11 0z"/>
  <path class="w-hat" d="M18 26q14-5 28 0q-7-4-9-12q-2-7 3-11q-9 1-12 11q-2 7-10 12z"/>
  <ellipse class="w-brim" cx="32" cy="25.5" rx="15" ry="3.5"/>
  <path class="w-star" d="M31 11.5l1.2 2.6 2.6 1.2-2.6 1.2-1.2 2.6-1.2-2.6-2.6-1.2 2.6-1.2z"/>
  <circle class="w-orb" cx="47.2" cy="18.5" r="3.4"/>
</svg>`;

export const CLOUD_SVG = `
<svg class="cloud" viewBox="0 0 64 64" aria-hidden="true">
  <path class="c-bolt" d="M33 36l-7 12h7l-4 11 12-15h-7l4-8z"/>
  <path class="c-body" d="M18 40a9 9 0 0 1 1-17.9A13 13 0 0 1 44 19a10.5 10.5 0 0 1 2 21z"/>
</svg>`;
