import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { getToken } from "@/lib/auth";
import { Skeleton } from "@/components/ui/skeleton";

const LoginPage = lazy(() => import("@/pages/LoginPage"));
const MainLayout = lazy(() => import("@/layout/MainLayout"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 15_000 },
  },
});

function FullScreenSkeleton() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50">
      <div className="w-full max-w-sm space-y-3">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-64 w-full" />
      </div>
    </div>
  );
}

function RequireAuth({
  children,
  redirect = "/login",
}: {
  children: React.ReactNode;
  redirect?: string;
}) {
  if (!getToken()) return <Navigate to={redirect} replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Suspense fallback={<FullScreenSkeleton />}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          {/* 宫格首页与功能页都在 MainLayout 内(keep-alive 标签页) */}
          <Route
            path="/*"
            element={
              <RequireAuth>
                <MainLayout />
              </RequireAuth>
            }
          />
        </Routes>
      </Suspense>
    </QueryClientProvider>
  );
}
