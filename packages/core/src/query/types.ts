export type QueryOperator = "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "in" | "between" | "exists";

export type AggregateOperator = "count" | "sum" | "avg" | "min" | "max";

export type QueryFilterValue =
  | string
  | number
  | boolean
  | null
  | {
      [operator in QueryOperator]?: unknown;
    };

export interface QueryDsl {
  collection: string;
  filter?: Record<string, QueryFilterValue>;
  aggregate?: Record<string, { op: AggregateOperator; field?: string }>;
  groupBy?: {
    field: string;
    interval?: "day" | "week" | "month";
  };
  orderBy?: {
    field: string;
    direction?: "asc" | "desc";
  };
  limit?: number;
}

export interface QueryResult {
  status: "ok" | "insufficient_data";
  rows: Array<Record<string, unknown>>;
  records_used: number;
  source_ids: string[];
  time_range?: {
    from?: string;
    to?: string;
  };
  query: QueryDsl;
}

export interface AskResult {
  status: "ok" | "insufficient_data";
  answer: string;
  records_used: number;
  source_ids: string[];
  time_range?: {
    from?: string;
    to?: string;
  };
  query?: QueryDsl;
}

