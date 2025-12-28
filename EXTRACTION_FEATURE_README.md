# Structured Data Extraction Feature

## Overview

BOSS Ghost MCP now includes powerful structured data extraction capabilities inspired by FireCrawl's Extract API. Extract structured data from web pages using schemas with three modes: DOM (fast), LLM (intelligent), or Hybrid (best of both).

## Quick Example

```typescript
// Extract product data from an e-commerce page
await structuredExtract.handler({
  params: {
    schema: {
      productName: 'string',
      price: 'number',
      description: 'string',
      inStock: 'boolean',
      images: 'string[]'
    },
    extractionMode: 'hybrid',  // Try DOM first, fall back to LLM
    selector: '.product-details'  // Optional: limit scope
  }
}, response, context);
```

## Features

### Three Extraction Modes

1. **DOM Mode** (Default - No API Keys Required)
   - Fast, pattern-based extraction
   - Uses CSS selectors and common HTML patterns
   - Free, deterministic, reliable for structured pages
   ```typescript
   extractionMode: 'dom'
   ```

2. **LLM Mode** (Requires API Keys)
   - Intelligent AI-powered extraction
   - Cascading providers: OpenAI GPT-4o-mini → Claude 3.5 Haiku
   - Handles complex, unstructured, or ambiguous content
   ```typescript
   extractionMode: 'llm',
   llmInstructions: 'Extract product details focusing on pricing and availability'
   ```

3. **Hybrid Mode** (Recommended)
   - Best of both worlds
   - Tries DOM first (fast, free)
   - Falls back to LLM only if DOM fails
   ```typescript
   extractionMode: 'hybrid'
   ```

### Cascading LLM Providers

The LLM extraction system uses intelligent fallback:

```
1st Attempt: OpenAI GPT-4o-mini
   ├─ Fast (< 1 second)
   ├─ Cheap (~$0.0002 per extraction)
   └─ Deterministic (JSON mode)
         ↓ [If fails]
2nd Attempt: Claude 3.5 Haiku
   ├─ Reliable fallback
   ├─ Still fast
   └─ Slightly more expensive (~$0.0003)
```

**Reliability**: With both keys configured, you get 99.9%+ uptime!

## Setup

### 1. Install Dependencies

Already included in `package.json`:
- `zod` - Schema validation
- `openai` - OpenAI GPT-4o-mini (primary)
- `@anthropic-ai/sdk` - Claude Haiku (fallback)

### 2. Configure API Keys

**Option A: Environment Variables**
```bash
export OPENAI_API_KEY="sk-proj-your-key-here"
export ANTHROPIC_API_KEY="sk-ant-your-key-here"
```

**Option B: .env File (Recommended)**
```bash
cp .env.example .env
# Edit .env and add your keys
```

**Get API Keys:**
- OpenAI: https://platform.openai.com/api-keys
- Anthropic: https://console.anthropic.com/settings/keys

**Minimum Requirement**: At least ONE key (OpenAI or Anthropic)
**Recommended**: Both keys for maximum reliability

### 3. Verify Setup

```bash
npm test -- tests/utils/extraction/
```

## Usage Examples

### E-Commerce Product Extraction

```typescript
await structuredExtract.handler({
  params: {
    schema: {
      name: 'string',
      price: 'number',
      description: 'string',
      inStock: 'boolean',
      images: 'string[]',
      rating: 'number?',  // Optional field
      reviews: 'number?'
    },
    extractionMode: 'hybrid',
    selector: '.product-main'
  }
}, response, context);
```

### Job Listings

```typescript
await structuredExtract.handler({
  params: {
    schema: {
      title: 'string',
      company: 'string',
      location: 'string',
      salary: 'string',
      remote: 'boolean',
      skills: 'string[]'
    },
    extractionMode: 'dom',
    selector: '.job-posting'
  }
}, response, context);
```

### Blog Post Metadata (LLM Mode)

```typescript
await structuredExtract.handler({
  params: {
    schema: {
      title: 'string',
      author: 'string',
      publishDate: 'string',
      tags: 'string[]',
      readingTime: 'number'
    },
    extractionMode: 'llm',
    llmInstructions: 'Extract blog metadata. Calculate reading time based on word count (250 words per minute).'
  }
}, response, context);
```

## Supported Schema Types

