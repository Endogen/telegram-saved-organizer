import { Bookmark, CheckCircle2, FolderKanban, ShieldCheck } from "lucide-react";
import { Outlet } from "react-router";

const benefits = [
  { icon: Bookmark, text: "Keep every saved Telegram message within reach" },
  { icon: FolderKanban, text: "Organize your archive around the way you think" },
  { icon: ShieldCheck, text: "Protect your workspace with your own account" },
];

export function AuthLayout() {
  return (
    <main id="main-content" className="min-h-screen lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(28rem,0.82fr)]">
      <section className="relative hidden overflow-hidden border-r border-[hsl(var(--border)/0.75)] bg-slate-950 px-10 py-12 text-white lg:flex lg:flex-col lg:justify-between xl:px-16">
        <div aria-hidden="true" className="absolute inset-0 bg-[radial-gradient(circle_at_15%_10%,rgba(20,184,166,0.3),transparent_36%),radial-gradient(circle_at_90%_85%,rgba(59,130,246,0.22),transparent_40%)]" />
        <div className="relative">
          <div className="inline-flex items-center gap-3 text-sm font-semibold tracking-wide">
            <span className="inline-flex size-10 items-center justify-center rounded-2xl bg-teal-400 text-slate-950">
              <Bookmark className="size-5" />
            </span>
            Saved Organizer
          </div>
        </div>

        <div className="relative max-w-xl py-12">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-teal-300">Your private knowledge library</p>
          <p className="mt-5 text-4xl font-semibold leading-tight tracking-tight xl:text-5xl">
            Turn saved messages into a workspace you can use.
          </p>
          <p className="mt-5 max-w-lg text-base leading-7 text-slate-300">
            Search, sort, and revisit the Telegram ideas, links, and notes that matter to you.
          </p>

          <ul className="mt-9 space-y-4">
            {benefits.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-3 text-sm text-slate-200">
                <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-white/10 text-teal-300">
                  <Icon className="size-4" />
                </span>
                {text}
              </li>
            ))}
          </ul>
        </div>

        <p className="relative flex items-center gap-2 text-xs text-slate-400">
          <CheckCircle2 className="size-4 text-teal-300" />
          Built for a focused, personal archive
        </p>
      </section>

      <section className="flex min-h-screen items-center justify-center px-4 py-10 sm:px-8 lg:px-12">
        <div className="w-full max-w-md">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <span className="inline-flex size-10 items-center justify-center rounded-2xl bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]">
              <Bookmark className="size-5" />
            </span>
            <span className="text-sm font-semibold tracking-wide text-[hsl(var(--foreground))]">Saved Organizer</span>
          </div>
          <Outlet />
        </div>
      </section>
    </main>
  );
}
