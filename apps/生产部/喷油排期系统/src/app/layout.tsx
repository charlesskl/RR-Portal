import "./globals.css";
import TopNav from "@/components/layout/TopNav";
import { getSession } from "@/lib/session";

export const metadata = { title: "SprayPlan V1" };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  const isLoggedIn = !!session.userId;

  if (!isLoggedIn) {
    return (
      <html lang="zh">
        <body>{children}</body>
      </html>
    );
  }

  return (
    <html lang="zh">
      <body>
        <TopNav username={session.username!} role={session.role!} />
        <main className="max-w-[1480px] mx-auto px-8 py-8">{children}</main>
      </body>
    </html>
  );
}
