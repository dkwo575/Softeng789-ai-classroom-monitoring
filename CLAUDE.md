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
