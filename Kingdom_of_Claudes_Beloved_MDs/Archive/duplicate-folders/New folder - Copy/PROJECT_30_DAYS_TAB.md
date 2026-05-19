# Project 30 Days Dashboard Tab

## Overview

Adds a dedicated `30 Days` tab under Analytics Dashboard `Project` mode.

The tab filters project session summaries to the last 30 days (`startedAt >= now - 30d`) and renders the existing project overview analytics on that filtered subset.

## Key Files

- `src/webview/components/Dashboard/DashboardPanel.tsx`
  - Registers project tab key `p-30-days`
  - Adds tab label `30 Days`
  - Routes tab rendering to `Project30DaysTab`

- `src/webview/components/Dashboard/tabs/Project30DaysTab.tsx`
  - Filters `SessionSummary[]` by `startedAt`
  - Shows a small context header (count + cutoff date)
  - Reuses `ProjectOverviewTab` for charts and metric cards

## Behavior

- If no sessions exist in the last 30 days, shows `No sessions in the last 30 days`.
- If sessions exist, shows filtered analytics without changing stored project data.
- Project mode default tab remains `Overview`.

