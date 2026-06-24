import type { AgentEvent, ObserveResult } from "../observe/types.js";

export interface MemTableRuntimeOptions {
  storage?: {
    driver: "sqlite";
    path: string;
  };
}

export class MemTableRuntime {
  private constructor(readonly options: MemTableRuntimeOptions) {}

  static async open(options: MemTableRuntimeOptions = {}): Promise<MemTableRuntime> {
    return new MemTableRuntime(options);
  }

  async observe(_event: AgentEvent): Promise<ObserveResult> {
    return {
      status: "ignored",
      matched_packs: [],
      proposals_created: 0,
      records_committed: 0,
      needs_review: 0
    };
  }
}

