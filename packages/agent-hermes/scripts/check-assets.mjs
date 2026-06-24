import { access } from "node:fs/promises";

await access(new URL("../memtable_hermes/plugin.yaml", import.meta.url));
await access(new URL("../memtable_hermes/__init__.py", import.meta.url));
await access(new URL("../memtable_hermes/tools.py", import.meta.url));

