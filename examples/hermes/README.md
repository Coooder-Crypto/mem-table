# Hermes Example

Use the Hermes enhancer with the local MemTable sidecar:

```bash
memtable init
memtable pack install packs/fitness
memtable serve --http
memtable agent enable hermes
```

After the Hermes plugin is enabled, Hermes can observe interaction events and call:

- `memtable_ask`
- `memtable_propose`
- `memtable_record`
- `memtable_list_proposals`
- `memtable_commit_proposal`
