export interface ServerOptions {
  http?: boolean;
  mcp?: boolean;
  port?: number;
}

export function describeServer(options: ServerOptions = {}): string {
  const modes = [
    options.http ? "http" : undefined,
    options.mcp ? "mcp" : undefined
  ].filter(Boolean);

  return `memtable server modes: ${modes.length > 0 ? modes.join(",") : "none"}`;
}

