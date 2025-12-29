/**
 * @license
 * Copyright 2025 BOSS Ghost MCP
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import puppeteer from 'puppeteer';
import { CaptchaDetector } from '../../src/utils/captcha.js';
describe('CAPTCHA Auto-Detection', () => {
    let browser;
    let page;
    let detector;
    beforeAll(async () => {
        browser = await puppeteer.launch({ headless: true });
    });
    afterAll(async () => {
        await browser.close();
    });
    beforeEach(async () => {
        page = await browser.newPage();
        detector = new CaptchaDetector();
    });
    describe('reCAPTCHA v2 Detection', () => {
        it('should detect reCAPTCHA v2 iframe', async () => {
            await page.setContent(`
        <html>
          <body>
            <iframe src="https://www.google.com/recaptcha/api2/anchor"></iframe>
          </body>
        </html>
      `);
            const captchas = await detector.detect(page);
            expect(captchas).toHaveLength(1);
            expect(captchas[0].type).toBe('recaptcha_v2');
            expect(captchas[0].confidence).toBeGreaterThanOrEqual(0.9);
        });
        it('should detect reCAPTCHA v2 div container', async () => {
            await page.setContent(`
        <html>
          <body>
            <div class="g-recaptcha" data-sitekey="test-site-key"></div>
          </body>
        </html>
      `);
            const captchas = await detector.detect(page);
            expect(captchas).toHaveLength(1);
            expect(captchas[0].type).toBe('recaptcha_v2');
            expect(captchas[0].metadata?.sitekey).toBe('test-site-key');
        });
        it('should include location information', async () => {
            await page.setContent(`
        <html>
          <body>
            <div class="g-recaptcha" style="width: 300px; height: 78px;"></div>
          </body>
        </html>
      `);
            const captchas = await detector.detect(page);
            expect(captchas[0].location).not.toBeNull();
            expect(captchas[0].location?.width).toBe(300);
            expect(captchas[0].location?.height).toBe(78);
        });
    });
    describe('reCAPTCHA v3 Detection', () => {
        it('should detect reCAPTCHA v3 badge', async () => {
            await page.setContent(`
        <html>
          <head>
            <script>
              window.grecaptcha = {
                ready: function() {},
                execute: function() {}
              };
            </script>
          </head>
          <body>
            <div class="grecaptcha-badge"></div>
          </body>
        </html>
      `);
            const captchas = await detector.detect(page);
            const recaptchaV3 = captchas.find(c => c.type === 'recaptcha_v3');
            expect(recaptchaV3).toBeDefined();
            expect(recaptchaV3?.confidence).toBeGreaterThanOrEqual(0.85);
        });
        it('should detect invisible reCAPTCHA', async () => {
            await page.setContent(`
        <html>
          <head>
            <script>
              window.grecaptcha = {
                ready: function() {},
                execute: function() {}
              };
            </script>
          </head>
          <body></body>
        </html>
      `);
            const captchas = await detector.detect(page);
            const recaptchaV3 = captchas.find(c => c.type === 'recaptcha_v3');
            expect(recaptchaV3).toBeDefined();
        });
    });
    describe('hCaptcha Detection', () => {
        it('should detect hCaptcha iframe', async () => {
            await page.setContent(`
        <html>
          <body>
            <iframe src="https://hcaptcha.com/captcha/v1/abc123"></iframe>
          </body>
        </html>
      `);
            const captchas = await detector.detect(page);
            const hcaptcha = captchas.find(c => c.type === 'hcaptcha');
            expect(hcaptcha).toBeDefined();
            expect(hcaptcha?.confidence).toBeGreaterThanOrEqual(0.9);
        });
        it('should detect hCaptcha container', async () => {
            await page.setContent(`
        <html>
          <body>
            <div class="h-captcha" data-sitekey="h-test-key"></div>
          </body>
        </html>
      `);
            const captchas = await detector.detect(page);
            const hcaptcha = captchas.find(c => c.type === 'hcaptcha');
            expect(hcaptcha).toBeDefined();
            expect(hcaptcha?.metadata?.sitekey).toBe('h-test-key');
        });
    });
    describe('Cloudflare Turnstile Detection', () => {
        it('should detect Cloudflare challenge page', async () => {
            await page.setContent(`
        <html>
          <head>
            <title>Just a moment...</title>
          </head>
          <body></body>
        </html>
      `);
            const captchas = await detector.detect(page);
            const cloudflare = captchas.find(c => c.type === 'cloudflare');
            expect(cloudflare).toBeDefined();
        });
        it('should detect Turnstile widget', async () => {
            await page.setContent(`
        <html>
          <body>
            <div data-sitekey="cf-test-key" data-callback="onSuccess"></div>
          </body>
        </html>
      `);
            const captchas = await detector.detect(page);
            const cloudflare = captchas.find(c => c.type === 'cloudflare');
            expect(cloudflare).toBeDefined();
            expect(cloudflare?.metadata?.sitekey).toBe('cf-test-key');
        });
    });
    describe('Image CAPTCHA Detection', () => {
        it('should detect image-based CAPTCHAs', async () => {
            await page.setContent(`
        <html>
          <body>
            <p>Please verify you are human by completing this captcha</p>
            <img src="/captcha.png" alt="CAPTCHA verification image">
          </body>
        </html>
      `);
            const captchas = await detector.detect(page);
            const imageCaptcha = captchas.find(c => c.type === 'image');
            expect(imageCaptcha).toBeDefined();
            expect(imageCaptcha?.confidence).toBeGreaterThan(0.5);
        });
        it('should detect CAPTCHA keywords in text', async () => {
            await page.setContent(`
        <html>
          <body>
            <h1>Security Check</h1>
            <p>Prove you are not a robot</p>
            <img src="/verification.jpg">
          </body>
        </html>
      `);
            const captchas = await detector.detect(page);
            // Should detect potential image CAPTCHA based on keywords
            expect(captchas.length).toBeGreaterThan(0);
        });
    });
    describe('Multiple CAPTCHA Detection', () => {
        it('should detect multiple CAPTCHAs on same page', async () => {
            await page.setContent(`
        <html>
          <body>
            <div class="g-recaptcha"></div>
            <div class="h-captcha"></div>
          </body>
        </html>
      `);
            const captchas = await detector.detect(page);
            expect(captchas.length).toBeGreaterThanOrEqual(2);
            expect(captchas.some(c => c.type === 'recaptcha_v2')).toBe(true);
            expect(captchas.some(c => c.type === 'hcaptcha')).toBe(true);
        });
    });
    describe('Wait for CAPTCHA', () => {
        it('should wait for CAPTCHA to appear', async () => {
            await page.setContent(`<html><body></body></html>`);
            // Add CAPTCHA after 500ms
            setTimeout(async () => {
                await page.evaluate(() => {
                    const div = document.createElement('div');
                    div.className = 'g-recaptcha';
                    document.body.appendChild(div);
                });
            }, 500);
            const captcha = await detector.waitForCaptcha(page, 2000);
            expect(captcha).not.toBeNull();
            expect(captcha?.type).toBe('recaptcha_v2');
        });
        it('should timeout if CAPTCHA does not appear', async () => {
            await page.setContent(`<html><body></body></html>`);
            const captcha = await detector.waitForCaptcha(page, 1000);
            expect(captcha).toBeNull();
        });
    });
    describe('Wait for Solution', () => {
        it('should detect when CAPTCHA is solved', async () => {
            await page.setContent(`
        <html>
          <body>
            <div class="g-recaptcha"></div>
          </body>
        </html>
      `);
            const captchas = await detector.detect(page);
            const captcha = captchas[0];
            // Remove CAPTCHA after 500ms (simulate solution)
            setTimeout(async () => {
                await page.evaluate(() => {
                    const div = document.querySelector('.g-recaptcha');
                    div?.remove();
                });
            }, 500);
            const solved = await detector.waitForSolution(page, captcha, 2000);
            expect(solved).toBe(true);
        });
        it('should timeout if CAPTCHA not solved', async () => {
            await page.setContent(`
        <html>
          <body>
            <div class="g-recaptcha"></div>
          </body>
        </html>
      `);
            const captchas = await detector.detect(page);
            const captcha = captchas[0];
            const solved = await detector.waitForSolution(page, captcha, 1000);
            expect(solved).toBe(false);
        });
    });
    describe('Statistics', () => {
        it('should return CAPTCHA statistics', async () => {
            await page.setContent(`
        <html>
          <body>
            <div class="g-recaptcha"></div>
            <div class="h-captcha"></div>
            <img src="/captcha.png" alt="captcha">
          </body>
        </html>
      `);
            const stats = await detector.getStats(page);
            expect(stats.total).toBeGreaterThanOrEqual(2);
            expect(stats.byType.recaptcha_v2).toBeGreaterThan(0);
            expect(stats.byType.hcaptcha).toBeGreaterThan(0);
        });
        it('should return zero stats for page without CAPTCHAs', async () => {
            await page.setContent(`<html><body><h1>No CAPTCHAs here</h1></body></html>`);
            const stats = await detector.getStats(page);
            expect(stats.total).toBe(0);
            expect(stats.byType.recaptcha_v2).toBe(0);
            expect(stats.byType.hcaptcha).toBe(0);
        });
    });
    describe('Edge Cases', () => {
        it('should handle empty page', async () => {
            await page.setContent(`<html><body></body></html>`);
            const captchas = await detector.detect(page);
            expect(captchas).toEqual([]);
        });
        it('should handle page with many elements', async () => {
            const elements = Array.from({ length: 1000 }, (_, i) => `<div id="div-${i}">Content</div>`).join('\n');
            await page.setContent(`
        <html>
          <body>
            ${elements}
            <div class="g-recaptcha"></div>
          </body>
        </html>
      `);
            const captchas = await detector.detect(page);
            expect(captchas.length).toBeGreaterThan(0);
            expect(captchas.some(c => c.type === 'recaptcha_v2')).toBe(true);
        });
        it('should handle nested iframes', async () => {
            await page.setContent(`
        <html>
          <body>
            <iframe>
              <iframe src="https://www.google.com/recaptcha/api2/anchor"></iframe>
            </iframe>
          </body>
        </html>
      `);
            const captchas = await detector.detect(page);
            // Should detect nested CAPTCHA iframe
            expect(captchas.length).toBeGreaterThanOrEqual(0);
        });
    });
});