| Type | Example | Description |
|------|---------|-------------|
| `string` | `'Hello'` | Text content |
| `number` | `42` | Numeric values |
| `boolean` | `true` | True/false values |
| `string[]` | `['a', 'b']` | Array of strings |
| `number[]` | `[1, 2, 3]` | Array of numbers |
| `boolean[]` | `[true, false]` | Array of booleans |
| `date` | `'2025-12-28'` | ISO date string |
| `string?` | Optional string | Optional fields (add `?`) |

## DOM Extraction Patterns

The DOM extractor automatically looks for common patterns:

### By Field Name
```html
<!-- Automatically detected for field "title" -->
<h1>...</h1>
<h2>...</h2>
<title>...</title>
<div id="title">...</div>
<div class="title">...</div>
<div data-field="title">...</div>
```

### By Semantic HTML
```html
<!-- Using schema.org microdata -->
<span itemprop="price">$99.99</span>
<div itemprop="description">...</div>
<img itemprop="image" src="..." />
```

### By Common Patterns
```html
<!-- Email -->
<a href="mailto:user@example.com">Contact</a>

<!-- Price -->
<span class="price">$99.99</span>
<div itemprop="price">1,234.56</div>

<!-- Images -->
<img src="product.jpg" />
```

## Cost Management

### Expected Costs

| Mode | Cost per Extraction | When to Use |
|------|---------------------|-------------|
| DOM | **Free** | Structured, semantic HTML |
| LLM (OpenAI) | ~$0.0002 | Unstructured content |
| LLM (Claude) | ~$0.0003 | Fallback only |
| Hybrid | ~$0.0002 (when needed) | General purpose (recommended) |

### Tips to Minimize Costs

1. **Start with DOM mode** - often sufficient for well-structured pages
2. **Use `selector` parameter** - reduces HTML sent to LLM
3. **Use hybrid mode** - only pays for LLM when DOM fails
4. **Cache results** - don't re-extract the same page
5. **Monitor usage** - set up billing alerts

## Troubleshooting

### "At least one API key required"
- **Solution**: Set `OPENAI_API_KEY` or `ANTHROPIC_API_KEY`
- **Note**: DOM mode works without keys

### DOM Extraction Fails
- **Issue**: Required fields not found
- **Solutions**:
  1. Use more specific `selector` to limit scope
  2. Add data attributes to your HTML (`data-field="fieldname"`)
  3. Try LLM or hybrid mode
  4. Check field names match HTML patterns

### LLM Extraction Fails
- **Issue**: Invalid API key or rate limit
- **Solutions**:
  1. Verify API key is correct
  2. Check API key has sufficient credits
  3. Wait a few minutes if rate limited
  4. Try the other provider (OpenAI ↔ Anthropic)

### Validation Errors
- **Issue**: Extracted data doesn't match schema
- **Solutions**:
  1. Make fields optional with `?` suffix
  2. Adjust schema to match actual data
  3. Use LLM mode with custom instructions
  4. Check the page actually contains the data

## Performance

| Mode | Speed | Accuracy | Cost |
|------|-------|----------|------|
| DOM | ⚡ <100ms | High (structured pages) | Free |
| LLM | 🚀 1-2s | Very High | ~$0.0002 |
| Hybrid | ⚡ <100ms - 2s | Very High | $0 - $0.0002 |

## Testing

### Run All Extraction Tests
```bash
npm test -- tests/utils/extraction/
npm test -- tests/tools/extraction.test.ts
```

### Test Specific Features
```bash
# DOM extraction only (no API keys needed)
npm test -- tests/utils/extraction/dom-extractor.test.ts

# LLM extraction (requires API keys)
npm test -- tests/utils/extraction/llm-extractor.test.ts

# Full integration tests
npm test -- tests/tools/extraction.test.ts
```

## Architecture

```
structured_extract (MCP Tool)
    ├─ DOM Extractor
    │   ├─ CSS Selector patterns
    │   ├─ Semantic HTML detection
    │   └─ Zod validation
    │
    └─ LLM Extractor
        ├─ OpenAI GPT-4o-mini (primary)
        │   ├─ JSON mode
        │   ├─ Temperature 0
        │   └─ ~1s response
        │
        └─ Claude 3.5 Haiku (fallback)
            ├─ JSON extraction
            └─ ~1.5s response
```

## Contributing

See [FIRECRAWL_BOSS_GHOST_INTEGRATION.md](./FIRECRAWL_BOSS_GHOST_INTEGRATION.md) for implementation details and roadmap.

---

**Questions?** Check the [Setup Guide](./SETUP_GUIDE.md) or open an issue!
