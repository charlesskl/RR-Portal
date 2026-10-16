const { createHash } = require('node:crypto');

// Hash the original stored text, without parsing/reformatting its JSON. Both
// summary metadata editors share the sales section and must not overwrite a
// change made after the page was loaded.
const payloadRevision = section => createHash('sha256').update(section?.payload_json ?? '{}').digest('hex');
const validRevision = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
function assertRevision(section, expected) {
  if (payloadRevision(section) !== expected) throw Object.assign(new Error('核价资料已更新，请保留当前输入并刷新核对后重试'), { status: 409 });
}

// The second check belongs in the write itself: another connection can create
// a newer version or cancel/delete this one after the earlier SELECT.
const saveMetadataSql = `UPDATE quote_verification_sections SET payload_json=?
  WHERE id=? AND payload_json IS NOT DISTINCT FROM ?
    AND EXISTS (SELECT 1 FROM quote_verification_versions v JOIN quotes q ON q.id=v.quote_id
      WHERE v.id=quote_verification_sections.version_id AND v.status<>'cancelled' AND q.deleted_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM quote_verification_versions newer
          WHERE newer.quote_id=v.quote_id AND newer.status<>'cancelled'
            AND (newer.version_no>v.version_no OR (newer.version_no=v.version_no AND newer.id>v.id))))`;

module.exports = { payloadRevision, validRevision, assertRevision, saveMetadataSql };
