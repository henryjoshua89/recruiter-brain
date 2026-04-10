import RoleWorkspace from "@/components/role-workspace";

export default async function RolePage({
  params,
}: {
  params: Promise<{ roleId: string }>;
}) {
  const { roleId } = await params;
  return <RoleWorkspace roleId={roleId} />;
}
