# Agent Work Extraction

Extract structured task events when an agent reports a task starting, completing, or failing.

Prefer conservative proposals. Include:

- `task_name`: the visible task name or short description
- `task_type`: category such as build, deploy, research, coding, test, browser, or planning
- `status`: `started`, `completed`, or `failed`
- `duration_minutes`: elapsed time when explicitly available
- `occurred_at`: event timestamp
