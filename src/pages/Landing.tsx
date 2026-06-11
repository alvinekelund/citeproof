import { Link } from 'react-router-dom';
import {
  ShieldCheck,
  FileSearch,
  Quote,
  BookOpenCheck,
  PenLine,
  History,
  Github,
  ArrowRight,
  CheckCircle2,
  AlertTriangle,
  XCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';

const FEATURES = [
  {
    icon: Quote,
    title: 'Evidence that provably exists',
    body: 'Every quote the AI cites is re-checked, word by word, against the extracted source text. If the excerpt is not actually in the PDF, the verdict is downgraded — hallucinated evidence never reaches you.',
  },
  {
    icon: FileSearch,
    title: 'Pinpoint PDF highlighting',
    body: 'Supporting passages are located token-by-token inside the original source PDF and highlighted on the exact page, so you can verify every verdict with your own eyes.',
  },
  {
    icon: BookOpenCheck,
    title: 'Citation matching that understands variants',
    body: '"Smith (2023)", "(Smith et al., 2023)" and "Smith & Jones, 2023" resolve to the same source via exact, key-based, and fuzzy matching with year tolerance — across APA, MLA, Chicago, Harvard, IEEE, and Vancouver styles.',
  },
  {
    icon: PenLine,
    title: 'Fix unsupported claims, not just flag them',
    body: 'For every red verdict, get a rewrite that either grounds the claim in a source from your library (with the supporting quote) or rephrases it as a defensible observation.',
  },
  {
    icon: History,
    title: 'A full audit trail',
    body: 'Every paragraph check is stored with its claims, verdicts, and evidence. Re-open any session and see exactly what was verified, when, and against which sources.',
  },
  {
    icon: ShieldCheck,
    title: 'Your data stays yours',
    body: 'Open source and self-hostable on your own Supabase project. Per-user row-level security isolates every account; your thesis is never used to train anything.',
  },
];

const STEPS = [
  {
    n: '01',
    title: 'Build your source library',
    body: 'Drop in the PDFs you cite. Titles, authors, years, and citation labels are extracted automatically — edit them if you like.',
  },
  {
    n: '02',
    title: 'Upload your thesis',
    body: 'Your draft is split into paragraphs, citations are detected and matched to your library, and missing sources are flagged.',
  },
  {
    n: '03',
    title: 'Read the verdicts',
    body: 'Each paragraph is broken into atomic claims and checked against the full text of the sources it cites — with quoted, page-numbered evidence.',
  },
];

export default function Landing() {
  return (
    <div className="min-h-screen bg-background text-foreground overflow-x-hidden">
      <style>{`
        @keyframes landing-rise {
          from { opacity: 0; transform: translateY(18px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .landing-rise { opacity: 0; animation: landing-rise 0.7s cubic-bezier(0.22, 1, 0.36, 1) forwards; }
        .landing-paper {
          background-image:
            radial-gradient(ellipse 80% 60% at 70% -10%, hsl(var(--accent) / 0.08), transparent),
            radial-gradient(ellipse 60% 50% at 0% 100%, hsl(var(--primary) / 0.05), transparent);
        }
        .landing-rule { background: linear-gradient(90deg, hsl(var(--accent)), hsl(var(--accent) / 0)); }
        @media (prefers-reduced-motion: reduce) {
          .landing-rise { animation: none; opacity: 1; }
        }
      `}</style>

      {/* Nav */}
      <header className="border-b border-border/60 bg-background/80 backdrop-blur sticky top-0 z-20">
        <div className="mx-auto max-w-6xl px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <ShieldCheck className="h-6 w-6 text-accent" />
            <span className="font-serif text-xl font-semibold tracking-tight">Thesis Guardian</span>
          </div>
          <nav className="flex items-center gap-2 sm:gap-4">
            <a
              href="https://github.com/alvinekelund/thesis-guardian"
              target="_blank"
              rel="noreferrer"
              className="hidden sm:inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <Github className="h-4 w-4" /> GitHub
            </a>
            <Button asChild variant="ghost" size="sm">
              <Link to="/login">Sign in</Link>
            </Button>
            <Button asChild size="sm">
              <Link to="/login">Get started</Link>
            </Button>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="landing-paper">
        <div className="mx-auto max-w-6xl px-6 pt-16 pb-20 lg:pt-24 lg:pb-28 grid lg:grid-cols-[1fr_1.05fr] gap-14 items-center">
          <div>
            <p className="landing-rise text-sm font-medium tracking-[0.2em] uppercase text-accent mb-5" style={{ animationDelay: '0ms' }}>
              For students &amp; researchers
            </p>
            <h1 className="landing-rise font-serif text-4xl sm:text-5xl lg:text-[3.4rem] leading-[1.08] font-semibold mb-6" style={{ animationDelay: '90ms' }}>
              Every claim in your thesis,{' '}
              <em className="text-primary not-italic border-b-4 border-verdict-green/60">verified</em>{' '}
              against the sources you actually cite.
            </h1>
            <p className="landing-rise text-lg text-muted-foreground leading-relaxed mb-8 max-w-xl" style={{ animationDelay: '180ms' }}>
              Thesis Guardian breaks your paragraphs into atomic claims, searches the full
              text of your cited sources, and returns page-numbered evidence — with a
              verification layer that rejects any quote it cannot find verbatim in the source.
            </p>
            <div className="landing-rise flex flex-wrap items-center gap-4" style={{ animationDelay: '270ms' }}>
              <Button asChild size="lg" className="gap-2">
                <Link to="/login">
                  Check your thesis <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <a href="https://github.com/alvinekelund/thesis-guardian" target="_blank" rel="noreferrer">
                  Self-host it
                </a>
              </Button>
            </div>
            <div className="landing-rise h-px w-40 landing-rule mt-10" style={{ animationDelay: '360ms' }} />
          </div>

          {/* Manuscript demo */}
          <div className="landing-rise relative" style={{ animationDelay: '300ms' }}>
            <div className="rounded-lg border border-border bg-card shadow-[0_24px_60px_-24px_hsl(var(--primary)/0.35)] p-7 sm:p-9 font-serif text-[1.05rem] leading-[1.85]">
              <p className="text-xs font-sans uppercase tracking-[0.18em] text-muted-foreground mb-4">
                Chapter 4 · Paragraph 12 · 3 claims checked
              </p>
              <p>
                <span className="bg-verdict-green-bg border-b-2 border-verdict-green">
                  Generative AI assistance reduced average task completion time by 0.8
                  standard deviations among mid-level professionals (Noy &amp; Zhang, 2023)
                </span>
                .{' '}
                <span className="bg-verdict-yellow-bg border-b-2 border-verdict-yellow">
                  Comparable effects have been reported in software engineering contexts
                  (Peng et al., 2023)
                </span>
                , although{' '}
                <span className="bg-verdict-red-bg border-b-2 border-verdict-red">
                  these productivity gains persist uniformly across all occupational
                  categories
                </span>
                .
              </p>
              <div className="mt-6 flex flex-wrap gap-x-5 gap-y-2 font-sans text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <CheckCircle2 className="h-3.5 w-3.5 text-verdict-green" /> Fully supported
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <AlertTriangle className="h-3.5 w-3.5 text-verdict-yellow" /> Partially supported
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <XCircle className="h-3.5 w-3.5 text-verdict-red" /> No support found
                </span>
              </div>
            </div>

            {/* Margin evidence note */}
            <div className="relative mt-4 lg:mt-0 lg:absolute lg:-bottom-10 lg:-left-10 max-w-xs rounded-md border border-verdict-green/40 bg-verdict-green-bg/80 backdrop-blur px-5 py-4 shadow-lg">
              <p className="font-sans text-[0.7rem] uppercase tracking-[0.15em] text-verdict-green font-semibold mb-1.5 flex items-center gap-1.5">
                <Quote className="h-3 w-3" /> Evidence · verified verbatim
              </p>
              <p className="font-serif text-sm italic leading-relaxed">
                “…treated participants completed tasks 0.8 SD faster than the control
                group…”
              </p>
              <p className="font-sans text-xs text-muted-foreground mt-2">Noy &amp; Zhang (2023), p. 4</p>
            </div>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="border-y border-border/60 bg-secondary/40">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <h2 className="font-serif text-3xl sm:text-4xl font-semibold mb-12">How it works</h2>
          <div className="grid md:grid-cols-3 gap-10">
            {STEPS.map((step) => (
              <div key={step.n}>
                <p className="font-serif text-5xl text-accent/70 mb-4">{step.n}</p>
                <h3 className="font-serif text-xl font-semibold mb-2">{step.title}</h3>
                <p className="text-muted-foreground leading-relaxed">{step.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section>
        <div className="mx-auto max-w-6xl px-6 py-20">
          <h2 className="font-serif text-3xl sm:text-4xl font-semibold mb-3">
            Built for verifiability, not vibes
          </h2>
          <p className="text-muted-foreground text-lg mb-12 max-w-2xl">
            Plagiarism checkers tell you what you copied. Thesis Guardian tells you whether
            what you wrote is actually supported by what you cite.
          </p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-x-10 gap-y-12">
            {FEATURES.map((f) => (
              <div key={f.title}>
                <f.icon className="h-6 w-6 text-accent mb-4" />
                <h3 className="font-serif text-lg font-semibold mb-2">{f.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="bg-primary text-primary-foreground">
        <div className="mx-auto max-w-6xl px-6 py-20 text-center">
          <h2 className="font-serif text-3xl sm:text-4xl font-semibold mb-4">
            Defend every sentence before your committee asks.
          </h2>
          <p className="text-primary-foreground/75 text-lg mb-8 max-w-xl mx-auto">
            Free and open source. Bring your own Supabase project and Gemini key, or sign in
            and start checking now.
          </p>
          <Button asChild size="lg" variant="secondary" className="gap-2">
            <Link to="/login">
              Start verifying <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border/60">
        <div className="mx-auto max-w-6xl px-6 py-8 flex flex-col sm:flex-row items-center justify-between gap-3 text-sm text-muted-foreground">
          <span className="inline-flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-accent" /> Thesis Guardian
          </span>
          <a
            href="https://github.com/alvinekelund/thesis-guardian"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 hover:text-foreground transition-colors"
          >
            <Github className="h-4 w-4" /> Open source on GitHub
          </a>
        </div>
      </footer>
    </div>
  );
}
