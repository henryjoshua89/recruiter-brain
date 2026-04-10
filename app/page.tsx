import NewRoleWizard from "@/components/new-role-wizard";
import SavedRolesList from "@/components/saved-roles-list";

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <header className="card-shadow mb-8 rounded-2xl border border-border bg-surface p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm uppercase tracking-wide text-blue-700">
              Recruiter Brain
            </p>
            <h1 className="text-3xl font-semibold text-slate-950">
              Recruiter Intelligence Dashboard
            </h1>
            <p className="mt-2 text-sm text-slate-700">
              Phase 1: JD Comprehension · Phase 2: Resume Analysis per saved
              role.
            </p>
          </div>
          <div className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-900">
            <div className="font-medium text-blue-950">Status</div>
            <div>Ready for New Role Intake</div>
          </div>
        </div>
      </header>

      <section className="mb-8 grid gap-4 md:grid-cols-3">
        {[
          {
            label: "Workflow",
            value: "Intake + resumes",
            description: "Briefing intake then analyse candidates per role",
          },
          {
            label: "AI Model",
            value: "Claude Sonnet 4",
            description: "Structured briefing generation",
          },
          {
            label: "Database",
            value: "Supabase",
            description: "All role and context data persisted",
          },
        ].map((card) => (
          <article
            key={card.label}
            className="card-shadow rounded-xl border border-border bg-surface p-5"
          >
            <p className="text-xs uppercase tracking-wide text-slate-600">
              {card.label}
            </p>
            <p className="mt-1 text-xl font-semibold text-slate-950">
              {card.value}
            </p>
            <p className="mt-2 text-sm text-slate-700">{card.description}</p>
          </article>
        ))}
      </section>

      <SavedRolesList />

      <NewRoleWizard />
    </main>
  );
}
