'use client';

import NextLink from 'next/link';
import { usePathname, useRouter, useParams as useNextParams } from 'next/navigation';
import { useEffect, useState, type ComponentProps, type ReactNode } from 'react';

type LinkProps = Omit<ComponentProps<typeof NextLink>, 'href'> & {
  to: string;
};

export function Link({ to, ...props }: LinkProps) {
  return <NextLink href={to} {...props} />;
}

export function useNavigate() {
  const router = useRouter();
  return (to: string, options?: { replace?: boolean }) => {
    if (options?.replace) {
      router.replace(to);
    } else {
      router.push(to);
    }
  };
}

export function useParams<T extends Record<string, string | undefined> = Record<string, string | undefined>>() {
  return useNextParams() as T;
}

export { usePathname };

export function useSearchParams() {
  const [params, setParams] = useState(() => new URLSearchParams());

  useEffect(() => {
    setParams(new URLSearchParams(window.location.search));
  }, []);

  return [params] as const;
}

interface NavLinkProps extends Omit<LinkProps, 'className'> {
  className?: string | ((state: { isActive: boolean }) => string);
  end?: boolean;
}

export function NavLink({ className, end = false, to, children, ...props }: NavLinkProps & { children?: ReactNode }) {
  const pathname = usePathname();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const normalizedPath = (pathname ?? '/').replace(/\/$/, '') || '/';
  const normalizedTo = to.replace(/\/$/, '') || '/';
  const isActive =
    mounted &&
    (end
      ? normalizedPath === normalizedTo
      : normalizedPath === normalizedTo || normalizedPath.startsWith(`${normalizedTo}/`));
  const resolvedClassName = typeof className === 'function' ? className({ isActive }) : className;
  return (
    <Link to={to} className={resolvedClassName} {...props}>
      {children}
    </Link>
  );
}
