import type { ReactNode } from 'react';

export function Badge({ tone = 'grey', children }: { tone?: 'green' | 'blue' | 'grey'; children: ReactNode }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}
