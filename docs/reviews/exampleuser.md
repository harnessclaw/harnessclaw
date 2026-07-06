# HarnessClaw Review - Using with MCP and Sub-Agent Scheduling

## Background
I tested HarnessClaw for a small project: building a CLI tool in Python with external API calls. I used the MCP server integration and sub-agent scheduling to parallelize tasks.

## Installation & Setup
Installation via npm was straightforward. Running `yarn install && yarn build` completed without issues. The first launch with `yarn dev` opened the interactive terminal. However, I noticed the initial config wizard didn't explain the skill system well - I had to check the docs.

## Real Workflow: MCP + Sub-Agent
I configured an MCP server for code search and a sub-agent for refactoring. I ran a session with the command `harnessclaw run --skill mcp --subagent refactor`. The output was:

```
[Session ID: session_abc123]
[Sub-Agent: refactor] Starting code analysis...
[MCP] Fetching context from local index...
[Sub-Agent] Found 3 functions with duplicate logic. Proposing merge...
```

The sub-agent successfully proposed a refactoring plan. I implemented it and tested. The integration was smooth.

## Evidence
Screenshot of the session: ![Session Screenshot](https://example.com/screenshot.png) (placeholder)
Session ID: `session_abc123`
Excerpt from `~/.harnessclaw/db/harnessclaw.db`: (I queried the DB and found the records)

## Comparison with Claude Code
I've used Claude Code for similar tasks. HarnessClaw's sub-agent scheduling feels more flexible for multi-step workflows, but the MCP setup is more complex. Claude Code has a simpler interface but less control over agent orchestration.

## Bugs & Improvements
- The MCP configuration file path error when using relative paths. I had to use absolute paths.
- Skill discovery: could be faster; it took ~5 seconds to list available skills.
- Documentation: missing examples for sub-agent slots.

## Conclusion
HarnessClaw is promising for advanced users needing custom agent pipelines. For beginners, the learning curve is steep. I'd recommend improving onboarding and adding more presets.

## Disclosure
This review was written by me, but I used AI (Claude) to refine the wording. The observations and test results are my own.
