# Tab Tooltip Bug Report

## Requirement

Show a description when hovering the native VS Code tab of a ClaUi `WebviewPanel`, without changing the visible tab label.

## Verified Constraint

As of 2026-03-30, the official VS Code API still does not expose a separate tooltip field for `WebviewPanel`.

- `WebviewPanel` has `title`, `iconPath`, `viewColumn`, `viewType`, `visible`, `active`, `webview`, and `options`
- There is no `tooltip` property
- There is no `description` property
- `vscode.Tab` is observational/read-only, not a mutation API for native tab metadata

Official docs checked:
- `WebviewPanel`: https://code.visualstudio.com/api/references/vscode-api#WebviewPanel
- `Tab`: https://code.visualstudio.com/api/references/vscode-api#Tab

## What We Learned

- For a webview tab, native hover text comes from `panel.title`
- `panel.title` also controls the visible tab label
- Adding extra text to `panel.title` makes that text appear in the tab label too
- Using separators such as ` -- ` or `\n` does not solve this cleanly
- An in-webview tooltip or chip is not the same as hovering the native VS Code tab

## Current Repo State

The experimental workaround code was removed.

- No `panel.title` tooltip hack is active
- No in-webview tab-name chip is active
- No extra session-description message flow is active

Only this document preserves the findings.

## Conclusion

There is currently no supported way to satisfy the exact requirement:

`native VS Code tab hover tooltip for a WebviewPanel, with text different from the visible tab label`

## Realistic Future Options

1. Wait for a future VS Code API that adds something like `WebviewPanel.tooltip`
2. Accept the `panel.title` tradeoff and keep the tab label polluted
3. Surface the description somewhere else, knowing it is not native tab hover
