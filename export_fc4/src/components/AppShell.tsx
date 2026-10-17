'use client';

import type { ReactNode } from 'react';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { SelectedProjectProvider } from '../context/SelectedProjectContext';

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <SelectedProjectProvider>
      <div className="flex h-screen overflow-hidden bg-surface">
        <Sidebar />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <TopBar />
          <div className="app-main min-h-0 flex-1 overflow-y-auto">{children}</div>
        </div>
      </div>
    </SelectedProjectProvider>
  );
}
