import { createContext, useContext } from "react";
import type { EpmsSession } from "@/lib/api";

type Access = {
  session: EpmsSession | null; loading: boolean; error: string; revision: number;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
};
export const AccessContext = createContext<Access>({
  session: null, loading: false, error: "账号验证服务不可用", revision: 0,
  login: async () => { throw new Error("账号验证服务不可用"); },
  logout: async () => {},
});
export function useEpmsAccess() { return useContext(AccessContext); }
