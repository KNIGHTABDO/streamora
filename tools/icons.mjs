// Render art/icon.svg to the PNG app icons: node tools/icons.mjs
import puppeteer from 'puppeteer-core';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const svg = readFileSync(new URL('../art/icon.svg', import.meta.url), 'utf8');
const b = await puppeteer.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
const p = await b.newPage();
for (const [name, size, pad] of [['icon-180', 180, 0], ['icon-192', 192, 0], ['icon-512', 512, 0], ['icon-maskable-512', 512, .14]]) {
  await p.setViewport({ width: size, height: size });
  const inner = size * (1 - pad * 2);
  await p.setContent(`<html><body style="margin:0;background:#f3e6cf;display:grid;place-items:center;width:${size}px;height:${size}px">
    <div style="width:${inner}px;height:${inner}px">${svg.replace('<svg ', `<svg width="${inner}" height="${inner}" `)}</div></body></html>`);
  await p.screenshot({ path: fileURLToPath(new URL(`../art/${name}.png`, import.meta.url)) });
}
await b.close(); console.log('icons ok');
