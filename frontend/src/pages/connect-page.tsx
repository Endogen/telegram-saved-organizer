import { Button } from "@/components/ui/button";

export function ConnectPage() {
  return (
    <section className="max-w-xl">
      <h2 className="text-2xl font-semibold text-[hsl(var(--foreground))]">Connect Telegram</h2>
      <p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">
        Connection flow scaffolding is ready for backend auth endpoints.
      </p>

      <form className="mt-6 space-y-4 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card)/0.9)] p-4 md:p-5">
        <div className="space-y-1">
          <label className="text-xs font-semibold uppercase tracking-[0.14em] text-[hsl(var(--muted-foreground))]">
            API ID
          </label>
          <input
            type="text"
            placeholder="123456"
            className="h-10 w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 text-sm outline-none ring-[hsl(var(--ring))] transition focus:ring-2"
          />
        </div>

        <div className="space-y-1">
          <label className="text-xs font-semibold uppercase tracking-[0.14em] text-[hsl(var(--muted-foreground))]">
            API Hash
          </label>
          <input
            type="text"
            placeholder="telegram-api-hash"
            className="h-10 w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 text-sm outline-none ring-[hsl(var(--ring))] transition focus:ring-2"
          />
        </div>

        <div className="space-y-1">
          <label className="text-xs font-semibold uppercase tracking-[0.14em] text-[hsl(var(--muted-foreground))]">
            Phone Number
          </label>
          <input
            type="tel"
            placeholder="+1 555 000 0000"
            className="h-10 w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 text-sm outline-none ring-[hsl(var(--ring))] transition focus:ring-2"
          />
        </div>

        <Button className="w-full sm:w-auto">Start Connection</Button>
      </form>
    </section>
  );
}
