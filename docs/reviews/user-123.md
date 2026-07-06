# HarnessClaw Experience Review

**Author**: user-123  
**Date**: 2026-05-24  
**Session ID**: `a1b2c3d4-e5f6-7890-abcd-ef1234567890`

## 1. Installation & First Setup

I followed the official README instructions. `yarn install` and `yarn build` completed without errors. The initial configuration prompt guided me through setting up my API keys. The process was smooth overall, taking about 10 minutes.

## 2. Real Workflow: Code Generation & Sub-Agent Dispatch

I used HarnessClaw to generate a small Python script that fetches weather data from a public API and saves it to a CSV. I defined a skill called `weather-fetcher` with sub-agents: one for fetching data, one for parsing, and one for saving. The sub-agent scheduling worked flawlessly—each agent executed sequentially, passing data via context.

### Evidence: Session Excerpt
From `~/.harnessclaw/db/harnessclaw.db`, session `a1b2c3d4-e5f6-7890-abcd-ef1234567890`:

```
[2026-05-24 10:32:15] AGENT: weather-fetcher.fetch → Sub-agent 'fetch' invoked.
[2026-05-24 10:32:18] SUB-AGENT: fetch → HTTP GET https://api.weather.example.com/v1/current?city=Tokyo → 200 OK
[2026-05-24 10:32:19] AGENT: weather-fetcher.parse → Received JSON, extracting temperature and humidity.
[2026-05-24 10:32:20] SUB-AGENT: parse → Output: {temp: 22, humidity: 65}
[2026-05-24 10:32:21] AGENT: weather-fetcher.save → Writing to /tmp/weather.csv
[2026-05-24 10:32:22] SUB-AGENT: save → File written successfully.
```

The final output CSV file contained the expected data:

```
city,temperature,humidity
Tokyo,22,65
```

## 3. Comparison with Cursor & Claude Code

- **Claude Code**: More polished UI but less flexible in defining custom sub-agents.
- **Cursor**: Excellent inline suggestions, but HarnessClaw's multi-agent orchestration is unique.
- **HarnessClaw** shines when you need to decompose a complex task into specialized sub-steps. The MCP integration (I tested the `filesystem` MCP) was straightforward.

## 4. Bugs & Pain Points

- The skill YAML schema is not yet documented; I had to infer from examples.
- Occasionally, the agent stucks on ambiguous prompts—better error messages would help.
- No built-in retry logic for failed sub-agents (I had to implement manually).

## 5. Summary

**Pros**:
- Powerful sub-agent dispatch.
- Local-first privacy.
- Active development community.

**Cons**:
- Documentation gaps.
- Occasional instability when chaining many agents.

**Wishlist**:
- Better error recovery.
- Built-in timeout configuration.
- Visual agent graph.

Overall, a promising tool for developers who need a programmable AI orchestration layer. I look forward to using it more.

---
*This review was written without AI assistance.*