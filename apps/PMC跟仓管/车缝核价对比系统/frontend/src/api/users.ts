import { http, unwrap } from './client';

export interface UserRow {
  userId: number;
  username: string;
  displayName: string;
  role?: string | null;
  deptId: number;
  isActive: boolean;
}
export interface UserCreate {
  username: string;
  password: string;
  displayName: string;
  role?: string | null;
  deptId: number;
}
export interface UserUpdate {
  displayName: string;
  role?: string | null;
  deptId: number;
  isActive: boolean;
}

export const userApi = {
  list: () => unwrap<UserRow[]>(http.get('/api/users')),
  create: (b: UserCreate) => unwrap<UserRow>(http.post('/api/users', b)),
  update: (id: number, b: UserUpdate) => unwrap<UserRow>(http.put(`/api/users/${id}`, b)),
  resetPassword: (id: number, newPassword: string) =>
    unwrap<object>(http.post(`/api/users/${id}/reset-password`, { newPassword })),
};
