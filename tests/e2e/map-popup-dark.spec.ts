import { test, expect } from '@playwright/test';

/**
 * Dark-mode map popups (user feedback): maplibre-gl.css paints popups white with NO text color, so the
 * theme's token rules must OUT-SPECIFY it (`.maplibregl-popup .maplibregl-popup-content`) — at equal
 * specificity maplibre's sheet loads later and its white background wins while the text goes dark-mode
 * light → white-on-white. This asserts the computed styles of a popup subtree on a page that bundles
 * maplibre-gl.css (/parks/[code] renders MiniMap), in both color modes.
 */
async function popupStyles(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const wrap = document.createElement('div');
    wrap.className = 'maplibregl-popup maplibregl-popup-anchor-bottom';
    const content = document.createElement('div');
    content.className = 'maplibregl-popup-content';
    content.textContent = 'probe';
    wrap.appendChild(content);
    document.body.appendChild(wrap);
    const s = getComputedStyle(content);
    const out = { bg: s.backgroundColor, color: s.color };
    wrap.remove();
    return out;
  });
}

const luminance = (rgb: string): number => {
  const [r, g, b] = (rgb.match(/\d+/g) ?? ['0', '0', '0']).map(Number);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
};

test('map popups are dark-on-light in light mode', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('theme', 'light'));
  await page.goto('/parks/yell');
  const { bg, color } = await popupStyles(page);
  expect(luminance(bg)).toBeGreaterThan(0.6); // light panel
  expect(luminance(color)).toBeLessThan(0.5); // dark text
});

test('map popups are light-on-dark in dark mode (the reported bug)', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('theme', 'dark'));
  await page.goto('/parks/yell');
  const { bg, color } = await popupStyles(page);
  expect(bg).not.toBe('rgb(255, 255, 255)'); // maplibre's default must not win
  expect(luminance(bg)).toBeLessThan(0.4); // dark panel
  expect(luminance(color)).toBeGreaterThan(0.5); // light text
});
