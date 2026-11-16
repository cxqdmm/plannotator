/**
 * Which kind of session the mod is in, and what it does there (a hooks module may import only its own files).
 * What can regress: a panel host's chat read as headless (or a headless run read as the panel), and a feature
 * turned on in a kind of session where it cannot work.
 */
import { describe, expect, test } from 'bun:test'
import { isPanelEntrypoint, panelHostOwnsPlanMode, sessionKindOf, SESSION_KIND_FEATURES } from './enabled'

describe('what the mod does in each kind of session', () => {
  test('the panel hosts, and which of them draws its own plan card (Orca only, for now)', () => {
    for (const entrypoint of ['claude-vscode', 'orca']) expect([entrypoint, isPanelEntrypoint(entrypoint)]).toEqual([entrypoint, true])
    for (const entrypoint of ['claude-desktop', 'sdk-ts', 'sdk-cli', 'cli', 'claude-vscode-insiders', 'Claude-Desktop', 'constructor', 'toString', '', undefined, 1]) {
      expect([entrypoint, isPanelEntrypoint(entrypoint), panelHostOwnsPlanMode(entrypoint)]).toEqual([entrypoint, false, false])
    }
    expect(['claude-vscode', 'orca'].filter(panelHostOwnsPlanMode)).toEqual(['orca'])
  })

  test('sorted: the terminal first, then the VS Code panel, else headless', () => {
    expect(sessionKindOf({ isInteractive: true, panel: false })).toBe('terminal')
    expect(sessionKindOf({ isInteractive: false, panel: true })).toBe('panel')
    expect(sessionKindOf({ isInteractive: false, panel: false })).toBe('headless')
  })

  // The owner's rule (2026-11-14): the mod is active in every session; a feature stays classic only where it
  // cannot work. A one-shot run ends with its turn, so nothing promised for later may depend on it.
  test('the table', () => {
    expect(SESSION_KIND_FEATURES).toEqual({
      terminal: { reviews: true, planReview: true, inboxTool: true, wake: true },
      panel: { reviews: true, planReview: true, inboxTool: true, wake: true },
      // The Inbox tool sends and reads; reviews and plans keep the CLI, which waits for the decision inside the run.
      headless: { reviews: false, planReview: false, inboxTool: true, wake: false },
    })
  })
})
