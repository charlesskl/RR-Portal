// Match the customer cell itself, including a customer name wrapped by the PDF renderer.
function endsWithJazwaresCustomer(block) {
  return /(?:^|\n)Jazwares(?:,?\s+LLC\.?)?(?:\s*\[[^\]\n]+\])?$/i.test(block.trim());
}

// Some current POs use a Package field followed by a separate label instruction.
function skyCastleUSPackage(notes) {
  return /^[ \t]*(?:[*•-][ \t]*)?Package[ \t]*[:：]\s*(Sky Castle US packaging)(?:\s*\(in English\))?(?:\s*\+\s*importer label)?[.;]?[ \t]*$/im.exec(notes)?.[1] || '';
}

function packagingFromNotes(notes) {
  const versions = new Set();
  if (skyCastleUSPackage(notes)) versions.add('Jazwares客版（美文）');
  for (const line of notes.split(/\r?\n/)) {
    const entry = line.trim().replace(/^(?:\(\d+\)|\d+[.)]|[*•])\s*/, '');
    const label = entry.match(/^Packaging(?:\s+(?:version|artwork))?\s*[:：]\s*(.*)$/i);
    const value = (label ? label[1] : entry).trim().replace(/[.;；]$/, '').trim();
    // A PO may put its importer-label instruction on the same line as the artwork.
    const artwork = value.replace(/,\s*will apply importer label$/i, '').trim();
    if (/^2\s*L(?:\s+English\s*\/\s*French)?$/i.test(artwork)) {
      versions.add('Jazwares客版（2L）');
    } else if (/^(?:(?:Sky Castle\s+)?(?:Generic\s+)?US(?:\s+Generic)?\s+Packaging|Sky Castle English artwork|美文版?)$/i.test(artwork) ||
               (label && /^(?:US(?:\s+English)?|English)$/i.test(artwork))) {
      versions.add('Jazwares客版（美文）');
    }
  }
  if (versions.size > 1) throw Error('Jazwares PO 的 NOTES 同时列出美文与 2L，请核对包装版本');
  return [...versions][0];
}
module.exports = { endsWithJazwaresCustomer, packagingFromNotes, skyCastleUSPackage };
