/**
 * @license
 * Copyright 2025 BOSS Ghost MCP Team
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert';
import { describe, it } from 'node:test';
import { DomExtractor } from '../../../src/utils/extraction/dom-extractor.js';
import { zod } from '../../../src/third_party/index.js';
import { html, withMcpContext } from '../../utils.js';
describe('DomExtractor', () => {
    describe('extract', () => {
        it('should extract string fields using common patterns', async () => {
            await withMcpContext(async (_response, context) => {
                const page = context.getSelectedPage();
                await page.setContent(html `
          <main>
            <h1>Product Title</h1>
            <p class="description">This is a great product</p>
            <span class="price">$99.99</span>
          </main>
        `);
                const schema = zod.object({
                    title: zod.string(),
                    description: zod.string(),
                });
                const extractor = new DomExtractor();
                const result = await extractor.extract(page, schema);
                assert.equal(result.title, 'Product Title');
                assert.equal(result.description, 'This is a great product');
            });
        });
        it('should extract number fields from price strings', async () => {
            await withMcpContext(async (_response, context) => {
                const page = context.getSelectedPage();
                await page.setContent(html `
          <main>
            <span itemprop="price">$1,234.56</span>
          </main>
        `);
                const schema = zod.object({
                    price: zod.number(),
                });
                const extractor = new DomExtractor();
                const result = await extractor.extract(page, schema);
                assert.equal(result.price, 1234.56);
            });
        });
        it('should extract array fields', async () => {
            await withMcpContext(async (_response, context) => {
                const page = context.getSelectedPage();
                await page.setContent(html `
          <main>
            <img src="https://example.com/image1.jpg" />
            <img src="https://example.com/image2.jpg" />
            <img src="https://example.com/image3.jpg" />
          </main>
        `);
                const schema = zod.object({
                    images: zod.array(zod.string()),
                });
                const extractor = new DomExtractor();
                const result = await extractor.extract(page, schema);
                assert.equal(result.images.length, 3);
                assert.ok(result.images[0].includes('image1.jpg'));
                assert.ok(result.images[1].includes('image2.jpg'));
                assert.ok(result.images[2].includes('image3.jpg'));
            });
        });
        it('should extract boolean fields from text', async () => {
            await withMcpContext(async (_response, context) => {
                const page = context.getSelectedPage();
                await page.setContent(html `
          <main>
            <span class="inStock">In Stock</span>
          </main>
        `);
                const schema = zod.object({
                    inStock: zod.boolean(),
                });
                const extractor = new DomExtractor();
                const result = await extractor.extract(page, schema);
                assert.equal(result.inStock, true);
            });
        });
        it('should extract using selector scope', async () => {
            await withMcpContext(async (_response, context) => {
                const page = context.getSelectedPage();
                await page.setContent(html `
          <main>
            <div class="product-card">
              <h2 class="title">Scoped Product</h2>
            </div>
            <div>
              <h2 class="title">Other Product</h2>
            </div>
          </main>
        `);
                const schema = zod.object({
                    title: zod.string(),
                });
                const extractor = new DomExtractor();
                const result = await extractor.extract(page, schema, '.product-card');
                assert.equal(result.title, 'Scoped Product');
            });
        });
        it('should extract email from mailto links', async () => {
            await withMcpContext(async (_response, context) => {
                const page = context.getSelectedPage();
                await page.setContent(html `
          <main>
            <a href="mailto:contact@example.com">Email Us</a>
          </main>
        `);
                const schema = zod.object({
                    email: zod.string(),
                });
                const extractor = new DomExtractor();
                const result = await extractor.extract(page, schema);
                assert.equal(result.email, 'contact@example.com');
            });
        });
        it('should extract using data attributes', async () => {
            await withMcpContext(async (_response, context) => {
                const page = context.getSelectedPage();
                await page.setContent(html `
          <main>
            <div data-field="productName">Custom Product</div>
            <div data-testid="sku">SKU-12345</div>
          </main>
        `);
                const schema = zod.object({
                    productName: zod.string(),
                    sku: zod.string(),
                });
                const extractor = new DomExtractor();
                const result = await extractor.extract(page, schema);
                assert.equal(result.productName, 'Custom Product');
                assert.equal(result.sku, 'SKU-12345');
            });
        });
        it('should extract using itemprop attributes', async () => {
            await withMcpContext(async (_response, context) => {
                const page = context.getSelectedPage();
                await page.setContent(html `
          <main itemscope itemtype="https://schema.org/Product">
            <span itemprop="name">Semantic Product</span>
            <span itemprop="price">42.00</span>
            <img itemprop="image" src="https://example.com/product.jpg" />
          </main>
        `);
                const schema = zod.object({
                    name: zod.string(),
                    price: zod.number(),
                    image: zod.string(),
                });
                const extractor = new DomExtractor();
                const result = await extractor.extract(page, schema);
                assert.equal(result.name, 'Semantic Product');
                assert.equal(result.price, 42.00);
                assert.ok(result.image.includes('product.jpg'));
            });
        });
        it('should handle missing optional fields', async () => {
            await withMcpContext(async (_response, context) => {
                const page = context.getSelectedPage();
                await page.setContent(html `
          <main>
            <h1>Only Title</h1>
          </main>
        `);
                const schema = zod.object({
                    title: zod.string(),
                    description: zod.string().optional(),
                });
                const extractor = new DomExtractor();
                const result = await extractor.extract(page, schema);
                assert.equal(result.title, 'Only Title');
                assert.equal(result.description, undefined);
            });
        });
        it('should throw error when required field is missing', async () => {
            await withMcpContext(async (_response, context) => {
                const page = context.getSelectedPage();
                await page.setContent(html `
          <main>
            <p>No title here</p>
          </main>
        `);
                const schema = zod.object({
                    title: zod.string(),
                });
                const extractor = new DomExtractor();
                await assert.rejects(async () => await extractor.extract(page, schema), {
                    message: /validation failed/i,
                });
            });
        });
        it('should extract meta description', async () => {
            await withMcpContext(async (_response, context) => {
                const page = context.getSelectedPage();
                await page.setContent(html `
          <head>
            <meta name="description" content="This is the meta description" />
          </head>
          <body>
            <h1>Page</h1>
          </body>
        `);
                const schema = zod.object({
                    description: zod.string(),
                });
                const extractor = new DomExtractor();
                const result = await extractor.extract(page, schema);
                assert.equal(result.description, 'This is the meta description');
            });
        });
        it('should handle complex e-commerce product extraction', async () => {
            await withMcpContext(async (_response, context) => {
                const page = context.getSelectedPage();
                await page.setContent(html `
          <main>
            <h1 id="productName">Wireless Headphones</h1>
            <p class="description">Premium noise-cancelling headphones</p>
            <span itemprop="price">$299.99</span>
            <div class="inStock">In Stock</div>
            <img src="https://example.com/headphones-1.jpg" />
            <img src="https://example.com/headphones-2.jpg" />
            <a href="mailto:support@example.com">Contact Support</a>
          </main>
        `);
                const schema = zod.object({
                    productName: zod.string(),
                    description: zod.string(),
                    price: zod.number(),
                    inStock: zod.boolean(),
                    images: zod.array(zod.string()),
                    email: zod.string().optional(),
                });
                const extractor = new DomExtractor();
                const result = await extractor.extract(page, schema);
                assert.equal(result.productName, 'Wireless Headphones');
                assert.equal(result.description, 'Premium noise-cancelling headphones');
                assert.equal(result.price, 299.99);
                assert.equal(result.inStock, true);
                assert.equal(result.images.length, 2);
                assert.equal(result.email, 'support@example.com');
            });
        });
        it('should throw error when scope selector does not exist', async () => {
            await withMcpContext(async (_response, context) => {
                const page = context.getSelectedPage();
                await page.setContent(html `
          <main>
            <h1>Title</h1>
          </main>
        `);
                const schema = zod.object({
                    title: zod.string(),
                });
                const extractor = new DomExtractor();
                await assert.rejects(async () => await extractor.extract(page, schema, '.nonexistent'), {
                    message: /Scope element not found/i,
                });
            });
        });
    });
});
