# Plannotator agent guidance

Plannotator is a plan review UI for Claude Code that intercepts `ExitPlanMode` via hooks, letting users approve or request changes with annotated feedback. It also provides code review for git diffs, annotation of arbitrary Markdown files, and an Inbox.

This repo is an independent fork (`chinese-fork`): only the Claude Code and OpenCode integrations are kept, all UI text is being translated to Simplified Chinese in place (no i18n framework), and it never merges upstream. `CLAUDE.md` is a symlink to this file; `packages/ui/AGENTS.md` adds guidance scoped to `packages/ui/`.

## Hard rules (read before touching anything)

- **Never compromise UX.** Plannotator has to work well and feel like magic. Don't add friction for defensive reasons: no extra gates, confirmations, owner-only checks, warnings or settings that make it harder to use. Fix real bugs without making the product worse to use.
- **One experience across a person's devices.** Every Inbox feature works the same on a thread, agent or project that lives on another of the person's linked machines as on this one. Send the action to the machine that owns the thing; if an older or offline machine cannot take it yet, that is the one allowed gap and it closes when that machine updates.
- **`packages/ui` is the shared document UI.** Never rebuild it from scratch: read [`packages/ui/README.md`](packages/ui/README.md) FIRST. Extend `@plannotator/ui` through a seam (`configurePlannotatorUI()`), and never delete working code until a human confirms parity in the browser.
- **One server runtime.** The Bun server (`packages/server/`) is the only server; logic shared with the hooks module or the Inbox lives in `packages/shared/`. Runtime recognition of other agents' existing sessions (Codex, DSH, Hermes, Cline, OpenClaw, … in `packages/server` and `apps/hook/hooks/mod/`) is kept on purpose — do not remove it.
- **Build order: review, then hook, then opencode.** `bun run --cwd apps/review build && bun run build:hook && bun run build:opencode`; building out of order copies stale HTML.
- **Tailwind `@source`.** A new directory with `.tsx` files that use Tailwind classes needs a matching `@source` entry in the app's `index.css`.
- **Testing Rules:**
  - Tests and dev scripts never touch the real `~/.plannotator`, the real Inbox or user config: sandbox under a temp `PLANNOTATOR_DATA_DIR`, and mutate globals only inside tests with a restore.
  - Tests never open a browser: set `NO_BROWSER` from `tests/helpers/no-browser.ts`, never `PLANNOTATOR_BROWSER=none` (or another sentinel).
  - Tests never run the real GitHub CLI, and never signal an Inbox except through `tests/helpers/inbox-process.ts`.
  - Every test guards a behavior that can regress: no copy snapshots of prose, no round-trip prop tests, no implementation echo.
  - Test agent-facing instructions (tool text, skills, `--help`) clean room: a fresh agent with only that text, in a scratch folder outside this repo, given a real task.
- **Agent-facing text is never translated.** Tool descriptions, skill files, CLI `--help`, and the export formats agents parse (`'Plan Feedback'`, `Feedback on:`, `'## Page:'`, `'Answers to your questions'`, `Recommended:`/`Stakes:`/`Holds up:` markers) stay exactly as they are; only browser UI strings are translated.
- **No new Inbox keyboard shortcuts without the owner's approval.**
- **Git:** never rebase or force-push a shared branch; merge main instead.
- **Releases:** follow [`.agents/skills/release/SKILL.md`](.agents/skills/release/SKILL.md).

This fork keeps no `docs/` tree. Put durable notes in code comments or the commit message, not in new doc files.
