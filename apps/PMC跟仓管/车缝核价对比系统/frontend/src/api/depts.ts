import { http, unwrap } from './client';
import type { Dept } from './types';

export const deptApi = {
  list: (includeInactive = false) =>
    unwrap<Dept[]>(http.get('/api/depts', { params: { includeInactive } })),
};
