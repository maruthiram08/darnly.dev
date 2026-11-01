// Counts what the agent did in a list of stream-json events (one turn or a whole conversation).
const SEARCH_BASH = /(^|[\s|;&(])(grep|rg|find|ls|ag|fd|git grep)\s/;
const READ_BASH = /(^|[\s|;&(])(cat|head|tail|sed -n)\s/;

export function countTools(events) {
  const m = { tool_calls: 0, search_calls: 0, file_reads: 0, edits: 0, failed_calls: 0, darnly_calls: 0 };
  for (const e of events) {
    if (e.type === 'assistant') {
      for (const c of e.message?.content ?? []) {
        if (c.type !== 'tool_use') continue;
        m.tool_calls++;
        // Darnly's own steps (skill, reading the report, the Fixed line, moving files to done/) are counted
        // apart, so searches and reads are about finding the code.
        if (c.name === 'Skill' || JSON.stringify(c.input ?? {}).includes('.darnly')) {
          m.darnly_calls++;
          continue;
        }
        const cmd = ' ' + (c.input?.command ?? '');
        if (c.name === 'Grep' || c.name === 'Glob' || (c.name === 'Bash' && SEARCH_BASH.test(cmd))) m.search_calls++;
        if (c.name === 'Read' || (c.name === 'Bash' && READ_BASH.test(cmd))) m.file_reads++;
        if (['Edit', 'MultiEdit', 'Write', 'NotebookEdit'].includes(c.name) || (c.name === 'Bash' && /(^|[\s;&|])sed\s+(-[a-zA-Z]*i|--in-place)/.test(cmd))) m.edits++;
      }
    }
    if (e.type === 'user') {
      for (const c of e.message?.content ?? []) if (c.type === 'tool_result' && c.is_error) m.failed_calls++;
    }
  }
  return m;
}

export function editedThisTurn(events) {
  return countTools(events).edits > 0;
}

// Sums the usage of every turn's result event.
export function sumUsage(results) {
  const t = { input_tokens: 0, cache_write_tokens: 0, cache_read_tokens: 0, output_tokens: 0, cost_usd: 0, seconds: 0, model_turns: 0 };
  for (const r of results) {
    if (!r) continue;
    const u = r.usage ?? {};
    t.input_tokens += u.input_tokens ?? 0;
    t.cache_write_tokens += u.cache_creation_input_tokens ?? 0;
    t.cache_read_tokens += u.cache_read_input_tokens ?? 0;
    t.output_tokens += u.output_tokens ?? 0;
    t.cost_usd += r.total_cost_usd ?? 0;
    t.seconds += Math.round((r.duration_ms ?? 0) / 1000);
    t.model_turns += r.num_turns ?? 0;
  }
  t.total_tokens = t.input_tokens + t.cache_write_tokens + t.cache_read_tokens + t.output_tokens;
  t.new_tokens = t.input_tokens + t.cache_write_tokens + t.output_tokens;
  t.cost_usd = Number(t.cost_usd.toFixed(4));
  return t;
}

// Did the agent end its turn by asking the user something? Looks at the last two paragraphs of its reply.
// Used together with "changed no code this turn" to count a blocking follow-up question.
export function endsWithQuestion(text) {
  const paras = (text ?? '').trim().split(/\n\s*\n/).filter(Boolean);
  const tail = paras.slice(-2).join('\n');
  return /\?\s*(\*\*)?\s*$/m.test(tail);
}
