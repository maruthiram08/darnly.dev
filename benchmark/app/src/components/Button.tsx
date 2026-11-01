import type { ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: 'sm' | 'md';
}

export function Button({ variant = 'primary', size = 'md', className = '', ...rest }: Props) {
  return <button className={`btn btn-${variant} btn-${size} ${className}`.trim()} {...rest} />;
}
