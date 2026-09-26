// Fresh visitor (no storage) lands on a URL: prints what renders.
import puppeteer from 'puppeteer-core';
const url = process.argv[2];
const b = await puppeteer.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
const p = await b.newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.goto(url, { waitUntil: 'networkidle2' });
await new Promise(r => setTimeout(r, 1500));
console.log(await p.evaluate(() => location.hash + ' | ' + document.querySelector('#app').innerText.slice(0, 80).replace(/\s+/g, ' ')), errs.join('\n') || 'no errors');
await b.close();
