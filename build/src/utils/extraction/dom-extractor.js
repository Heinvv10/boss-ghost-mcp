/**
 * @license
 * Copyright 2025 BOSS Ghost MCP Team
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * DOM-based data extraction using selector patterns
 * Fast, deterministic extraction for structured content
 */
export class DomExtractor {
    /**
     * Extract structured data from page using DOM selectors
     */
    async extract(page, schema, selector) {
        const scope = selector || 'document';
        // Get schema shape to understand expected fields
        const schemaShape = schema.shape;
        // Extract type information before page.evaluate (can't serialize Zod schemas)
        const fieldTypes = {};
        for (const [fieldName, fieldSchema] of Object.entries(schemaShape)) {
            const def = fieldSchema._def;
            const type = def.type;
            // For arrays, also extract the element type
            if (type === 'array') {
                const elementType = def.element?._def?.type || 'unknown';
                fieldTypes[fieldName] = { type, elementType };
            }
            else {
                fieldTypes[fieldName] = { type };
            }
        }
        // Extract data based on common patterns
        const data = await page.evaluate((scopeSelector, fieldTypes) => {
            const scopeElement = scopeSelector === 'document'
                ? document
                : document.querySelector(scopeSelector);
            if (!scopeElement) {
                throw new Error(`Scope element not found: ${scopeSelector}`);
            }
            const result = {};
            // Helper: Get text content safely
            const getText = (selector) => {
                const el = scopeElement.querySelector?.(selector);
                return el?.textContent?.trim() || null;
            };
            // Helper: Get attribute safely
            const getAttr = (selector, attr) => {
                const el = scopeElement.querySelector?.(selector);
                return el?.getAttribute(attr) || null;
            };
            // Helper: Get all matching elements
            const getAll = (selector) => {
                const elements = scopeElement.querySelectorAll?.(selector);
                return Array.from(elements || []).map(el => el.textContent?.trim() || '').filter(Boolean);
            };
            // Auto-detect and extract common patterns
            for (const fieldName of Object.keys(fieldTypes)) {
                // Get field type from pre-extracted type information
                const fieldTypeInfo = fieldTypes[fieldName];
                const fieldType = fieldTypeInfo.type;
                const elementType = fieldTypeInfo.elementType;
                // Try multiple selector strategies
                const selectors = [
                    // ID/name based
                    `#${fieldName}`,
                    `[name="${fieldName}"]`,
                    `[data-field="${fieldName}"]`,
                    `[data-testid="${fieldName}"]`,
                    // Class based
                    `.${fieldName}`,
                    `[class*="${fieldName}"]`,
                    // Semantic HTML
                    `[itemprop="${fieldName}"]`,
                    `[property="${fieldName}"]`,
                    // Common patterns
                    ...(fieldName === 'title' ? ['h1', 'h2', '[role="heading"]', 'title'] : []),
                    ...(fieldName === 'description' ? ['meta[name="description"]', 'p.description', '.desc'] : []),
                    ...(fieldName === 'price' ? ['[itemprop="price"]', '.price', '[class*="price"]'] : []),
                    ...(fieldName === 'image' || fieldName === 'images' ? ['img[src]', '[itemprop="image"]'] : []),
                    ...(fieldName === 'email' ? ['[type="email"]', '[href^="mailto:"]'] : []),
                    ...(fieldName === 'phone' ? ['[type="tel"]', '[href^="tel:"]'] : []),
                ];
                // Try each selector
                let value = null;
                for (const sel of selectors) {
                    // Handle array types (Zod v4 uses lowercase type names)
                    if (fieldType === 'array') {
                        // For image arrays, get src attributes
                        if (fieldName === 'images' || fieldName === 'image') {
                            const imgs = scopeElement.querySelectorAll?.(sel);
                            const imageSrcs = Array.from(imgs || []).map(img => img.src).filter(Boolean);
                            if (imageSrcs.length > 0) {
                                value = imageSrcs;
                                break;
                            }
                        }
                        // For number arrays, extract and parse numbers
                        else if (elementType === 'number') {
                            const values = getAll(sel);
                            if (values.length > 0) {
                                value = values.map(v => {
                                    const match = v.match(/[\d,]+\.?\d*/);
                                    return match ? parseFloat(match[0].replace(/,/g, '')) : null;
                                }).filter((n) => n !== null);
                                if (value.length > 0)
                                    break;
                            }
                        }
                        // For boolean arrays, interpret text
                        else if (elementType === 'boolean') {
                            const values = getAll(sel);
                            if (values.length > 0) {
                                value = values.map(v => v.toLowerCase().includes('true') ||
                                    v.toLowerCase().includes('yes') ||
                                    v.toLowerCase().includes('in stock'));
                                break;
                            }
                        }
                        // For string arrays, get text content
                        else {
                            const values = getAll(sel);
                            if (values.length > 0) {
                                value = values;
                                break;
                            }
                        }
                    }
                    // Handle string types
                    else if (fieldType === 'string') {
                        // For email/url fields, get href attribute
                        if (fieldName === 'email' && sel.includes('mailto:')) {
                            const href = getAttr(sel, 'href');
                            value = href?.replace('mailto:', '') || null;
                        }
                        else if (sel.includes('[href')) {
                            value = getAttr(sel, 'href');
                        }
                        // For image fields, get src attribute
                        else if ((fieldName === 'image' || fieldName === 'img') && sel.includes('img')) {
                            value = getAttr(sel, 'src');
                        }
                        // For meta description
                        else if (sel.includes('meta[name="description"]')) {
                            value = getAttr(sel, 'content');
                        }
                        // Regular text content
                        else {
                            value = getText(sel);
                        }
                        if (value)
                            break;
                    }
                    // Handle number types
                    else if (fieldType === 'number') {
                        const text = getText(sel);
                        if (text) {
                            // Extract number from text (handle currency, etc.)
                            const match = text.match(/[\d,]+\.?\d*/);
                            if (match) {
                                value = parseFloat(match[0].replace(/,/g, ''));
                                break;
                            }
                        }
                    }
                    // Handle boolean types
                    else if (fieldType === 'boolean') {
                        const text = getText(sel);
                        if (text) {
                            value = text.toLowerCase().includes('true') ||
                                text.toLowerCase().includes('yes') ||
                                text.toLowerCase().includes('in stock');
                            break;
                        }
                    }
                }
                // Store extracted value (or undefined if not found)
                if (value !== null) {
                    result[fieldName] = value;
                }
            }
            return result;
        }, scope, fieldTypes);
        // Validate against schema
        try {
            return schema.parse(data);
        }
        catch (error) {
            throw new Error(`DOM extraction validation failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
}
