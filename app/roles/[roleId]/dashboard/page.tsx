import RoleDashboard from "@/components/role-dashboard";

export default async function RoleDashboardPage({
  params,
}: {
  params: Promise<{ roleId: string }>;
}) {
  const { roleId } = await params;
  return <RoleDashboard roleId={roleId} />;
}
