import type { AnchorHTMLAttributes } from 'react';
import { useRoute } from '../hooks/useRoute';

export function Link({ href = '/', onClick, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement>) {
  const { go } = useRoute();
  return (
    <a
      href={href}
      onClick={(e) => {
        onClick?.(e);
        if (e.defaultPrevented || e.metaKey || e.ctrlKey) return;
        e.preventDefault();
        go(href);
      }}
      {...rest}
    />
  );
}
