# Agent Task Template

Use this template before assigning any sub-agent or human contributor. The goal
is to prevent broad, overlapping, or speculative work.

## Task Header

- Task ID:
- Module owner:
- Agent type: `explorer` or `worker`
- Code edits allowed: `yes` / `no`
- Branch/worktree:
- Priority: `P0` / `P1` / `P2`

## Objective

Describe the concrete outcome in one paragraph. Do not ask the agent to "review
everything" or "fix the system".

## Source Of Truth

List the exact files/docs the agent must use:

- Specification volume or registry:
- Current code files:
- Existing docs:
- Tests:

## File Scope

Allowed read scope:

- 

Allowed write scope:

- 

Do not edit:

- 

## Non-Goals

The agent must not:

- Refactor unrelated modules.
- Rename routes, statuses, roles, or entities outside the task scope.
- Change branding or UI style unless the task is a design-system task.
- Revert user or other-agent changes.
- Add new product features while fixing foundations.

## Required Output

For explorer tasks:

- Findings ordered by severity.
- Exact file/line references where possible.
- Recommended next task IDs.

For worker tasks:

- Files changed.
- Behavior changed.
- Tests added/updated.
- Commands run.
- Risks left.

## Acceptance Checks

- 

## Handoff Notes

- What should the next agent know?
- What decisions still need product-owner approval?
