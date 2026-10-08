function assemblyGroupFactor(group, groups) {
  const n = value => Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;
  const usage = n(group.usage ?? 1);
  if (group.cost_mode !== 'average') return 1;
  const denominator = (groups || []).filter(g => g.cost_mode === 'average').reduce((s, g) => s + n(g.usage ?? 1), 0);
  return denominator > 0 ? usage / denominator : 0;
}
function assemblyGroupsTotal(groups, base) {
  return (groups || []).reduce((total, g) => total + assemblyGroupFactor(g, groups) * (g.steps || []).reduce((s, step) => s + Number(base || 0) * Number(step.count || 0) * (Number(g.team ?? 1) || 1) / Math.max(Number(g.qty || 0), 1), 0), 0);
}
module.exports = { assemblyGroupFactor, assemblyGroupsTotal };
