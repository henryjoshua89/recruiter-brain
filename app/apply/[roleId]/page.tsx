import { notFound } from "next/navigation";
import { supabase } from "@/lib/supabase";
import ApplicationForm from "@/components/application-form";

export default async function ApplyPage({
  params,
}: {
  params: Promise<{ roleId: string }>;
}) {
  const { roleId } = await params;

  const { data: role, error } = await supabase
    .from("roles")
    .select(
      "id, job_description, companies ( name, website_url )"
    )
    .eq("id", roleId)
    .single();

  if (error || !role) {
    notFound();
  }

  const raw = role.companies as unknown;
  const companies = Array.isArray(raw) ? raw[0] : raw;
  const companyName =
    (companies as { name?: string } | null)?.name ?? "this company";

  return (
    <ApplicationForm roleId={role.id} companyName={companyName} />
  );
}
