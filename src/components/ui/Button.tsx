'use client';

import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Link } from '../../lib/nextRouter';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

const variants: Record<Variant, string> = {
  primary:
    'bg-primary text-white shadow-sm hover:bg-primary-dark focus:ring-primary/30',
  secondary:
    'border border-border bg-card text-text shadow-sm hover:bg-surface-muted focus:ring-primary/20',
  ghost: 'text-primary hover:bg-primary-light focus:ring-primary/20',
  danger: 'border border-red-200 bg-white text-red-600 hover:bg-red-50 focus:ring-red-200',
};

const base =
  'inline-flex items-center justify-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold transition focus:outline-none focus:ring-2 disabled:opacity-50';

export function Button({
  variant = 'secondary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return <button type="button" className={`${base} ${variants[variant]} ${className}`} {...props} />;
}

export function ButtonLink({
  to,
  variant = 'secondary',
  children,
  className = '',
}: {
  to: string;
  variant?: Variant;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Link to={to} className={`${base} ${variants[variant]} ${className}`}>
      {children}
    </Link>
  );
}
