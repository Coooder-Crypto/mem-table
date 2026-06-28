# OpenClaw Example

Use the OpenClaw enhancer with the local MemTable sidecar:

```bash
memtable init
memtable pack install packs/fitness
memtable serve --http
memtable agent enable openclaw
```

After the OpenClaw plugin is enabled, OpenClaw can observe interaction events and call:

- `memtable_ask`
- `memtable_propose`
- `memtable_list_proposals`
- `memtable_commit_proposal`
