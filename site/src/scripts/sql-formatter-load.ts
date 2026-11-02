// Loaded only when the page needs to format, so the formatter isn't in the first download.
import { formatDialect, postgresql, mysql, sqlite } from 'sql-formatter';
import type { Dialect } from './sql-formatter-core';

const DIALECTS = { postgresql, mysql, sqlite };

export type FormatOptions = { dialect: Dialect; keywordCase: 'upper' | 'lower' | 'preserve'; indent: '2' | '4' | 'tab' };

// sql-formatter writes schema-qualified calls as "auth.uid ()". Join them back, but leave
// table names followed by a column list alone ("references auth.users (id)", "into public.t (a)").
const TABLE_BEFORE = /\b(references|table|into|on|index|update|join|from|only|exists|view)\s+$/i;
function tightenCalls(sql: string): string {
  return sql.replace(/\b([A-Za-z_]\w*\.[A-Za-z_]\w*) \(/g, (m, name: string, at: number) =>
    TABLE_BEFORE.test(sql.slice(Math.max(0, at - 30), at)) ? m : `${name}(`,
  );
}

export function formatSql(sql: string, o: FormatOptions): string {
  return tightenCalls(formatDialect(sql, {
    dialect: DIALECTS[o.dialect],
    keywordCase: o.keywordCase,
    functionCase: o.keywordCase === 'preserve' ? 'preserve' : 'lower',
    dataTypeCase: o.keywordCase,
    tabWidth: o.indent === '4' ? 4 : 2,
    useTabs: o.indent === 'tab',
    linesBetweenQueries: 1,
  }));
}
