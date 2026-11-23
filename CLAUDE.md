@AGENTS.md

## Claude Code

You are the Claude Code agent in the multi-agent workflow above. The user's assignment for a task
overrides your default focus.

- For UI checks, follow "Before a UI check" above and use the built-in browser at desktop width and
  390px mobile width with no horizontal overflow.
- Review Codex branches and pull requests with `/code-review`. Use `/security-review` for changes that
  touch face data, authentication or sessions.
- When another agent will implement, write the task brief in the format above. Put it in the pull
  request description or give it to the user to paste.
- For your frontend part of a split task, add a worktree under `D:\UOA2\2026\` on a `DoJun/*` branch.
  Build only against the brief's API contract. Hand off to Codex for review in the handoff format.
  Then integrate the reviewed result into the main checkout.
