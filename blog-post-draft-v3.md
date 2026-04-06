# [Template Name]

**Published:** [Date] | **Authors:** [Authors] | **Category:** Templates

*An open-source template for building background agents on Vercel.*

---

Most AI-assisted workflows today are synchronous. You prompt, you wait, you review, you prompt again. The model works while you watch. If you close your laptop, the work stops.

Background agents work differently. You assign a task, the agent spins up an isolated cloud environment, and it works independently until the task is done. You can assign multiple tasks in parallel. You can close your laptop. The agent commits its work, opens a pull request, and you review the output the same way you'd review a colleague's.

This is a hard technical problem to solve. The agent needs a fully isolated execution environment in the cloud. That environment needs to persist across interruptions, hibernate when idle, and restore without losing state. The agent needs tools, context management for long-running sessions, and a way to deliver its work back to you through your existing workflows.

Ramp [built this from scratch](https://builders.ramp.com/post/why-we-built-our-background-agent) for their engineering team. So have several other companies we work with. Each invested months building the same infrastructure: sandboxed execution, tool systems, lifecycle management, git automation.

Today we're open-sourcing a template that provides all of these pieces, built on Vercel's infrastructure primitives for agentic applications. It ships as a coding agent, because that's the most immediate use case, but the architecture is a starting point for any background agent: code review, testing, data pipelines, compliance checks, or whatever your team needs agents to do independently.

## Why cloud, not local

AI-assisted coding tools have changed how engineers work. But they're fundamentally limited when they run on your local machine. Your laptop is a single-threaded bottleneck. You can only work with one agent at a time. The agent competes for your machine's resources. If your connection drops, the session dies.

Moving agent execution to the cloud removes these constraints. Each agent gets its own isolated environment with dedicated compute. You can run several agents in parallel on different tasks. The work survives disconnections. And because agents run in standardized cloud environments rather than on individual developer machines, the results are more reproducible.

This is why we've been investing in infrastructure primitives for agentic applications: [sandboxes](https://vercel.com/docs/sandboxes) for isolated execution, the [AI SDK](https://ai-sdk.dev) for model integration and tool calling, and lifecycle management for long-running workloads. This template shows how those primitives compose into a complete background agent system.

## What's inside

### Sandboxed execution

Each agent session runs in its own sandbox on Vercel with a full runtime environment: Node.js, Bun, git, and package managers. The sandbox provides filesystem operations, process execution with timeout controls, and network endpoint mapping so agents can start servers and interact with them.

The sandbox abstraction is provider-based. The current implementation runs on Vercel's sandbox infrastructure, but the interface is defined separately from the implementation. If you want to run sandboxes on your own infrastructure, you implement the same contract: file I/O, shell execution, snapshotting, and lifecycle management.

Lifecycle management is where background agents get operationally complex. Sandboxes move through defined states (provisioning, active, hibernating, hibernated, restoring, archived, failed). Inactivity timeouts trigger hibernation automatically, and the system takes a snapshot before hibernating so the sandbox can be restored exactly where it left off. Snapshot operations are idempotent. If a snapshot is already in progress, the system detects it and avoids conflicts rather than failing.

### Agent runtime

The agent is a structured tool-calling loop built on the AI SDK. It has access to tools that mirror what an engineer uses: reading and writing files, executing shell commands, searching code with regex, finding files by pattern, fetching web content, and managing a todo list to track multi-step work.

The system prompt encodes specific engineering practices. The agent reads a file before editing it, prefers targeted searches over serial file reading, runs the project's own scripts rather than generic commands, detects the package manager from lockfiles, and re-runs verification after every change until checks pass. These are hard constraints, not suggestions.

Because the template ships as a coding agent, the tool layer and system prompt are tuned for software engineering tasks. But the runtime itself is general-purpose. Replace the tools and the prompt, and you have a background agent for a different domain entirely.

### Multi-agent delegation

A single agent trying to handle every aspect of a complex task tends to lose focus. The template uses a delegation model where the primary agent can spawn specialized subagents: an **explorer** for read-only analysis, an **executor** for scoped implementation work, and a **designer** for frontend interfaces. Each subagent runs autonomously for up to 100 tool steps, then returns a summary to the primary agent.

This is a pattern that generalizes well beyond coding. Any background agent dealing with multi-faceted tasks benefits from decomposing work across specialists rather than trying to hold everything in a single context.

### Git automation

The agent can commit and push its work automatically. The auto-commit flow detects dirty files, generates a conventional commit message using Claude Haiku (constrained to one line, 72 characters max, with the diff truncated to 8,000 characters as input), sets the git author from the linked GitHub account, and pushes to the branch.

Auto-PR creation has guardrails: it rejects detached HEAD states, validates branch names against a safety pattern, checks that the local branch is fully pushed before creating the PR, reuses existing PRs for the same branch, and handles creation race conditions gracefully. PR titles and descriptions are generated from the diff.

### Context management

Background agents run longer than interactive sessions, which means they hit context window limits. The template includes a context management layer with cache control policies and aggressive compaction, trimming and summarizing earlier parts of the conversation to keep the working context within the model's token budget.

This is one of the harder problems in building reliable background agents. An agent that loses track of what it's already done, or forgets the original task requirements halfway through, produces bad work. The context management layer is designed to prevent that.

### Skills

The agent supports a skills system for adding capabilities without modifying the core. Skills are discoverable modules with metadata that declare whether they can be invoked by the model, the user, or both. The system prompt dynamically lists available skills, and the agent invokes them when relevant.

This is the extension point. Add domain-specific behavior (internal API integrations, custom workflows, compliance checks) as skills rather than modifying the agent runtime.

## Getting started

Clone the repo, run `bun install`, link your Vercel project, and start the dev server. The setup script pulls environment variables and configures OAuth for Vercel and GitHub. Once running, you can create a session, point it at a repo, give it a task, and review the output as commits and pull requests.

The template is designed to be forked. Swap model providers through the AI SDK. Add tools for your internal systems. Change the system prompt to match your workflows. Replace the sandbox provider. Use it as a coding agent out of the box, or as the foundation for whatever background agent your team needs.

The entire codebase is MIT-licensed.

[Deploy on Vercel →](#) | [View on GitHub →](#)
