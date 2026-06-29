import type { MemTableRuntime, Proposal, ProposalStatus, RecordEntry } from "@memtable/core";

export interface ProposalReviewFilter {
  status: ProposalStatus | undefined;
  schema: string | undefined;
}

export interface BatchProposalReviewResult<T extends Proposal | RecordEntry> {
  action: "commit" | "reject";
  matched: number;
  processed: number;
  filters: {
    status: ProposalStatus | ProposalStatus[];
    schema?: string;
  };
  results: T[];
}

const DEFAULT_REVIEW_STATUSES: ProposalStatus[] = ["pending", "needs_review"];

export async function listFilteredProposals(runtime: MemTableRuntime, filter: ProposalReviewFilter): Promise<Proposal[]> {
  const proposals = await runtime.listProposals(filter.status);
  return filter.schema ? proposals.filter((proposal) => proposal.schema_name === filter.schema) : proposals;
}

export async function commitAllProposals(
  runtime: MemTableRuntime,
  filter: ProposalReviewFilter,
  actor: string
): Promise<BatchProposalReviewResult<RecordEntry>> {
  const proposals = await reviewableProposals(runtime, filter);
  const records: RecordEntry[] = [];
  for (const proposal of proposals) {
    records.push(await runtime.commitProposal(proposal.id, { actor }));
  }

  return {
    action: "commit",
    matched: proposals.length,
    processed: records.length,
    filters: batchFilters(filter),
    results: records
  };
}

export async function rejectAllProposals(
  runtime: MemTableRuntime,
  filter: ProposalReviewFilter,
  actor: string
): Promise<BatchProposalReviewResult<Proposal>> {
  const proposals = await reviewableProposals(runtime, filter);
  const rejected: Proposal[] = [];
  for (const proposal of proposals) {
    rejected.push(await runtime.rejectProposal(proposal.id, { actor }));
  }

  return {
    action: "reject",
    matched: proposals.length,
    processed: rejected.length,
    filters: batchFilters(filter),
    results: rejected
  };
}

export function proposalStatusValue(value: unknown): ProposalStatus | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (value === "pending" || value === "needs_review" || value === "committed" || value === "rejected") {
    return value;
  }
  throw new Error(`Unsupported proposal status: ${String(value)}`);
}

export function stringFilterValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

async function reviewableProposals(runtime: MemTableRuntime, filter: ProposalReviewFilter): Promise<Proposal[]> {
  if (filter.status) {
    return listFilteredProposals(runtime, filter);
  }

  const proposals = await listFilteredProposals(runtime, {
    status: undefined,
    schema: filter.schema
  });
  return proposals.filter((proposal) => DEFAULT_REVIEW_STATUSES.includes(proposal.status));
}

function batchFilters(filter: ProposalReviewFilter): BatchProposalReviewResult<Proposal>["filters"] {
  return {
    status: filter.status ?? DEFAULT_REVIEW_STATUSES,
    ...(filter.schema ? { schema: filter.schema } : {})
  };
}
