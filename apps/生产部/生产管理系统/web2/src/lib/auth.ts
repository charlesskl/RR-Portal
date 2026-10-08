const TOKEN_KEY = "web2.token";
const USER_KEY = "web2.user";

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (t: string) => localStorage.setItem(TOKEN_KEY, t);
export const clearToken = () => localStorage.removeItem(TOKEN_KEY);

export const getUser = () => localStorage.getItem(USER_KEY) ?? "";
export const setUser = (u: string) => localStorage.setItem(USER_KEY, u);
export const clearUser = () => localStorage.removeItem(USER_KEY);

export function logout() {
  clearToken();
  clearUser();
}
