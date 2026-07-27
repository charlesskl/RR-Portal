import { http, unwrap } from './client';
import type { LoginResponse, UserInfo } from './types';

export const authApi = {
  login: (username: string, password: string) =>
    unwrap<LoginResponse>(http.post('/api/auth/login', { username, password })),
  me: () => unwrap<UserInfo>(http.get('/api/auth/me')),
};
