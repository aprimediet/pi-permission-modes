# Product Requirements Document: permission-modes

**Version:** 1.0
**Date:** 2026-06-25
**Status:** Draft

## Overview
A Claude-Code-style permission-mode system for the pi coding agent. Four modes — default, plan, accept-edits, and auto — cycled with Shift+Tab — that control how tool calls and file edits get approved without changing the underlying model.

## Problem Statement
The pi coding agent lacks granular permission controls during a session. Users who want different levels of autonomy — from full manual approval for every edit to completely hands-off execution — have no way to switch. This friction makes pi less productive than tools like Claude Code that offer mode-based workflows.

## Goals
- Provide four distinct permission modes that control how tool calls (edit, write, bash) are approved
- Let users cycle modes easily via Shift+Tab keyboard shortcut
- Show the current mode in the UI via a status pill and custom footer
- Persist the current mode and auto-follow-up depth across session restarts
- In Plan mode: restrict to read-only exploration, produce a structured plan, then optionally execute it step by step with [DONE:n] tracking

## Non-Goals
- Safety guardrails (out of scope — this extension only manages approval behavior, not model-level safety)
- Switching the AI model per mode (the model stays the same; only approval behavior changes)
- Replacing pi's built-in `--mode` flag for output format (text/json/rpc)
- Providing a full CLI or standalone application (this is a pi extension only)

## Target Users
- Developers who use the pi coding agent for daily development
- Users who want a Claude-Code-like permission workflow in pi
- Developers who want to switch between exploratory (plan) and autonomous (auto) modes within the same session

## Key Features

### Permission Mode Switching
Cycle through four modes with Shift+Tab: Default (prompt on edits) → Plan (read-only) → Accept-edits (auto-approve edits) → Auto (full autonomy). Also available as slash commands (`/default`, `/plan`, `/accept-edits`, `/auto`, `/mode`).

### Plan Mode with Todo Tracking
In Plan mode, edits and writes are disabled and bash is restricted to read-only commands. After exploration, the agent emits a numbered `Plan:` list. The user can execute the plan (switches to auto mode with step tracking via `[DONE:n]` tags), stay in plan mode, or refine the plan.

### UI Integration
A status pill shows the current mode with color-coded role (muted/warning/success/accent). A custom footer displays mode · current-working-directory [git-branch] · model/thinking-level. During execution, live token stats and context usage are shown.

### Keybinding
Shift+Tab cycles permission modes; Alt+T cycles the thinking level (off → minimal → low → medium → high → xhigh). Both are custom keybindings that integrate with pi's shortcut system.

### Persistence
The current mode and auto-mode follow-up depth cap are persisted across `/reload` and session resume via pi's entry storage.

## Success Metrics
- Users can switch modes as easily as they do in Claude Code
- No friction switching between exploratory (plan) and autonomous (auto) workflows
- The status pill and footer always reflect the correct current mode

## Scope & Boundaries
- **In scope:** A pi extension that intercepts `tool_call` events to gate approvals, injects mode-specific context into the agent loop, and provides UI feedback via pi's extension API
- **In scope:** Commands, shortcuts, and a start-up flag (`--permission-mode`) to select the initial mode
- **Out of scope:** Any changes to pi's core, the AI model, or safety guardrails
- **Out of scope:** Third-party dependencies beyond pi's core peer packages (@earendil-works/pi-coding-agent, @earendil-works/pi-ai, @earendil-works/pi-tui, typebox)

## Open Questions
- None at this time.
