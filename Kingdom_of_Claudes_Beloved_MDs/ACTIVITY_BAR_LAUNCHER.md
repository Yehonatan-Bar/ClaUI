# ClaUi Activity Bar Launcher

## What It Adds

ClaUi now contributes its own Activity Bar icon (left sidebar icon in VS Code) and a small sidebar launcher view.

- Container id: `claui`
- View id: `claui.sidebarLauncher`
- View type: `webview`

The launcher is intentionally lightweight and does not embed the full chat UI. It provides quick actions that call existing extension commands:

- `claudeMirror.startSession`
- `claudeMirror.showHistory`
- `claudeMirror.discoverSessions`
- `claudeMirror.openLogDirectory`

This keeps the current multi-tab webview panel architecture unchanged while giving ClaUi a dedicated sidebar entry like other VS Code extensions.

## Files

- `package.json`: adds `contributes.viewsContainers.activitybar` and `contributes.views`
- `images/claui-activity.svg`: monochrome `currentColor` Activity Bar icon
- `src/extension/sidebar/ClaUiSidebarViewProvider.ts`: launcher `WebviewViewProvider`
- `src/extension/extension.ts`: registers the sidebar view provider during activation

## Notes

- This is separate from the Marketplace icon (`package.json -> icon`).
- Users can still hide/move the Activity Bar entry manually in VS Code.
