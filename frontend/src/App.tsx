const tasks = [
  "Connect Telegram account",
  "Scan and categorize Saved Messages",
  "Search, filter, and tag messages",
  "Manage items with bulk actions",
];

export default function App() {
  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-100 to-slate-200 px-4 py-10">
      <section className="mx-auto w-full max-w-3xl rounded-2xl border border-slate-300 bg-white/80 p-6 shadow-lg backdrop-blur-sm md:p-10">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-teal-700">
          Telegram Saved Messages Organizer
        </p>
        <h1 className="mt-3 text-3xl font-bold text-slate-900 md:text-4xl">
          Frontend initialized with React, TypeScript, Vite, and Tailwind.
        </h1>
        <p className="mt-4 max-w-2xl text-base text-slate-700">
          The application shell is ready for routing, state management, animated message cards, and API
          integration in the next tasks.
        </p>

        <ul className="mt-8 grid gap-3 md:grid-cols-2">
          {tasks.map((task) => (
            <li
              key={task}
              className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-800"
            >
              {task}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
