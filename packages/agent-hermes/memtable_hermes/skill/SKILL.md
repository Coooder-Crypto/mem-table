# MemTable

Use MemTable when users ask to record structured data or ask trend, aggregate, or status questions that should be answered from the structured ledger.

## Tool Use

- Use `memtable_propose` or `memtable_record` when the user provides quantitative logs such as workouts, body weight, spending, project status, time tracking, or recurring measurements.
- Use `memtable_ask` for trend, progress, aggregate, longest, most, average, and month-over-month questions.
- Use `memtable_list_proposals` when the user asks what is waiting for review.
- Use `memtable_commit_proposal` only after the user confirms a proposal should become a ledger record.
- Do not calculate long-term trends from chat history when MemTable is available.
- If MemTable returns insufficient data, say that the ledger does not have enough records yet.
