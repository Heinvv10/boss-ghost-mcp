/**
 * @license
 * Copyright 2025 BOSS Ghost MCP Team
 * SPDX-License-Identifier: Apache-2.0
 */
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
/**
 * LLM-based data extraction with cascading providers
 * Primary: OpenAI GPT-4o-mini (fast, cheap)
 * Fallback: Claude 3.5 Haiku (when OpenAI fails)
 */
export class LlmExtractor {
    openaiClient = null;
    claudeClient = null;
    constructor() {
        // Initialize OpenAI client (primary)
        const openaiKey = process.env.OPENAI_API_KEY;
        if (openaiKey) {
            this.openaiClient = new OpenAI({ apiKey: openaiKey });
        }
        // Initialize Claude client (fallback)
        const anthropicKey = process.env.ANTHROPIC_API_KEY;
        if (anthropicKey) {
            this.claudeClient = new Anthropic({ apiKey: anthropicKey });
        }
        // Require at least one provider
        if (!this.openaiClient && !this.claudeClient) {
            throw new Error('At least one API key required: OPENAI_API_KEY (primary) or ANTHROPIC_API_KEY (fallback)');
        }
    }
    /**
     * Extract structured data using LLM with cascading fallback
     * 1st attempt: OpenAI GPT-4o-mini
     * 2nd attempt: Claude 3.5 Haiku (if OpenAI fails)
     */
    async extract(page, schema, instructions, selector) {
        // Get HTML content
        let htmlContent;
        if (selector) {
            const element = await page.$(selector);
            if (!element) {
                throw new Error(`Element not found: ${selector}`);
            }
            htmlContent = await element.evaluate(el => el.outerHTML);
        }
        else {
            htmlContent = await page.content();
        }
        // Clean HTML to reduce token count
        const cleanedHtml = this.cleanHtml(htmlContent);
        // Get schema description
        const schemaDescription = this.describeSchema(schema);
        // Construct extraction prompt
        const prompt = this.buildPrompt(schemaDescription, instructions, cleanedHtml);
        let result;
        let lastError = null;
        // Attempt 1: OpenAI GPT-4o-mini (primary)
        if (this.openaiClient) {
            try {
                console.log('[LLM] Attempting extraction with OpenAI GPT-4o-mini...');
                result = await this.extractWithOpenAI(prompt, schema);
                console.log('[LLM] ✅ OpenAI extraction successful');
                return result;
            }
            catch (error) {
                lastError = error instanceof Error ? error : new Error(String(error));
                console.log(`[LLM] ⚠️ OpenAI extraction failed: ${lastError.message}`);
                console.log('[LLM] 🔄 Falling back to Claude Haiku...');
            }
        }
        // Attempt 2: Claude 3.5 Haiku (fallback)
        if (this.claudeClient) {
            try {
                result = await this.extractWithClaude(prompt, schema);
                console.log('[LLM] ✅ Claude extraction successful (fallback)');
                return result;
            }
            catch (error) {
                lastError = error instanceof Error ? error : new Error(String(error));
                console.log(`[LLM] ❌ Claude extraction failed: ${lastError.message}`);
            }
        }
        // Both attempts failed
        throw new Error(`LLM extraction failed with all providers. Last error: ${lastError?.message || 'Unknown error'}`);
    }
    /**
     * Extract using OpenAI GPT-4o-mini
     */
    async extractWithOpenAI(prompt, schema) {
        if (!this.openaiClient) {
            throw new Error('OpenAI client not initialized');
        }
        const response = await this.openaiClient.chat.completions.create({
            model: 'gpt-4o-mini', // Fast, cheap, capable
            messages: [{
                    role: 'user',
                    content: prompt,
                }],
            max_tokens: 2048,
            temperature: 0, // Deterministic output
            response_format: { type: 'json_object' }, // Force JSON response
        });
        const content = response.choices[0]?.message?.content;
        if (!content) {
            throw new Error('No content in OpenAI response');
        }
        // Parse and validate JSON
        const extracted = JSON.parse(content);
        return schema.parse(extracted);
    }
    /**
     * Extract using Claude 3.5 Haiku
     */
    async extractWithClaude(prompt, schema) {
        if (!this.claudeClient) {
            throw new Error('Claude client not initialized');
        }
        const response = await this.claudeClient.messages.create({
            model: 'claude-3-5-haiku-20241022',
            max_tokens: 2048,
            messages: [{
                    role: 'user',
                    content: prompt,
                }],
        });
        const content = response.content[0];
        if (content.type !== 'text') {
            throw new Error('Unexpected response type from Claude API');
        }
        // Extract JSON from response
        const jsonMatch = content.text.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            throw new Error('No JSON found in Claude response');
        }
        const extracted = JSON.parse(jsonMatch[0]);
        return schema.parse(extracted);
    }
    /**
     * Build extraction prompt
     */
    buildPrompt(schemaDescription, instructions, htmlContent) {
        return `You are a data extraction assistant. Extract structured data from the provided HTML.

Schema Definition:
${schemaDescription}

${instructions ? `Additional Instructions:\n${instructions}\n` : ''}
Rules:
1. Extract ONLY the fields defined in the schema
2. Return valid JSON matching the schema exactly
3. If a field is not found, use null for optional fields or omit required fields
4. For arrays, extract all matching items
5. For numbers, extract numeric values (strip currency symbols, commas, etc.)
6. For booleans, interpret text like "yes", "true", "in stock" as true
7. For dates, use ISO 8601 format (YYYY-MM-DD)
8. Return ONLY the JSON object, no explanation or markdown formatting

HTML Content:
${htmlContent}`;
    }
    /**
     * Clean HTML to reduce token count while preserving content
     */
    cleanHtml(html) {
        return html
            // Remove scripts and styles
            .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
            .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
            // Remove comments
            .replace(/<!--[\s\S]*?-->/g, '')
            // Remove excessive whitespace
            .replace(/\s+/g, ' ')
            // Limit length (max 100k characters for GPT-4o-mini, 50k for Haiku)
            .substring(0, 50000);
    }
    /**
     * Generate human-readable schema description for LLMs
     */
    describeSchema(schema) {
        const shape = schema.shape;
        const fields = [];
        for (const [fieldName, fieldSchema] of Object.entries(shape)) {
            const def = fieldSchema._def;
            // Zod v4 uses _def.type instead of _def.typeName
            const type = def.type;
            const isOptional = type === 'optional';
            let typeDesc = '';
            if (type === 'string') {
                typeDesc = 'string';
            }
            else if (type === 'number') {
                typeDesc = 'number';
            }
            else if (type === 'boolean') {
                typeDesc = 'boolean';
            }
            else if (type === 'array') {
                const innerType = def.element?._def?.type || 'unknown';
                typeDesc = `array of ${innerType}s`;
            }
            else if (type === 'object') {
                typeDesc = 'object';
            }
            else if (type === 'optional') {
                const innerDef = def.innerType?._def;
                const innerType = innerDef?.type || 'unknown';
                typeDesc = `optional ${innerType}`;
            }
            else {
                typeDesc = type || 'unknown';
            }
            fields.push(`  - ${fieldName}: ${typeDesc}${isOptional ? ' (optional)' : ''}`);
        }
        return fields.join('\n');
    }
}
