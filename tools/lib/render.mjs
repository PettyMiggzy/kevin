// SVG -> PNG via headless Chromium (playwright-core + the preinstalled browser).
import { chromium } from 'playwright-core';
import { writeFile } from 'node:fs/promises';

export async function withBrowser(fn) {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--force-color-profile=srgb', '--disable-lcd-text', '--no-sandbox'],
  });
  try {
    return await fn(browser);
  } finally {
    await browser.close();
  }
}

/** Render an SVG string to a PNG file at an exact pixel size. */
export async function svgToPng(browser, svg, outPath, width, height, { background = 'transparent' } = {}) {
  const page = await browser.newPage({
    viewport: { width: Math.ceil(width), height: Math.ceil(height) },
    deviceScaleFactor: 1,
  });
  const data = 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
  await page.setContent(
    `<style>html,body{margin:0;padding:0;background:${background};}
     img{display:block;width:${width}px;height:${height}px;image-rendering:pixelated;}</style>
     <img src="${data}">`,
    { waitUntil: 'load' }
  );
  const buf = await page.screenshot({ omitBackground: background === 'transparent' });
  await writeFile(outPath, buf);
  await page.close();
  return outPath;
}

/** Render an arbitrary HTML string to PNG (used for contact sheets and video frames). */
export async function htmlToPng(browser, html, outPath, width, height, { deviceScaleFactor = 1 } = {}) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor });
  await page.setContent(html, { waitUntil: 'load' });
  await page.screenshot({ path: outPath });
  await page.close();
  return outPath;
}

/** Lay out many SVG strings in a grid and screenshot the lot. */
export async function contactSheet(browser, svgs, outPath, { cell = 200, cols = 4, bg = '#111', labels = [] } = {}) {
  const rows = Math.ceil(svgs.length / cols);
  const items = svgs
    .map((s, i) => {
      const src = 'data:image/svg+xml;base64,' + Buffer.from(s).toString('base64');
      const label = labels[i] ? `<div class="l">${labels[i]}</div>` : '';
      return `<div class="c"><img src="${src}">${label}</div>`;
    })
    .join('');
  const html = `<style>
    body{margin:0;background:${bg};display:grid;grid-template-columns:repeat(${cols},${cell}px);font-family:monospace}
    .c{position:relative}
    img{width:${cell}px;height:${cell}px;display:block}
    .l{position:absolute;left:0;bottom:0;right:0;background:#000c;color:#0f0;font-size:11px;padding:2px 4px}
  </style>${items}`;
  return htmlToPng(browser, html, outPath, cell * cols, cell * rows + (labels.length ? 0 : 0));
}
