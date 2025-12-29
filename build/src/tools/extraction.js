/**
 * @license
 * Copyright 2025 BOSS Ghost MCP Team
 * SPDX-License-Identifier: Apache-2.0
 */
import { zod } from '../third_party/index.js';
import { DomExtractor } from '../utils/extraction/dom-extractor.js';
import { LlmExtractor } from '../utils/extraction/llm-extractor.js';
import { ToolCategory } from './categories.js';
import { defineTool } from './ToolDefinition.js';
/**
 * Structured data extraction tool
 * Extracts structured data from pages using schemas (like FireCrawl's Extract API)
 */
export const structuredExtract = defineTool({
    name: 'structured_extract',
    description: `Extract structured data from the current page using a Zod schema or JSON Schema.
Supports three extraction modes:
- 'dom': Fast DOM-based extraction using selector patterns (default)
- 'llm': Intelligent LLM-based extraction using Claude (requires ANTHROPIC_API_KEY)
- 'hybrid': Try DOM first, fall back to LLM if DOM fails

The schema parameter should be a JSON representation of a Zod schema shape.
For example, to extract product data:
{
  "name": "string",
  "price": "number",
  "description": "string",
  "inStock": "boolean",
  "images": "string[]"
}

Type suffixes:
- string: Basic string
- number: Numeric value
- boolean: True/false
- string[]: Array of strings
- number[]: Array of numbers
- optional: Add "?" suffix (e.g., "string?" for optional string)`,
    annotations: {
        category: ToolCategory.DEBUGGING,
        readOnlyHint: true,
    },
    schema: {
        schema: zod
            .record(zod.string(), zod.string())
            .describe('JSON Schema representation where keys are field names and values are types (string, number, boolean, string[], number[], etc.)'),
        extractionMode: zod
            .enum(['dom', 'llm', 'hybrid'])
            .default('dom')
            .describe('Extraction method: "dom" for fast DOM parsing, "llm" for AI-powered extraction, "hybrid" for DOM with LLM fallback'),
        selector: zod
            .string()
            .optional()
            .describe('Optional CSS selector to limit extraction scope to a specific element'),
        llmInstructions: zod
            .string()
            .optional()
            .describe('Additional natural language instructions for LLM extraction (only used in llm or hybrid mode)'),
    },
    handler: async (request, response, context) => {
        const { schema: schemaShape, extractionMode, selector, llmInstructions } = request.params;
        const page = context.getSelectedPage();
        try {
            // Convert JSON schema to Zod schema
            const zodSchema = buildZodSchema(schemaShape);
            let result;
            // Mode 1: DOM extraction (fast, deterministic)
            if (extractionMode === 'dom') {
                const extractor = new DomExtractor();
                result = await extractor.extract(page, zodSchema, selector);
                response.appendResponseLine('✅ DOM extraction successful');
            }
            // Mode 2: LLM extraction (flexible, intelligent)
            else if (extractionMode === 'llm') {
                const extractor = new LlmExtractor();
                result = await extractor.extract(page, zodSchema, llmInstructions, selector);
                response.appendResponseLine('✅ LLM extraction successful');
            }
            // Mode 3: Hybrid (DOM first, LLM fallback)
            else if (extractionMode === 'hybrid') {
                try {
                    const domExtractor = new DomExtractor();
                    result = await domExtractor.extract(page, zodSchema, selector);
                    response.appendResponseLine('✅ DOM extraction successful');
                }
                catch (domError) {
                    response.appendResponseLine(`⚠️ DOM extraction failed: ${domError instanceof Error ? domError.message : String(domError)}`);
                    response.appendResponseLine('🔄 Falling back to LLM extraction...');
                    const llmExtractor = new LlmExtractor();
                    result = await llmExtractor.extract(page, zodSchema, llmInstructions, selector);
                    response.appendResponseLine('✅ LLM extraction successful (fallback)');
                }
            }
            // Format and return results
            response.appendResponseLine('');
            response.appendResponseLine('📦 Extracted Data:');
            response.appendResponseLine('```json');
            response.appendResponseLine(JSON.stringify(result, null, 2));
            response.appendResponseLine('```');
            // Include snapshot for context
            response.includeSnapshot();
        }
        catch (error) {
            response.appendResponseLine(`❌ Extraction failed: ${error instanceof Error ? error.message : String(error)}`);
            response.appendResponseLine('');
            response.appendResponseLine('💡 Troubleshooting:');
            response.appendResponseLine('1. Verify the schema matches the page structure');
            response.appendResponseLine('2. Try using a more specific selector');
            response.appendResponseLine('3. For complex pages, use "llm" or "hybrid" mode');
            response.appendResponseLine('4. Ensure ANTHROPIC_API_KEY is set for LLM mode');
            response.includeSnapshot();
            throw error;
        }
    },
});
/**
 * Build Zod schema from JSON schema representation
 */
function buildZodSchema(schemaShape) {
    const shape = {};
    for (const [fieldName, typeString] of Object.entries(schemaShape)) {
        // Check if optional
        const isOptional = typeString.endsWith('?');
        const baseType = isOptional ? typeString.slice(0, -1) : typeString;
        // Parse type
        let fieldSchema;
        if (baseType === 'string') {
            fieldSchema = zod.string();
        }
        else if (baseType === 'number') {
            fieldSchema = zod.number();
        }
        else if (baseType === 'boolean') {
            fieldSchema = zod.boolean();
        }
        else if (baseType === 'string[]') {
            fieldSchema = zod.array(zod.string());
        }
        else if (baseType === 'number[]') {
            fieldSchema = zod.array(zod.number());
        }
        else if (baseType === 'boolean[]') {
            fieldSchema = zod.array(zod.boolean());
        }
        else if (baseType === 'date') {
            fieldSchema = zod.string(); // Store as ISO string
        }
        else {
            // Default to string for unknown types
            fieldSchema = zod.string();
        }
        // Make optional if specified
        if (isOptional) {
            fieldSchema = fieldSchema.optional();
        }
        shape[fieldName] = fieldSchema;
    }
    return zod.object(shape);
}
