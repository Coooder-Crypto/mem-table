import type { RecordEntry } from "../ledger/types.js";
import type { AggregateOperator, QueryDsl, QueryFilterValue, QueryResult } from "./types.js";

export function executeQuery(records: RecordEntry[], query: QueryDsl): QueryResult {
  const filteredRecords = records.filter((record) => matchesFilter(record, query.filter ?? {}));
  const rows = query.groupBy
    ? groupedRows(filteredRecords, query)
    : [aggregateRow(filteredRecords, query.aggregate ?? {})];
  const orderedRows = orderRows(rows, query);
  const limitedRows = typeof query.limit === "number" ? orderedRows.slice(0, query.limit) : orderedRows;
  const range = timeRange(filteredRecords);

  return {
    status: filteredRecords.length > 0 ? "ok" : "insufficient_data",
    rows: limitedRows,
    records_used: filteredRecords.length,
    source_ids: unique(filteredRecords.map((record) => record.source_id).filter(isString)),
    query,
    ...(range ? { time_range: range } : {})
  };
}

function matchesFilter(record: RecordEntry, filter: Record<string, QueryFilterValue>): boolean {
  return Object.entries(filter).every(([field, expected]) => {
    const actual = valueForField(record, field);
    if (isOperatorObject(expected)) {
      return Object.entries(expected).every(([operator, value]) => compare(actual, operator, value));
    }
    return actual === expected;
  });
}

function compare(actual: unknown, operator: string, expected: unknown): boolean {
  switch (operator) {
    case "eq":
      return actual === expected;
    case "neq":
      return actual !== expected;
    case "gt":
      return Number(actual) > Number(expected);
    case "gte":
      return Number(actual) >= Number(expected);
    case "lt":
      return Number(actual) < Number(expected);
    case "lte":
      return Number(actual) <= Number(expected);
    case "in":
      return Array.isArray(expected) && expected.includes(actual);
    case "between":
      return Array.isArray(expected) && Number(actual) >= Number(expected[0]) && Number(actual) <= Number(expected[1]);
    case "exists":
      return Boolean(expected) ? actual !== undefined : actual === undefined;
    default:
      throw new Error(`Unsupported filter operator: ${operator}`);
  }
}

function groupedRows(records: RecordEntry[], query: QueryDsl): Array<Record<string, unknown>> {
  const groupBy = query.groupBy;
  if (!groupBy) {
    return [];
  }

  const groups = new Map<string, RecordEntry[]>();
  for (const record of records) {
    const rawValue = valueForField(record, groupBy.field);
    const key = groupBy.interval && typeof rawValue === "string" ? bucketDate(rawValue, groupBy.interval) : String(rawValue);
    const current = groups.get(key) ?? [];
    current.push(record);
    groups.set(key, current);
  }

  return [...groups.entries()].map(([group, groupRecords]) => ({
    group,
    records_used: groupRecords.length,
    ...aggregateRow(groupRecords, query.aggregate ?? {})
  }));
}

function aggregateRow(records: RecordEntry[], aggregate: NonNullable<QueryDsl["aggregate"]>): Record<string, unknown> {
  if (Object.keys(aggregate).length === 0) {
    return {
      records_used: records.length
    };
  }

  const row: Record<string, unknown> = {};
  for (const [name, spec] of Object.entries(aggregate)) {
    row[name] = aggregateValue(records, spec.op, spec.field);
  }
  return row;
}

function aggregateValue(records: RecordEntry[], op: AggregateOperator, field?: string): number | null {
  if (op === "count") {
    return records.length;
  }
  if (!field) {
    throw new Error(`Aggregate ${op} requires a field`);
  }

  const values = records.map((record) => valueForField(record, field)).filter((value): value is number => typeof value === "number");
  if (values.length === 0) {
    return null;
  }

  switch (op) {
    case "sum":
      return values.reduce((sum, value) => sum + value, 0);
    case "avg":
      return values.reduce((sum, value) => sum + value, 0) / values.length;
    case "min":
      return Math.min(...values);
    case "max":
      return Math.max(...values);
  }
}

function orderRows(rows: Array<Record<string, unknown>>, query: QueryDsl): Array<Record<string, unknown>> {
  const orderBy = query.orderBy;
  if (!orderBy) {
    return rows.sort((left, right) => String(left.group ?? "").localeCompare(String(right.group ?? "")));
  }

  const direction = orderBy.direction ?? "asc";
  return [...rows].sort((left, right) => {
    const comparison = String(left[orderBy.field] ?? "").localeCompare(String(right[orderBy.field] ?? ""));
    return direction === "asc" ? comparison : -comparison;
  });
}

function valueForField(record: RecordEntry, field: string): unknown {
  if (field in record) {
    return record[field as keyof RecordEntry];
  }
  return record.data[field];
}

function bucketDate(value: string, interval: "day" | "week" | "month"): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  if (interval === "day") {
    return date.toISOString().slice(0, 10);
  }
  if (interval === "month") {
    return date.toISOString().slice(0, 7);
  }

  const day = date.getUTCDay() || 7;
  const monday = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  monday.setUTCDate(monday.getUTCDate() - day + 1);
  return monday.toISOString().slice(0, 10);
}

function timeRange(records: RecordEntry[]): QueryResult["time_range"] {
  const dates = records.map((record) => record.occurred_at).filter(isString).sort();
  if (dates.length === 0) {
    return undefined;
  }
  return {
    from: dates[0] ?? "",
    to: dates[dates.length - 1] ?? ""
  };
}

function isOperatorObject(value: QueryFilterValue): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}
