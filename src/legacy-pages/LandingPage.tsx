'use client';

import { Link } from '../lib/nextRouter';
import { Logo } from '../components/Logo';
import { AGENCY_NAME, OFFICE_NAME, SYSTEM_NAME } from '../lib/branding';

const WORKSPACE_CARDS = [
  {
    icon: 'network',
    number: '01',
    title: 'Plan',
    description: 'Build and review project schedules.',
    items: ['PDM scheduling', 'Bar chart schedules'],
  },
  {
    icon: 'curve',
    number: '02',
    title: 'Track',
    description: 'See planned and actual progress.',
    items: ['Progress monitoring', 'S-curve analysis'],
  },
  {
    icon: 'report',
    number: '03',
    title: 'Report',
    description: 'Move reports through review.',
    items: ['Weekly reports', 'Email notifications'],
  },
  {
    icon: 'pdf',
    number: '04',
    title: 'Verify',
    description: 'Keep official records accessible.',
    items: ['PDF reports', 'QR verification'],
  },
] as const;

export function LandingPage() {
  return (
    <div className="min-h-screen overflow-x-hidden bg-[#f7f9fb] text-text">
      <header className="sticky top-0 z-30 border-b border-[#d7e1e9] bg-[#f7f9fb]/95 backdrop-blur-sm">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-x-8 gap-y-3 px-5 py-3 md:px-8">
          <a href="#home" className="flex items-center gap-3" aria-label={`${SYSTEM_NAME} home`}>
            <Logo size="sm" showText={false} className="shrink-0" />
            <span className="hidden border-l border-border pl-3 text-xs font-medium leading-tight text-text-muted sm:block">
              {OFFICE_NAME}
              <br />
              {AGENCY_NAME}
            </span>
          </a>
          <nav aria-label="Main navigation" className="order-3 flex w-full items-center justify-center gap-5 text-sm font-medium text-text-muted sm:order-none sm:w-auto sm:gap-6">
            <a className="transition hover:text-primary" href="#home">Home</a>
            <a className="transition hover:text-primary" href="#features">Features</a>
            <a className="transition hover:text-primary" href="#workflow">Workflow</a>
            <a className="transition hover:text-primary" href="#about">About</a>
          </nav>
          <Link
            to="/login"
            className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white transition hover:bg-primary-dark focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            Login
          </Link>
        </div>
      </header>

      <main>
        <section id="home" className="relative border-b border-border bg-[#eef4f8]">
          <div className="pointer-events-none absolute inset-0 opacity-60" aria-hidden>
            <div className="absolute right-0 top-0 h-full w-1/2 bg-[linear-gradient(90deg,transparent,rgba(0,173,239,0.08))]" />
            <div className="absolute right-8 top-20 h-72 w-72 rounded-full border border-primary/10 md:right-24 md:h-96 md:w-96" />
            <div className="absolute right-20 top-32 h-48 w-48 rounded-full border border-accent/20 md:right-40 md:h-64 md:w-64" />
          </div>
          <div className="relative mx-auto grid max-w-7xl items-center gap-12 px-5 py-16 md:px-8 md:py-24 lg:grid-cols-[0.95fr_1.05fr] lg:gap-16 lg:py-28">
            <div>
              <div className="landing-rise">
                <Logo size="xl" showText={false} className="max-w-md" />
              </div>
              <h1 className="landing-rise landing-rise-delay-1 mt-8 max-w-xl font-display text-3xl font-semibold leading-[1.1] tracking-tight text-primary md:text-5xl">
                Project monitoring, made clear.
              </h1>
              <p className="landing-rise landing-rise-delay-2 mt-5 max-w-md text-base leading-7 text-text-muted md:text-lg">
                Schedules. Reports. Approvals. One workflow for the {OFFICE_NAME}.
              </p>
              <div className="landing-rise landing-rise-delay-3 mt-8 flex flex-wrap items-center gap-4">
                <Link to="/login" className="inline-flex items-center gap-3 rounded-lg bg-primary px-5 py-3.5 text-sm font-semibold text-white shadow-sm transition hover:-translate-y-0.5 hover:bg-primary-dark hover:shadow-md">
                  Access the system <span aria-hidden>→</span>
                </Link>
                <a href="#features" className="text-sm font-semibold text-primary underline decoration-primary/30 underline-offset-4 transition hover:decoration-primary">
                  View features
                </a>
              </div>
            </div>
            <SystemPreview />
          </div>
        </section>

        <section id="features" className="scroll-mt-24 border-b border-border bg-white">
          <div className="mx-auto max-w-7xl px-5 py-16 md:px-8 md:py-24">
            <div className="max-w-2xl">
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-accent">One connected workspace</p>
              <h2 className="mt-3 font-display text-3xl font-semibold tracking-tight text-primary md:text-4xl">The tools behind informed decisions.</h2>
              <p className="mt-4 text-base leading-7 text-text-muted">Everything needed to plan, report, review, and verify.</p>
            </div>
            <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {WORKSPACE_CARDS.map((card, index) => (
                <article
                  key={card.title}
                  className="landing-rise group relative overflow-hidden border border-border bg-[#fbfcfd] p-5 transition duration-300 hover:-translate-y-1 hover:border-accent hover:bg-white hover:shadow-[0_12px_28px_rgba(11,58,92,0.09)]"
                  style={{ animationDelay: `${index * 0.1}s` }}
                >
                  <span className="absolute right-5 top-5 font-mono text-xs font-bold text-primary/25">{card.number}</span>
                  <FeatureIcon name={card.icon} />
                  <h3 className="mt-5 font-display text-xl font-semibold text-primary">{card.title}</h3>
                  <p className="mt-1 text-sm text-text-muted">{card.description}</p>
                  <ul className="mt-6 space-y-2 border-t border-border pt-4 text-xs font-medium text-text-muted">
                    {card.items.map((item) => (
                      <li key={item} className="flex items-center gap-2">
                        <span className="h-1.5 w-1.5 rounded-full bg-accent transition-transform duration-300 group-hover:scale-125" />
                        {item}
                      </li>
                    ))}
                  </ul>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="workflow" className="scroll-mt-24 border-b border-border bg-[#f1f5f8]">
          <div className="mx-auto max-w-7xl px-5 py-16 md:px-8 md:py-24">
            <div className="flex flex-col gap-12">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-accent">A traceable process</p>
                <h2 className="mt-3 font-display text-3xl font-semibold tracking-tight text-primary md:text-4xl">From schedule to signed record.</h2>
                <p className="mt-4 max-w-md text-base leading-7 text-text-muted">A clear path from schedule to verified record.</p>
              </div>
              <ol className="relative grid gap-8 sm:grid-cols-2 lg:grid-cols-4 lg:gap-0">
                <span className="landing-process-line absolute left-5 top-5 hidden h-px origin-left bg-accent/40 lg:block" aria-hidden />
                {[
                  ['01', 'Plan', 'PDM + bar chart'],
                  ['02', 'Report', 'Progress forms'],
                  ['03', 'Review', 'Engineer I–IV'],
                  ['04', 'Verify', 'PDF + QR'],
                ].map(([number, title, description], index) => (
                  <li
                    key={number}
                    className="landing-rise group relative flex gap-4 sm:min-h-36 lg:block lg:pr-8"
                    style={{ animationDelay: `${index * 0.12}s` }}
                  >
                    <span className="landing-process-node relative z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-accent bg-[#f1f5f8] font-mono text-xs font-bold text-primary transition duration-300 group-hover:bg-accent group-hover:text-white" style={{ animationDelay: `${index * 0.12 + 0.2}s` }}>
                      {number}
                    </span>
                    <span className="block pt-1 lg:mt-6 lg:pl-1">
                      <h3 className="font-display text-lg font-semibold text-primary">{title}</h3>
                      <p className="mt-1 text-sm font-medium text-text-muted">{description}</p>
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </section>

        <section id="about" className="scroll-mt-24 bg-white">
          <div className="mx-auto grid max-w-7xl gap-12 px-5 py-16 md:px-8 md:py-24 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-accent">About ConstructFlow</p>
              <h2 className="mt-3 max-w-xl font-display text-3xl font-semibold tracking-tight text-primary md:text-4xl">Built for public works.</h2>
              <p className="mt-5 max-w-xl text-base leading-8 text-text-muted">
                A focused digital workflow for the {OFFICE_NAME}.
              </p>
              <div className="mt-7 border-l-2 border-accent pl-5 text-sm leading-6 text-text-muted">
                Built for the <span className="font-semibold text-primary">{AGENCY_NAME}</span>
              </div>
            </div>
            <div className="border border-border bg-[#f7f9fb] p-6 md:p-8">
              <p className="text-xs font-bold uppercase tracking-widest text-text-muted">System purpose</p>
              <ul className="mt-5 space-y-4 text-sm leading-6 text-text-muted">
                <li className="flex gap-3"><span className="font-semibold text-accent">01</span> Connected schedules and reports.</li>
                <li className="flex gap-3"><span className="font-semibold text-accent">02</span> Visible review status.</li>
                <li className="flex gap-3"><span className="font-semibold text-accent">03</span> Verifiable final records.</li>
              </ul>
            </div>
          </div>
        </section>

        <section className="border-t border-primary/20 bg-primary text-white">
          <div className="mx-auto flex max-w-7xl flex-col items-start justify-between gap-7 px-5 py-14 md:flex-row md:items-center md:px-8 md:py-16">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-accent">Ready to begin?</p>
              <h2 className="mt-3 font-display text-3xl font-semibold tracking-tight md:text-4xl">Ready to monitor?</h2>
              <p className="mt-3 max-w-xl text-sm leading-6 text-white/70">Sign in to continue.</p>
            </div>
            <Link to="/login" className="shrink-0 rounded-lg bg-white px-5 py-3.5 text-sm font-semibold text-primary transition hover:-translate-y-0.5 hover:bg-[#e9f6fb]">Login to ConstructFlow <span aria-hidden>→</span></Link>
          </div>
        </section>
      </main>

      <footer className="bg-[#07263d] text-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 px-5 py-8 md:flex-row md:items-center md:justify-between md:px-8">
          <div className="flex items-center gap-3">
            <Logo size="sm" showText={false} />
            <span className="text-sm font-semibold">{SYSTEM_NAME}</span>
          </div>
          <p className="text-xs text-white/60">{OFFICE_NAME} · {AGENCY_NAME}</p>
          <a href="#home" className="text-xs font-semibold text-white/75 transition hover:text-white">Back to top ↑</a>
        </div>
      </footer>
    </div>
  );
}

function FeatureIcon({ name }: { name: (typeof WORKSPACE_CARDS)[number]['icon'] }) {
  const paths: Record<string, string> = {
    progress: 'M4 16V8m5 8V5m5 11V9m5 7V3',
    report: 'M6 3h9l3 3v15H6zM9 11h6M9 15h6',
    network: 'M5 5h4v4H5zM15 15h4v4h-4zM15 5h4v4h-4zM9 7h6m-3 2v6m0 0H9m3 0h3',
    curve: 'M3 17c4-9 6 5 10-4s5-7 8-10',
    bars: 'M4 19V9m5 10V5m5 14v-7m5 7V3',
    pdf: 'M6 3h9l3 3v15H6zM9 13h6M9 17h4',
    mail: 'M3 6h18v13H3zM3 7l9 7 9-7',
  };
  return (
    <span className="flex h-10 w-10 shrink-0 items-center justify-center border border-primary/15 bg-[#eef4f8] text-primary transition group-hover:border-accent group-hover:text-accent">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden>
        <path d={paths[name]} />
      </svg>
    </span>
  );
}

function SystemPreview() {
  return (
    <div className="landing-rise landing-rise-delay-2 relative mx-auto w-full max-w-xl border border-[#c9d8e3] bg-white p-3 shadow-[0_18px_50px_rgba(11,58,92,0.12)] md:p-5">
      <div className="flex items-center justify-between border-b border-border pb-4">
        <div><p className="text-[10px] font-bold uppercase tracking-widest text-text-muted">Project dashboard</p><p className="mt-1 text-sm font-semibold text-primary">Progress overview</p></div>
        <span className="rounded-full bg-[#eef4f8] px-3 py-1 text-[10px] font-semibold text-primary">2026-W30</span>
      </div>
      <div className="grid gap-3 py-4 sm:grid-cols-3">
        {['Visible projects', 'Pending approvals', 'Delayed projects'].map((label, index) => (
          <div key={label} className="border border-border bg-[#f8fafc] p-3"><p className="text-[9px] uppercase tracking-wide text-text-muted">{label}</p><p className="mt-2 text-xl font-semibold text-primary">{['02', '04', '01'][index]}</p></div>
        ))}
      </div>
      <div className="border border-border p-4">
        <div className="mb-3 flex items-center justify-between"><p className="text-xs font-semibold text-primary">Planned vs actual progress</p><span className="text-[10px] text-text-muted">Weekly reports</span></div>
        <svg viewBox="0 0 520 155" className="h-auto w-full" role="img" aria-label="Illustration of planned and actual progress lines">
          <path d="M25 125H500M25 85H500M25 45H500" stroke="#d7e1e9" strokeDasharray="3 5" />
          <path d="M25 125 C100 95 150 70 210 48 S350 25 500 18" fill="none" stroke="#2563eb" strokeWidth="3" />
          <path d="M25 125 C100 113 145 118 210 92 S350 86 500 51" fill="none" stroke="#00adef" strokeWidth="3" />
          <circle cx="500" cy="18" r="4" fill="#2563eb" /><circle cx="500" cy="51" r="4" fill="#00adef" />
        </svg>
        <div className="mt-2 flex gap-5 text-[10px] text-text-muted"><span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-[#2563eb]" />Planned</span><span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-accent" />Actual</span></div>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border border-border bg-[#f8fafc] px-4 py-3">
        <div><p className="text-[9px] uppercase tracking-wide text-text-muted">Approval workflow</p><p className="mt-1 text-xs font-semibold text-primary">Engineer I → II → III → IV</p></div>
        <span className="border border-[#b9dce8] bg-[#eef9fc] px-2 py-1 text-[10px] font-semibold text-primary">Report in review</span>
      </div>
    </div>
  );
}
