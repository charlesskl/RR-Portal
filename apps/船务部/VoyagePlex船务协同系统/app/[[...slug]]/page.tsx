import { AppShell } from "@/components/app-shell";

export default async function Page({ params }: { params: Promise<{ slug?: string[] }> }) {
  const { slug } = await params;
  return <AppShell route={(slug ?? []).join("/")} />;
}
