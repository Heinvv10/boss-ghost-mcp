/**
 * @license
 * Copyright 2025 BOSS Ghost MCP Team
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import {describe, it, beforeEach, afterEach} from 'node:test';
import sinon from 'sinon';

import {LlmExtractor} from '../../../src/utils/extraction/llm-extractor.js';
import {zod} from '../../../src/third_party/index.js';
import {html, withMcpContext} from '../../utils.js';

describe('LlmExtractor', () => {
  let originalOpenAIKey: string | undefined;
  let originalAnthropicKey: string | undefined;

  beforeEach(() => {
    // Save original environment variables
    originalOpenAIKey = process.env.OPENAI_API_KEY;
    originalAnthropicKey = process.env.ANTHROPIC_API_KEY;
  });

  afterEach(() => {
    // Restore original environment variables
    if (originalOpenAIKey) {
      process.env.OPENAI_API_KEY = originalOpenAIKey;
    } else {
      delete process.env.OPENAI_API_KEY;
    }

    if (originalAnthropicKey) {
      process.env.ANTHROPIC_API_KEY = originalAnthropicKey;
    } else {
      delete process.env.ANTHROPIC_API_KEY;
    }

    sinon.restore();
  });

  describe('constructor', () => {
    it('should initialize with OpenAI client when OPENAI_API_KEY is set', () => {
      process.env.OPENAI_API_KEY = 'test-openai-key';
      process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';

      const extractor = new LlmExtractor();

      // Extractor should be created without errors
      assert.ok(extractor);
    });

    it('should initialize with Claude client when ANTHROPIC_API_KEY is set', () => {
      delete process.env.OPENAI_API_KEY;
      process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';

      const extractor = new LlmExtractor();

      // Extractor should be created without errors
      assert.ok(extractor);
    });

    it('should throw error when no API keys are configured', () => {
      delete process.env.OPENAI_API_KEY;
      delete process.env.ANTHROPIC_API_KEY;

      assert.throws(
        () => new LlmExtractor(),
        {
          message: /At least one API key required/i,
        }
      );
    });
  });

  describe('extract - OpenAI primary', () => {
    it('should extract using OpenAI GPT-4o-mini when available', async () => {
      process.env.OPENAI_API_KEY = 'test-openai-key';
      process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';

      await withMcpContext(async (_response, context) => {
        const page = context.getSelectedPage();

        await page.setContent(html`
          <main>
            <h1>Test Product</h1>
            <p class="description">Great product</p>
            <span class="price">$99.99</span>
          </main>
        `);

        const schema = zod.object({
          title: zod.string(),
          description: zod.string(),
          price: zod.number(),
        });

        const extractor = new LlmExtractor();

        // Mock OpenAI response
        const mockOpenAI = {
          chat: {
            completions: {
              create: sinon.stub().resolves({
                choices: [{
                  message: {
                    content: JSON.stringify({
                      title: 'Test Product',
                      description: 'Great product',
                      price: 99.99,
                    }),
                  },
                }],
              }),
            },
          },
        };

        // Replace OpenAI client
        (extractor as any).openaiClient = mockOpenAI;

        const result = await extractor.extract(page, schema);

        assert.equal(result.title, 'Test Product');
        assert.equal(result.description, 'Great product');
        assert.equal(result.price, 99.99);

        // Verify OpenAI was called
        assert.equal(mockOpenAI.chat.completions.create.callCount, 1);

        // Verify correct model was used
        const callArgs = mockOpenAI.chat.completions.create.firstCall.args[0];
        assert.equal(callArgs.model, 'gpt-4o-mini');
        assert.equal(callArgs.temperature, 0);
        assert.deepEqual(callArgs.response_format, { type: 'json_object' });
      });
    });

    it('should fall back to Claude when OpenAI fails', async () => {
      process.env.OPENAI_API_KEY = 'test-openai-key';
      process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';

      await withMcpContext(async (_response, context) => {
        const page = context.getSelectedPage();

        await page.setContent(html`
          <main>
            <h1>Fallback Product</h1>
          </main>
        `);

        const schema = zod.object({
          title: zod.string(),
        });

        const extractor = new LlmExtractor();

        // Mock OpenAI to fail
        const mockOpenAI = {
          chat: {
            completions: {
              create: sinon.stub().rejects(new Error('OpenAI API error')),
            },
          },
        };

        // Mock Claude to succeed
        const mockClaude = {
          messages: {
            create: sinon.stub().resolves({
              content: [{
                type: 'text',
                text: JSON.stringify({
                  title: 'Fallback Product',
                }),
              }],
            }),
          },
        };

        (extractor as any).openaiClient = mockOpenAI;
        (extractor as any).claudeClient = mockClaude;

        const result = await extractor.extract(page, schema);

        assert.equal(result.title, 'Fallback Product');

        // Verify OpenAI was called first
        assert.equal(mockOpenAI.chat.completions.create.callCount, 1);

        // Verify Claude was called as fallback
        assert.equal(mockClaude.messages.create.callCount, 1);

        // Verify correct Claude model was used
        const claudeArgs = mockClaude.messages.create.firstCall.args[0];
        assert.equal(claudeArgs.model, 'claude-3-5-haiku-20241022');
      });
    });

    it('should throw error when both providers fail', async () => {
      process.env.OPENAI_API_KEY = 'test-openai-key';
      process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';

      await withMcpContext(async (_response, context) => {
        const page = context.getSelectedPage();

        await page.setContent(html`<main><h1>Test</h1></main>`);

        const schema = zod.object({
          title: zod.string(),
        });

        const extractor = new LlmExtractor();

        // Mock both to fail
        const mockOpenAI = {
          chat: {
            completions: {
              create: sinon.stub().rejects(new Error('OpenAI API error')),
            },
          },
        };

        const mockClaude = {
          messages: {
            create: sinon.stub().rejects(new Error('Claude API error')),
          },
        };

        (extractor as any).openaiClient = mockOpenAI;
        (extractor as any).claudeClient = mockClaude;

        await assert.rejects(
          async () => await extractor.extract(page, schema),
          {
            message: /LLM extraction failed with all providers/i,
          }
        );
      });
    });
  });

  describe('extract - with instructions', () => {
    it('should include custom instructions in prompt', async () => {
      process.env.OPENAI_API_KEY = 'test-openai-key';

      await withMcpContext(async (_response, context) => {
        const page = context.getSelectedPage();

        await page.setContent(html`
          <main>
            <div class="product">
              <h2>Product Name</h2>
              <p>$50.00</p>
            </div>
          </main>
        `);

        const schema = zod.object({
          name: zod.string(),
          price: zod.number(),
        });

        const extractor = new LlmExtractor();

        const mockOpenAI = {
          chat: {
            completions: {
              create: sinon.stub().resolves({
                choices: [{
                  message: {
                    content: JSON.stringify({
                      name: 'Product Name',
                      price: 50.00,
                    }),
                  },
                }],
              }),
            },
          },
        };

        (extractor as any).openaiClient = mockOpenAI;

        const customInstructions = 'Extract the product name from h2 and price from the paragraph';
        await extractor.extract(page, schema, customInstructions);

        const callArgs = mockOpenAI.chat.completions.create.firstCall.args[0];
        assert.ok(callArgs.messages[0].content.includes(customInstructions));
      });
    });
  });

  describe('extract - with selector', () => {
    it('should limit extraction scope to selector', async () => {
      process.env.OPENAI_API_KEY = 'test-openai-key';

      await withMcpContext(async (_response, context) => {
        const page = context.getSelectedPage();

        await page.setContent(html`
          <main>
            <div class="product-card">
              <h2>Scoped Product</h2>
            </div>
            <div>
              <h2>Other Product</h2>
            </div>
          </main>
        `);

        const schema = zod.object({
          title: zod.string(),
        });

        const extractor = new LlmExtractor();

        const mockOpenAI = {
          chat: {
            completions: {
              create: sinon.stub().resolves({
                choices: [{
                  message: {
                    content: JSON.stringify({
                      title: 'Scoped Product',
                    }),
                  },
                }],
              }),
            },
          },
        };

        (extractor as any).openaiClient = mockOpenAI;

        await extractor.extract(page, schema, undefined, '.product-card');

        // Verify the HTML sent to API only contains scoped content
        const callArgs = mockOpenAI.chat.completions.create.firstCall.args[0];
        assert.ok(callArgs.messages[0].content.includes('Scoped Product'));
        assert.ok(!callArgs.messages[0].content.includes('Other Product'));
      });
    });

    it('should throw error when selector does not exist', async () => {
      process.env.OPENAI_API_KEY = 'test-openai-key';

      await withMcpContext(async (_response, context) => {
        const page = context.getSelectedPage();

        await page.setContent(html`<main><h1>Test</h1></main>`);

        const schema = zod.object({
          title: zod.string(),
        });

        const extractor = new LlmExtractor();

        await assert.rejects(
          async () => await extractor.extract(page, schema, undefined, '.nonexistent'),
          {
            message: /Element not found/i,
          }
        );
      });
    });
  });

  describe('extract - complex schema', () => {
    it('should extract nested arrays with OpenAI', async () => {
      process.env.OPENAI_API_KEY = 'test-openai-key';

      await withMcpContext(async (_response, context) => {
        const page = context.getSelectedPage();

        await page.setContent(html`
          <main>
            <h1>Job Listings</h1>
            <div class="job">Software Engineer - Remote</div>
            <div class="job">Product Manager - NYC</div>
          </main>
        `);

        const schema = zod.object({
          title: zod.string(),
          jobs: zod.array(zod.string()),
        });

        const extractor = new LlmExtractor();

        const mockOpenAI = {
          chat: {
            completions: {
              create: sinon.stub().resolves({
                choices: [{
                  message: {
                    content: JSON.stringify({
                      title: 'Job Listings',
                      jobs: ['Software Engineer - Remote', 'Product Manager - NYC'],
                    }),
                  },
                }],
              }),
            },
          },
        };

        (extractor as any).openaiClient = mockOpenAI;

        const result = await extractor.extract(page, schema);

        assert.equal(result.title, 'Job Listings');
        assert.equal(result.jobs.length, 2);
        assert.equal(result.jobs[0], 'Software Engineer - Remote');
        assert.equal(result.jobs[1], 'Product Manager - NYC');
      });
    });
  });

  describe('HTML cleaning', () => {
    it('should clean HTML before sending to LLM', async () => {
      process.env.OPENAI_API_KEY = 'test-openai-key';

      await withMcpContext(async (_response, context) => {
        const page = context.getSelectedPage();

        await page.setContent(html`
          <html>
            <head>
              <script>console.log('tracking');</script>
              <style>.test { color: red; }</style>
            </head>
            <body>
              <!-- Comment here -->
              <h1>Clean Title</h1>
            </body>
          </html>
        `);

        const schema = zod.object({
          title: zod.string(),
        });

        const extractor = new LlmExtractor();

        const mockOpenAI = {
          chat: {
            completions: {
              create: sinon.stub().resolves({
                choices: [{
                  message: {
                    content: JSON.stringify({
                      title: 'Clean Title',
                    }),
                  },
                }],
              }),
            },
          },
        };

        (extractor as any).openaiClient = mockOpenAI;

        await extractor.extract(page, schema);

        const callArgs = mockOpenAI.chat.completions.create.firstCall.args[0];
        const sentHtml = callArgs.messages[0].content;

        // Verify scripts, styles, and comments are removed
        assert.ok(!sentHtml.includes('<script>'));
        assert.ok(!sentHtml.includes('<style>'));
        assert.ok(!sentHtml.includes('<!--'));
        assert.ok(sentHtml.includes('Clean Title'));
      });
    });

    it('should truncate very long HTML content', async () => {
      process.env.OPENAI_API_KEY = 'test-openai-key';

      await withMcpContext(async (_response, context) => {
        const page = context.getSelectedPage();

        // Create very long content (> 50k chars)
        const longContent = '<div>' + 'x'.repeat(60000) + '</div>';
        await page.setContent(longContent);

        const schema = zod.object({
          data: zod.string().optional(),
        });

        const extractor = new LlmExtractor();

        const mockOpenAI = {
          chat: {
            completions: {
              create: sinon.stub().resolves({
                choices: [{
                  message: {
                    content: JSON.stringify({
                      data: 'truncated',
                    }),
                  },
                }],
              }),
            },
          },
        };

        (extractor as any).openaiClient = mockOpenAI;

        await extractor.extract(page, schema);

        const callArgs = mockOpenAI.chat.completions.create.firstCall.args[0];
        const sentHtml = callArgs.messages[0].content;

        // Verify content was truncated to 50k
        assert.ok(sentHtml.length < 60000);
      });
    });
  });

  describe('validation errors', () => {
    it('should throw validation error when LLM returns invalid data', async () => {
      process.env.OPENAI_API_KEY = 'test-openai-key';

      await withMcpContext(async (_response, context) => {
        const page = context.getSelectedPage();

        await page.setContent(html`<main><h1>Test</h1></main>`);

        const schema = zod.object({
          title: zod.string(),
          price: zod.number(), // Required field
        });

        const extractor = new LlmExtractor();

        // Mock OpenAI to return incomplete data
        const mockOpenAI = {
          chat: {
            completions: {
              create: sinon.stub().resolves({
                choices: [{
                  message: {
                    content: JSON.stringify({
                      title: 'Test',
                      // Missing required 'price' field
                    }),
                  },
                }],
              }),
            },
          },
        };

        (extractor as any).openaiClient = mockOpenAI;

        await assert.rejects(
          async () => await extractor.extract(page, schema),
          {
            name: 'ZodError',
          }
        );
      });
    });
  });
});
