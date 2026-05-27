// PMC → 车间 mapping. Source of truth for both seed and PDF imports.
// Update this object when a PMC joins/leaves a workshop.
const PMC_TO_WORKSHOP = {
  // 兴信A 车间
  '陈梦楚': '兴信A',
  '邓洁':   '兴信A',
  '周伟中': '兴信A',
  // 兴信B 车间
  '温雪花': '兴信B',
  '李汶薇': '兴信B',
  '胡佐龙': '兴信B',
  '曾文业': '兴信B',
  // 华登
  '谭凤娟': '华登',
  '杨继琴': '华登',
};

function workshopFromPmc(pmc) {
  return PMC_TO_WORKSHOP[(pmc || '').trim()] || '';
}

// Display order for the 外发明细 page and Excel export.
// Smaller number = higher up. Unlisted workshops fall to the very end (999).
const WORKSHOP_ORDER = {
  '兴信A': 1,
  '兴信B': 2,
  '华登':   3,
};
function workshopRank(ws) {
  if (!ws) return 999;
  return WORKSHOP_ORDER[ws] ?? 998;
}

module.exports = { PMC_TO_WORKSHOP, workshopFromPmc, WORKSHOP_ORDER, workshopRank };
