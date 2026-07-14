export const STAGES = ['FS', 'EP', 'EP1', 'PE2', 'FEP', 'PP', 'PS'];

export function normalizeProductNo(value) {
  return String(value || '').trim().toUpperCase().replace(/\s+/g, '');
}

export function normalizeStage(value) {
  const aliases = { FEP1: 'EP1', EP2: 'PE2', FEP2: 'PE2' };
  const raw = String(value || '').trim().toUpperCase();
  const stage = aliases[raw] || raw;
  return STAGES.includes(stage) ? stage : '';
}

export function stageIndex(stage) {
  const index = STAGES.indexOf(normalizeStage(stage));
  return index < 0 ? Number.MAX_SAFE_INTEGER : index;
}

export function normalizeIssueKey(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[\s:：()（）\[\]【】,，.。/\\_\-]+/g, '');
}

function reportSort(a, b) {
  const byStage = stageIndex(a.stage) - stageIndex(b.stage);
  if (byStage !== 0) return byStage;
  return String(a.reportDate || a.uploadedAt || '').localeCompare(String(b.reportDate || b.uploadedAt || ''));
}

function compactReportResults(report) {
  const byKey = new Map();
  for (const sheet of report.sheets || []) {
    for (const result of sheet.testResults || []) {
      const key = result.issueKey || normalizeIssueKey(result.testItem);
      if (!key) continue;
      if (!byKey.has(key)) {
        byKey.set(key, {
          issueKey: key,
          testItem: result.testItem,
          statuses: new Set(),
          descriptions: [],
          evidence: []
        });
      }
      const item = byKey.get(key);
      item.statuses.add(result.status);
      if (result.description && !item.descriptions.includes(result.description)) item.descriptions.push(result.description);
      item.evidence.push({
        sheetName: sheet.name,
        rowNumber: result.rowNumber,
        status: result.status,
        description: result.description,
        cells: result.cells || []
      });
    }
  }

  return Array.from(byKey.values()).map(item => ({
    ...item,
    status: item.statuses.has('fail') ? 'fail' : 'pass',
    statuses: undefined,
    description: item.descriptions.join('；')
  }));
}

function buildIssueLedger(reports) {
  const issueMap = new Map();

  for (const report of reports) {
    const reportResults = compactReportResults(report);
    for (const result of reportResults) {
      let issue = issueMap.get(result.issueKey);

      if (result.status === 'fail') {
        if (!issue) {
          issue = {
            issueKey: result.issueKey,
            testItem: result.testItem,
            status: 'open',
            recurrenceCount: 0,
            firstSeenAt: report.reportDate || report.uploadedAt,
            firstSeenStage: report.stage,
            lastSeenAt: report.reportDate || report.uploadedAt,
            lastSeenStage: report.stage,
            latestDescription: result.description,
            history: []
          };
          issueMap.set(result.issueKey, issue);
        } else if (issue.status === 'resolved') {
          issue.status = 'recurring';
          issue.recurrenceCount += 1;
          issue.reopenedAt = report.reportDate || report.uploadedAt;
          issue.reopenedStage = report.stage;
          issue.resolvedAt = null;
          issue.resolvedStage = null;
        } else if (issue.recurrenceCount > 0) {
          issue.status = 'recurring';
        }

        issue.lastSeenAt = report.reportDate || report.uploadedAt;
        issue.lastSeenStage = report.stage;
        issue.latestDescription = result.description || issue.latestDescription;
        issue.history.push({
          type: issue.status === 'recurring' ? 'recurring' : 'fail',
          reportId: report.id,
          stage: report.stage,
          reportDate: report.reportDate || report.uploadedAt,
          originalName: report.originalName,
          description: result.description,
          evidence: result.evidence
        });
      } else if (issue && issue.status !== 'resolved') {
        issue.status = 'resolved';
        issue.resolvedAt = report.reportDate || report.uploadedAt;
        issue.resolvedStage = report.stage;
        issue.history.push({
          type: 'pass',
          reportId: report.id,
          stage: report.stage,
          reportDate: report.reportDate || report.uploadedAt,
          originalName: report.originalName,
          description: result.description || 'PASS',
          evidence: result.evidence
        });
      }
    }
  }

  return Array.from(issueMap.values()).map(issue => {
    const openStageSet = new Set(
      issue.history
        .filter(h => h.type === 'fail' || h.type === 'recurring')
        .map(h => h.stage)
        .filter(Boolean)
    );
    return { ...issue, affectedStages: Array.from(openStageSet) };
  }).sort((a, b) => {
    const priority = { recurring: 0, open: 1, resolved: 2 };
    const statusDiff = priority[a.status] - priority[b.status];
    if (statusDiff !== 0) return statusDiff;
    return String(b.lastSeenAt || '').localeCompare(String(a.lastSeenAt || ''));
  });
}

export function buildProducts(reportList) {
  const groups = new Map();
  for (const report of reportList || []) {
    const productNo = normalizeProductNo(report.productNo);
    if (!productNo) continue;
    if (!groups.has(productNo)) groups.set(productNo, []);
    groups.get(productNo).push(report);
  }

  const products = [];
  for (const [productNo, groupReports] of groups.entries()) {
    const reports = [...groupReports].sort(reportSort);
    const latest = reports[reports.length - 1];
    const issues = buildIssueLedger(reports);
    const openIssues = issues.filter(i => i.status === 'open' || i.status === 'recurring');
    const recurringIssues = issues.filter(i => i.status === 'recurring');
    const resolvedIssues = issues.filter(i => i.status === 'resolved');
    const completedStages = Array.from(new Set(reports.map(r => normalizeStage(r.stage)).filter(Boolean)))
      .sort((a, b) => stageIndex(a) - stageIndex(b));
    const currentStage = completedStages[completedStages.length - 1] || '';
    const customers = Array.from(new Set(reports.map(r => r.customerName).filter(Boolean)));

    products.push({
      productNo,
      productName: latest.productName || reports.find(r => r.productName)?.productName || '',
      customerName: latest.customerName || customers[0] || '未分类',
      customers,
      currentStage,
      completedStages,
      reportCount: reports.length,
      openCount: openIssues.length,
      recurringCount: recurringIssues.length,
      resolvedCount: resolvedIssues.length,
      status: currentStage === 'PS' && openIssues.length === 0 ? 'completed' : 'developing',
      latestReportAt: latest.reportDate || latest.uploadedAt,
      reports,
      issues,
      openIssues,
      resolvedIssues
    });
  }

  return products.sort((a, b) => {
    if (a.openCount !== b.openCount) return b.openCount - a.openCount;
    return String(b.latestReportAt || '').localeCompare(String(a.latestReportAt || ''));
  });
}

export function summarizeProduct(product) {
  if (!product) return null;
  const { reports, issues, openIssues, resolvedIssues, ...summary } = product;
  return summary;
}

export function diffLifecycle(beforeProduct, afterProduct) {
  const before = new Map((beforeProduct?.issues || []).map(i => [i.issueKey, i]));
  const changes = { newOpen: [], resolved: [], recurring: [], stillOpen: [] };

  for (const issue of afterProduct?.issues || []) {
    const old = before.get(issue.issueKey);
    if (!old && issue.status !== 'resolved') changes.newOpen.push(issue);
    else if (old && old.status !== 'resolved' && issue.status === 'resolved') changes.resolved.push(issue);
    else if (old && old.status === 'resolved' && issue.status === 'recurring') changes.recurring.push(issue);
    else if (old && old.status !== 'resolved' && issue.status !== 'resolved') changes.stillOpen.push(issue);
  }
  return changes;
}
