import * as vscode from 'vscode';

/**
 * Opens a new VS Code webview tab that renders the given HTML content.
 * Uses a relaxed CSP so that inline styles, scripts, and images work.
 */
export function openHtmlPreviewPanel(html: string, title?: string): void {
  const panel = vscode.window.createWebviewPanel(
    'claudeMirror.htmlPreview',
    title || 'HTML Preview',
    vscode.ViewColumn.Beside,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
    },
  );

  // If the content is already a full HTML document, use it directly.
  // Otherwise wrap it in a minimal shell with a permissive CSP.
  const isFullDocument = /^\s*<!doctype\s+html/i.test(html) || /^\s*<html[\s>]/i.test(html);
  panel.webview.html = isFullDocument ? html : buildPreviewHtml(html);
}

function buildPreviewHtml(userHtml: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none';
                 style-src 'unsafe-inline' https: data:;
                 script-src 'unsafe-inline' https:;
                 img-src https: data: blob:;
                 font-src https: data:;
                 connect-src https:;">
  <title>HTML Preview</title>
</head>
<body style="margin:0; padding:0;">
${userHtml}
</body>
</html>`;
}
