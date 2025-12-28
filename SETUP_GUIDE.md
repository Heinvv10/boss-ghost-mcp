# BOSS Ghost MCP - Setup Guide

## 🚀 Quick Start

### 1. Installation

```bash
# Clone the repository
git clone https://github.com/your-org/boss-ghost-mcp.git
cd boss-ghost-mcp

# Install dependencies
npm install

# Build the project
npm run build
```

### 2. API Key Configuration (Required for LLM Features)

BOSS Ghost MCP includes powerful LLM-based data extraction features that require API keys.

#### Option A: Environment Variables (Recommended for Development)

**Windows PowerShell:**
```powershell
$env:OPENAI_API_KEY = "sk-proj-your-key-here"
$env:ANTHROPIC_API_KEY = "sk-ant-your-key-here"
```

**Linux/Mac:**
```bash
export OPENAI_API_KEY="sk-proj-your-key-here"
export ANTHROPIC_API_KEY="sk-ant-your-key-here"
```

#### Option B: .env File (Recommended for Production)

1. Copy the example environment file:
   ```bash
   cp .env.example .env
   ```

2. Edit `.env` and add your API keys:
   ```bash
   OPENAI_API_KEY=sk-proj-your-key-here
   ANTHROPIC_API_KEY=sk-ant-your-key-here
   ```

3. Make sure `.env` is in `.gitignore` (it should be by default)

### 3. Get API Keys

#### OpenAI API Key (Primary - Recommended)
1. Go to https://platform.openai.com/api-keys
2. Click "Create new secret key"
3. Copy the key (starts with `sk-proj-...`)
4. **Cost**: ~$0.00015 per extraction with GPT-4o-mini

#### Anthropic API Key (Fallback - Recommended)
1. Go to https://console.anthropic.com/settings/keys
2. Click "Create Key"
3. Copy the key (starts with `sk-ant-...`)
4. **Cost**: ~$0.00025 per extraction with Claude 3.5 Haiku

#### Why Both Keys?

The LLM extraction system uses **cascading fallback**:
1. **Primary**: OpenAI GPT-4o-mini (fast, cheap, accurate)
2. **Fallback**: Claude 3.5 Haiku (when OpenAI fails)

Having both keys ensures maximum reliability!

### 4. Verify Setup

```bash
# Run tests to verify everything works
npm test

# Run specific extraction tests
npm test -- tests/utils/extraction/
```

---

## 🎯 Feature Modes

### DOM Extraction (No API Keys Needed)
Fast, pattern-based extraction using CSS selectors:
```javascript
{
  extractionMode: 'dom'  // Default, no API keys required
}
```

### LLM Extraction (Requires API Keys)
Intelligent AI-powered extraction:
```javascript
{
  extractionMode: 'llm',  // Requires OPENAI_API_KEY or ANTHROPIC_API_KEY
  llmInstructions: 'Extract product details from this e-commerce page'
}
```

### Hybrid Mode (Requires API Keys for Fallback)
Best of both worlds - tries DOM first, falls back to LLM:
```javascript
{
  extractionMode: 'hybrid'  // DOM first, LLM fallback
}
```

---

## 🔒 Security Best Practices

### ✅ DO:
- Store API keys in environment variables or `.env` file
- Add `.env` to `.gitignore`
- Use different keys for development and production
- Rotate keys periodically
- Monitor API usage and costs

### ❌ DON'T:
- Commit API keys to git
- Share keys in chat/email/messages
- Use the same keys across multiple projects
- Store keys in code files
- Expose keys in client-side code

---

## 📊 Cost Management

### Expected Costs (Structured Extraction)

| Provider | Model | Cost per 1K tokens | Avg. extraction cost |
|----------|-------|-------------------|---------------------|
| OpenAI | GPT-4o-mini | $0.00015 | ~$0.0002 |
| Anthropic | Claude 3.5 Haiku | $0.00025 | ~$0.0003 |

### Tips to Minimize Costs:
1. Use **DOM mode** when possible (free, faster)
2. Use **hybrid mode** to minimize LLM calls
3. Limit HTML content with `selector` parameter
4. Monitor usage in your provider dashboard
5. Set up billing alerts

---

## 🧪 Testing

### Run All Tests
```bash
npm test
```

### Run Extraction Tests Only
```bash
npm test -- tests/utils/extraction/
npm test -- tests/tools/extraction.test.ts
```

### Run Tests Without API Keys
DOM extraction tests work without API keys:
```bash
npm test -- tests/utils/extraction/dom-extractor.test.ts
```

### Run Tests With API Keys
Set environment variables first, then:
```bash
npm test -- tests/utils/extraction/llm-extractor.test.ts
```

---

## 🐛 Troubleshooting

### "At least one API key required"
- **Cause**: No API keys configured
- **Fix**: Set `OPENAI_API_KEY` or `ANTHROPIC_API_KEY`

### "OpenAI API error"
- **Cause**: Invalid or expired OpenAI key
- **Fix**: Regenerate key at https://platform.openai.com/api-keys

### "Claude API error"
- **Cause**: Invalid or expired Anthropic key
- **Fix**: Regenerate key at https://console.anthropic.com/settings/keys

### "Rate limit exceeded"
- **Cause**: Too many requests to API
- **Fix**: Wait a few minutes, or upgrade your API plan

### Tests timing out
- **Cause**: Network issues or API slowness
- **Fix**: Increase test timeout or check network connection

---

## 📚 Additional Resources

- [OpenAI API Documentation](https://platform.openai.com/docs)
- [Anthropic API Documentation](https://docs.anthropic.com)
- [BOSS Ghost MCP Documentation](./README.md)
- [Extraction Feature Guide](./FIRECRAWL_BOSS_GHOST_INTEGRATION.md)

---

## 💡 Pro Tips

1. **Use .env file for local development** - easier to manage
2. **Use environment variables for CI/CD** - more secure
3. **Start with hybrid mode** - best balance of cost and reliability
4. **Monitor your API usage** - set up billing alerts
5. **Cache results when possible** - avoid redundant extractions

---

**Need Help?** Open an issue on GitHub or check the documentation!
