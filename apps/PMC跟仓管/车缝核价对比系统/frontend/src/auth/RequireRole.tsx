import { type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { canSeeRoute, homePathFor } from './permissions';

/** 包住一个受控页面：未登录→/login；登录但无此页权限→跳回该角色首页。 */
export default function RequireRole({ children }: { children: ReactNode }) {
  const { user, role, loading } = useAuth();
  const location = useLocation();
  if (loading) return null;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (!canSeeRoute(role, location.pathname)) return <Navigate to={homePathFor(role)} replace />;
  return <>{children}</>;
}
