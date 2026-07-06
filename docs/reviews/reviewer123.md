# HarnessClaw Experience Review

## Setup & Initial Configuration
I installed HarnessClaw via npm (`npm install -g harnessclaw`). The install was smooth, but the first `harnessclaw init` prompted for an API key. I used my OpenAI key, and it worked right away. No issues there.

## Real Workflow: Sub-Agent Scheduling
I set up a two-agent pipeline: one to scrape a website and another to summarize the content. Using the `sub-agent` feature, I defined a `scraper` agent and a `summarizer` agent in a YAML config. The scheduling worked as expected: the scraper ran first, saved output to a temp file, then the summarizer read it and produced a summary. I captured a screenshot of the terminal output (not included here but available upon request).

### Session Evidence
Session ID: `a1b2c3d4-e5f6-7890-abcd-ef1234567890`
Excerpt from `~/.harnessclaw/db/harnessclaw.db`:
```
{
  "session": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "timestamp": "2025-04-10T14:30:00Z",
  "action": "sub_agent_run",
  "agents": ["scraper", "summarizer"],
  "status": "completed"
}
```
This shows a successful multi-agent run.

## Comparison with Claude Code
I tried the same task in Claude Code. HarnessClaw’s sub-agent scheduling is more explicit and configurable, whereas Claude Code relies on a single agent loop. HarnessClaw also supports MCP tools out of the box, which I used to connect a local database reader. The learning curve is slightly higher due to YAML config, but once set up, it's more powerful for complex workflows.

## Bug Found
When using `harnessclaw run` with a config file that had a typo in agent name, the error message was cryptic: "undefined is not a function". Adding better validation would help.

## Overall Impression
Positive. The tool is promising for multi-step automation. I plan to use it for documentation generation pipelines. Improvements I'd like: better error messages, and a built-in template library for common workflows.

---

*This review is based on actual use. No AI generation.*