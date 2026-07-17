const CAT_HEAD_PATH =
  "M13.3 17.7 11 8.8l8.8 4.8a17.8 17.8 0 0 1 8.4 0L37 8.8l-2.3 8.9c3 2.9 4.7 6.8 4.7 11 0 8-6.8 13.2-15.4 13.2S8.6 36.7 8.6 28.7c0-4.2 1.7-8.1 4.7-11Z";
const CAT_ORBIT_PATH =
  "M5.2 33.5c4.1 5.8 11.5 9.2 19.8 8.6 9.2-.6 16.4-6 18.1-12.9";

/** Render the reusable, CSS-themed Orbit cat mark. */
export function renderOrbitMark(className: string): string {
  return `<svg class="orbit-mark ${className}" viewBox="0 0 48 48" fill="none" aria-hidden="true" focusable="false">
    <path class="orbit-cat-orbit" d="${CAT_ORBIT_PATH}" />
    <path class="orbit-cat-head" d="${CAT_HEAD_PATH}" />
    <circle class="orbit-cat-eye" cx="18.5" cy="27" r="1.35" />
    <circle class="orbit-cat-eye" cx="29.5" cy="27" r="1.35" />
    <path class="orbit-cat-face" d="M24 30.5v2.1m-3 1c1.7 1.8 4.3 1.8 6 0M14.8 31.1l-5.4-1.2m5.5 4-5.2 1.4m23.4-4.2 5.4-1.2m-5.4 4 5.2 1.4" />
    <circle class="orbit-cat-satellite" cx="38.4" cy="13.3" r="3" />
  </svg>`;
}

/** Standalone favicon asset using the same cat geometry and brand colors. */
export const WEB_UI_FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" fill="none">
  <rect x="2" y="2" width="44" height="44" rx="13" fill="#f3f6f5" stroke="#d8e0de" />
  <path d="${CAT_ORBIT_PATH}" stroke="#8ca3ad" stroke-width="2" stroke-linecap="round" />
  <path d="${CAT_HEAD_PATH}" fill="#e8f0f1" stroke="#5f7b89" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />
  <circle cx="18.5" cy="27" r="1.35" fill="#425d69" />
  <circle cx="29.5" cy="27" r="1.35" fill="#425d69" />
  <path d="M24 30.5v2.1m-3 1c1.7 1.8 4.3 1.8 6 0" stroke="#5f7b89" stroke-width="1.5" stroke-linecap="round" />
  <circle cx="38.4" cy="13.3" r="3" fill="#d97972" />
</svg>`;
