// Match the customer cell itself, including a customer name wrapped by the PDF renderer.
function endsWithJazwaresCustomer(block) {
  return /(?:^|\n)Jazwares(?:,?\s+LLC\.?)?(?:\s*\[[^\]\n]+\])?$/i.test(block.trim());
}

function packagingFromNotes(notes) {
  const versions = new Set();
  for (const line of notes.split(/\r?\n/)) {
    const entry = line.trim().replace(/^(?:\(\d+\)|\d+[.)]|[*•])\s*/, '');
    const label = entry.match(/^Packaging(?:\s+(?:version|artwork))?\s*[:：]\s*(.*)$/i);
    const value = (label ? label[1] : entry).trim().replace(/[.;；]$/, '').trim();
    if (/^2\s*L(?:\s+English\s*\/\s*French)?$/i.test(value)) {
      versions.add('Jazwares客版（2L）');
    } else if (/^(?:(?:Sky Castle\s+)?(?:Generic\s+)?US(?:\s+Generic)?\s+Packaging|美文版?)$/i.test(value) ||
               (label && /^(?:US(?:\s+English)?|English)$/i.test(value))) {
      versions.add('Jazwares客版（美文）');
    }
  }
  if (versions.size > 1) throw Error('Jazwares PO 的 NOTES 同时列出美文与 2L，请核对包装版本');
  return [...versions][0];
}
module.exports = { endsWithJazwaresCustomer, packagingFromNotes };
