import type { Dashboard, DashboardProject, DirEntry, DocTypeItem, Overview, ProjectInfo } from "@/types";

type Source = {
  overview(): Promise<Overview>;
  list(path: string): Promise<{ entries: DirEntry[] }>;
  projects(client: string, year: string): Promise<{ projects: ProjectInfo[] }>;
  doctypes(project: string): Promise<{ items: DocTypeItem[] }>;
};

async function mapLimited<T, R>(rows: T[], fn: (row: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(rows.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(4, rows.length) }, async () => {
    while (next < rows.length) {
      const index = next++;
      out[index] = await fn(rows[index]);
    }
  }));
  return out;
}

/** File presence only. It never infers approval or production release from filenames. */
export async function loadDashboard(source: Source): Promise<Dashboard> {
  const overview = await source.overview();
  const byClient = await mapLimited(overview.clients, async (client) => {
    const listed = await source.list(client.name);
    return listed.entries
      .filter((entry) => entry.kind === "dir" && /^\d{4}$/.test(entry.name))
      .map((entry) => ({ client: client.name, year: entry.name }));
  });
  const byYear = await mapLimited(byClient.flat(), async ({ client, year }) => {
    const result = await source.projects(client, year);
    return result.projects.map((project) => ({ ...project, client, year }));
  });
  const projects: DashboardProject[] = await mapLimited(byYear.flat(), async (project) => {
    const result = await source.doctypes(project.path);
    const docs = Object.fromEntries(result.items.map((item) => [item.name, Boolean(item.existing)]));
    return {
      path: project.path, project: project.name, client: project.client, year: project.year,
      mtime: project.mtime, docs, done: Object.values(docs).filter(Boolean).length, total: result.items.length,
    };
  });
  projects.sort((a, b) => b.mtime - a.mtime || a.path.localeCompare(b.path));
  const done = projects.reduce((sum, project) => sum + project.done, 0);
  const total = projects.reduce((sum, project) => sum + project.total, 0);
  const complete = projects.filter((project) => project.total > 0 && project.done === project.total).length;
  return {
    scannedAt: Date.now(),
    docTypes: [...new Set(projects.flatMap((project) => Object.keys(project.docs)))],
    stats: {
      projects: projects.length, complete, incomplete: projects.length - complete,
      readiness: total > 0 ? Math.round(done / total * 100) : 0,
    },
    projects,
  };
}
