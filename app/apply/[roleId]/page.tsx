import { supabase } from "@/lib/supabase";
import ApplicationForm from "@/components/application-form";
import { notFound } from "next/navigation";

export default async function ApplicationPage({
  params,
}: {
  params: Promise<{ roleId: string }>;
}) {
  const { roleId } = await params;

  const { data: role } = await supabase
    .from("roles")
    .select(
      "id, job_description, internal_context, companies(name, website_url)"
    )
    .eq("id", roleId)
    .single();

  if (!role) notFound();

  const company = Array.isArray(role.companies)
    ? role.companies[0]
    : role.companies;

  const internalContext = role.internal_context as {
    whyRoleOpen?: string;
  } | null;

  const jobDescription = role.job_description as string;
  const roleTitle = jobDescription
    ? jobDescription.split("\n")[0].slice(0, 80)
    : "Open Role";

  return (
    <main className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-2xl px-4 py-12">
        <div className="mb-8 text-center">
          <div className="inline-flex items-center justify-center rounded-full bg-blue-100 px-4 py-1.5 text-sm font-medium text-blue-800 mb-4">
            Now Hiring
          </div>
          <h1 className="text-2xl font-bold text-slate-950">
            {company?.name ?? "We are hiring"}
          </h1>
          <p className="mt-2 text-lg text-slate-700">{roleTitle}</p>
          {internalContext?.whyRoleOpen ? (
            <p className="mt-3 text-sm text-slate-500 max-w-md mx-auto">
              {internalContext.whyRoleOpen}
            </p>
          ) : null}
        </div>
        <ApplicationForm roleId={roleId} companyName={company?.name ?? "Us"} />
      </div>
    </main>
  );
}