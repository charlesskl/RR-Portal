export default function Loading() {
  return (
    <div className="animate-pulse space-y-5" aria-label="页面加载中">
      <div className="h-8 w-48 rounded bg-slate-100" />
      <div className="grid grid-cols-4 gap-4">
        {[0, 1, 2, 3].map((n) => <div key={n} className="h-24 rounded-card bg-slate-100" />)}
      </div>
      <div className="h-12 rounded-card bg-slate-100" />
      <div className="h-72 rounded-card bg-slate-100" />
    </div>
  );
}
