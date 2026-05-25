#!/usr/bin/env node
/**
 * One-time scraper: fetch ~50 Google reviews for Immobiliere Pujol
 * using Puppeteer + headless Chrome. Run via GitHub Actions or locally.
 *
 * Usage: npx puppeteer browsers install chrome && node scripts/scrape-google-reviews.mjs
 */

import puppeteer from 'puppeteer';
import { writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT = join(__dirname, '..', 'public', '_data', 'google-reviews.json');
const PLACE_URL = 'https://www.google.com/maps/place/IMMOBILIERE+PUJOL/@43.2834028,5.3913967,17z/data=!4m8!3m7!1s0x12c9c0b2020b5667:0xb62b09168d6e35dd!8m2!3d43.2834028!4d5.3913967!9m1!1b1!16s%2Fg%2F1pzwkstjl';
const TARGET = 50;

async function main() {
  console.log('Launching browser...');
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--lang=fr-FR'],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'fr-FR,fr;q=0.9' });

  try {
    console.log('Loading Google Maps...');
    await page.goto(PLACE_URL, { waitUntil: 'networkidle2', timeout: 30000 });
    await sleep(4000);

    // Accept cookies consent — Google shows various consent forms
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const consentBtns = await page.$$('button[aria-label*="Tout accepter"], button[aria-label*="Accept all"], form[action*="consent"] button, button[jsname="b3VHJd"]');
        if (consentBtns.length > 0) {
          await consentBtns[0].click();
          console.log(`  Accepted cookies (attempt ${attempt + 1})`);
          await sleep(3000);
        } else {
          break;
        }
      } catch { break; }
    }

    // Debug: take screenshot to see what the page looks like
    await page.screenshot({ path: '/tmp/gmaps-debug.png', fullPage: false });
    console.log('  Debug screenshot saved to /tmp/gmaps-debug.png');

    // Wait for the business panel to load
    await page.waitForSelector('div[role="main"]', { timeout: 10000 }).catch(() => {});
    await sleep(2000);

    // Click the star rating or "X avis" link to open the reviews panel
    let openedReviews = false;
    try {
      // Try clicking the rating stars or review count link
      const reviewLinks = await page.$$('button[jsaction*="reviewChart"], a[href*="lrd"], button[aria-label*="avis"], button[aria-label*="étoile"]');
      if (reviewLinks.length > 0) {
        await reviewLinks[0].click();
        console.log('  Clicked rating/review link');
        openedReviews = true;
        await sleep(3000);
      }
    } catch {}

    // If that didn't work, try scrolling the panel down to find the reviews section
    if (!openedReviews) {
      try {
        // Scroll the side panel to find "Avis" section
        const panel = await page.$('div.m6QErb.DxyBCb, div.m6QErb');
        if (panel) {
          for (let i = 0; i < 10; i++) {
            await page.evaluate(el => el.scrollTop += 500, panel);
            await sleep(500);
          }
          // Look for "Tous les avis" or "All reviews" button
          const allReviewsBtns = await page.$$('button[aria-label*="avis"], a[href*="reviews"], span');
          for (const btn of allReviewsBtns) {
            const text = await btn.evaluate(el => el.textContent);
            if (/tous les avis|all.*review|\d+\s*avis/i.test(text)) {
              await btn.click();
              console.log(`  Clicked: "${text.trim()}"`);
              openedReviews = true;
              await sleep(3000);
              break;
            }
          }
        }
      } catch {}
    }

    // If still not opened, try clicking the tab if visible
    if (!openedReviews) {
      try {
        const tabs = await page.$$('button[role="tab"]');
        for (const tab of tabs) {
          const text = await tab.evaluate(el => el.textContent);
          if (/avis|review/i.test(text)) {
            await tab.click();
            console.log(`  Clicked reviews tab: "${text.trim()}"`);
            openedReviews = true;
            await sleep(3000);
            break;
          }
        }
      } catch {}
    }

    if (!openedReviews) {
      console.log('  WARNING: Could not open reviews panel');
    }

    // Take screenshot after attempting to open reviews
    await page.screenshot({ path: '/tmp/gmaps-reviews.png', fullPage: false });
    console.log('  Reviews panel screenshot saved');

    // Sort by newest
    try {
      const sortBtn = await page.$('button[data-value="Sort"], button[aria-label*="Trier"], button.g88MCb');
      if (sortBtn) {
        await sortBtn.click();
        await sleep(1000);
        const opts = await page.$$('div[role="menuitemradio"], li[role="menuitemradio"]');
        for (const opt of opts) {
          const text = await opt.evaluate(el => el.textContent);
          if (/récent|newest/i.test(text)) {
            await opt.click();
            console.log(`  Sorted by: "${text.trim()}"`);
            await sleep(3000);
            break;
          }
        }
      }
    } catch {}

    // Find scrollable panel and scroll to load reviews
    let scrollable = await page.$('div.m6QErb.DxyBCb');
    if (!scrollable) scrollable = await page.$('div.m6QErb[role="feed"]');
    if (!scrollable) scrollable = await page.$('div.m6QErb');

    // Debug: log what we can find
    const debugInfo = await page.evaluate(() => {
      const el = document.querySelector('div.m6QErb');
      return {
        hasM6QErb: !!el,
        reviewCount: document.querySelectorAll('div[data-review-id]').length,
        bodyText: document.body.innerText.substring(0, 500),
      };
    });
    console.log(`  Debug: m6QErb=${debugInfo.hasM6QErb}, reviews in DOM=${debugInfo.reviewCount}`);
    if (debugInfo.reviewCount === 0) {
      console.log(`  Page text preview: ${debugInfo.bodyText.substring(0, 200)}`);
    }

    if (!scrollable) {
      console.log('  Could not find scrollable reviews panel!');
    } else {
      console.log(`  Scrolling to load ${TARGET} reviews...`);
      let lastCount = 0, stale = 0;

      for (let i = 0; i < 80; i++) {
        await page.evaluate(el => el.scrollTop = el.scrollHeight, scrollable);
        await sleep(1500);

        const count = await page.$$eval('div[data-review-id]', els => els.length);
        if (count >= TARGET) {
          console.log(`  Reached ${count} reviews after ${i + 1} scrolls`);
          break;
        }
        if (count === lastCount) {
          stale++;
          if (stale >= 5) {
            console.log(`  No new reviews after ${stale} scrolls, stopping at ${count}`);
            break;
          }
        } else {
          stale = 0;
          if (count % 10 === 0) console.log(`  Loaded ${count} reviews...`);
        }
        lastCount = count;
      }
    }

    // Expand all "Plus" / "More" buttons
    try {
      const moreButtons = await page.$$('button.w8nwRe, button.M77dve');
      console.log(`  Expanding ${moreButtons.length} "More" buttons...`);
      for (const btn of moreButtons) {
        try { await btn.click(); } catch {}
      }
      await sleep(500);
    } catch {}

    // Extract reviews
    const reviews = await page.$$eval('div[data-review-id]', (els) => {
      return els.map(el => {
        const author = el.querySelector('.d4r55, .WNxzHc')?.textContent?.trim() || '';
        const starEl = el.querySelector('span[role="img"]');
        const ariaLabel = starEl?.getAttribute('aria-label') || '';
        const ratingMatch = ariaLabel.match(/(\d)/);
        const rating = ratingMatch ? parseInt(ratingMatch[1]) : 5;
        const date = el.querySelector('.rsqaWe, .xRkPPb')?.textContent?.trim() || '';
        const text = el.querySelector('.wiI7pd, .review-full-text')?.textContent?.trim() || '';
        return { author, rating, date, text };
      }).filter(r => r.author);
    });

    console.log(`\nExtracted ${reviews.length} reviews`);

    // Get overall rating and count
    let rating = 4.7, reviewCount = 0;
    try {
      const ratingText = await page.$eval('div.fontDisplayLarge, span.fontDisplayLarge', el => el.textContent);
      rating = parseFloat((ratingText || '').replace(',', '.')) || 4.7;
    } catch {}

    try {
      const allText = await page.evaluate(() => document.body.innerText);
      const countMatch = allText.match(/([\d\s,.]+)\s*(?:avis|review)/i);
      if (countMatch) {
        reviewCount = parseInt(countMatch[1].replace(/[\s,.]/g, ''), 10);
      }
    } catch {}

    const withText = reviews.filter(r => r.text);
    const noText = reviews.filter(r => !r.text);
    console.log(`  With text: ${withText.length}`);
    console.log(`  Rating only: ${noText.length}`);
    console.log(`  Overall rating: ${rating}`);
    console.log(`  Total review count: ${reviewCount}`);

    // Write output
    const payload = {
      rating,
      reviewCount: reviewCount || reviews.length,
      reviews: withText.slice(0, TARGET),
      fetchedAt: new Date().toISOString(),
    };

    const dir = dirname(OUTPUT);
    if (!existsSync(dir)) await mkdir(dir, { recursive: true });
    await writeFile(OUTPUT, JSON.stringify(payload, null, 2));
    console.log(`\nWritten ${payload.reviews.length} reviews to ${OUTPUT}`);

  } finally {
    await browser.close();
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

main().catch(e => { console.error(e); process.exit(1); });
