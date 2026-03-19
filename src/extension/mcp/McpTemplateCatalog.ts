import type { McpTemplateDefinition } from '../types/webview-messages';

const WINDOWS_NPX_ARGS = ['/c', 'npx', '-y'];

export class McpTemplateCatalog {
  listTemplates(): McpTemplateDefinition[] {
    return [
      {
        id: 'github',
        title: 'GitHub',
        description: 'Remote GitHub MCP server using HTTP transport and a bearer token.',
        transport: 'http',
        defaultName: 'github',
        defaultScope: 'project',
        url: 'https://api.githubcopilot.com/mcp',
        headers: {
          Authorization: 'Bearer ${GITHUB_TOKEN}',
        },
        fields: [
          {
            id: 'github-token',
            label: 'GitHub token',
            target: 'header',
            key: 'Authorization',
            envVar: 'GITHUB_TOKEN',
            placeholder: 'ghp_...',
            required: true,
            secret: true,
            description: 'Stored in SecretStorage and written to config as ${GITHUB_TOKEN}.',
          },
        ],
        notes: [
          'Project scope is recommended so the team shares the same server definition.',
          'Only the ${GITHUB_TOKEN} placeholder is written to config.',
        ],
      },
      {
        id: 'playwright',
        title: 'Playwright',
        description: 'Local browser automation via the Playwright MCP server.',
        transport: 'stdio',
        defaultName: 'playwright',
        defaultScope: 'project',
        command: 'cmd',
        args: [...WINDOWS_NPX_ARGS, '@playwright/mcp@latest'],
        fields: [],
        notes: [
          'Windows-safe default wraps npx with cmd /c.',
          'Install-on-run may require Node/npm on PATH.',
        ],
      },
      {
        id: 'brave-search',
        title: 'Brave Search',
        description: 'Local stdio server for Brave web search.',
        transport: 'stdio',
        defaultName: 'brave',
        defaultScope: 'user',
        command: 'cmd',
        args: [...WINDOWS_NPX_ARGS, '@anthropic/server-brave-search'],
        env: {
          BRAVE_API_KEY: '${BRAVE_API_KEY}',
        },
        fields: [
          {
            id: 'brave-api-key',
            label: 'Brave API key',
            target: 'env',
            key: 'BRAVE_API_KEY',
            envVar: 'BRAVE_API_KEY',
            placeholder: 'BSA...',
            required: true,
            secret: true,
            description: 'Stored in SecretStorage and injected into Claude runs launched from ClaUi.',
          },
        ],
        notes: [
          'User scope is a better default for personal search credentials.',
        ],
      },
      {
        id: 'sentry',
        title: 'Sentry',
        description: 'Remote Sentry MCP endpoint. Sign-in typically completes from /mcp inside Claude.',
        transport: 'http',
        defaultName: 'sentry',
        defaultScope: 'project',
        url: 'https://mcp.sentry.dev/mcp',
        fields: [],
        notes: [
          'After adding, restart the Claude session and run /mcp if auth is required.',
        ],
      },
      {
        id: 'slack',
        title: 'Slack',
        description: 'Slack MCP server template with token placeholder.',
        transport: 'http',
        defaultName: 'slack',
        defaultScope: 'project',
        url: 'https://mcp.slack.com/mcp',
        headers: {
          Authorization: 'Bearer ${SLACK_MCP_TOKEN}',
        },
        fields: [
          {
            id: 'slack-token',
            label: 'Slack token',
            target: 'header',
            key: 'Authorization',
            envVar: 'SLACK_MCP_TOKEN',
            placeholder: 'xoxb-...',
            required: true,
            secret: true,
            description: 'Stored in SecretStorage and written to config as ${SLACK_MCP_TOKEN}.',
          },
        ],
        notes: [
          'If your Slack deployment uses a different endpoint, edit the URL before saving.',
        ],
      },
      {
        id: 'postgres',
        title: 'Postgres',
        description: 'Database access over stdio with a connection string placeholder.',
        transport: 'stdio',
        defaultName: 'postgres',
        defaultScope: 'user',
        command: 'cmd',
        args: [...WINDOWS_NPX_ARGS, '@modelcontextprotocol/server-postgres'],
        env: {
          DATABASE_URL: '${DATABASE_URL}',
        },
        fields: [
          {
            id: 'postgres-url',
            label: 'Database URL',
            target: 'env',
            key: 'DATABASE_URL',
            envVar: 'DATABASE_URL',
            placeholder: 'postgres://user:pass@host:5432/db',
            required: true,
            secret: true,
            description: 'Stored in SecretStorage; config keeps only ${DATABASE_URL}.',
          },
        ],
        notes: [
          'User scope is safer for developer-specific connection strings.',
        ],
      },
      {
        id: 'context7',
        title: 'Context7',
        description: 'Context7 documentation MCP server over stdio.',
        transport: 'stdio',
        defaultName: 'context7',
        defaultScope: 'project',
        command: 'cmd',
        args: [...WINDOWS_NPX_ARGS, '@upstash/context7-mcp@latest'],
        fields: [],
        notes: [
          'Project scope works well when the whole team wants the same documentation helper.',
        ],
      },
      {
        id: 'codex',
        title: 'Codex',
        description: 'Expose the local Codex MCP bridge to Claude via stdio.',
        transport: 'stdio',
        defaultName: 'codex',
        defaultScope: 'user',
        command: 'cmd',
        args: ['/c', 'codex', 'mcp'],
        fields: [],
        notes: [
          'Requires the codex CLI to be installed separately.',
          'Claude tabs can call this MCP server; Codex tabs remain read-only in ClaUi.',
        ],
      },
    ];
  }
}
