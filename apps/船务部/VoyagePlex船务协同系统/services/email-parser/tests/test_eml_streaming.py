"""Local synthetic MIME equivalence, not Linux/container memory validation."""
import base64
import email
from email import policy
from email.message import EmailMessage
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from types import SimpleNamespace
from app import eml as candidate
from app.carrier_schedule import carrier_tables
import hashlib
import json
import re


def legacy_parse_eml(raw, workdir):
    # Compare the previous stdlib whole-message decode against incremental MIME
    # ingestion. The reference deliberately uses get_payload(decode=True).
    msg = email.message_from_bytes(raw, policy=policy.default)
    workdir.mkdir(parents=True, exist_ok=True)
    attachments = []
    for part in msg.walk():
        filename = part.get_filename()
        if not filename:
            continue
        payload = part.get_payload(decode=True)
        if not payload:
            continue
        original = candidate.decode_header_value(filename)
        safe = re.sub(r"[^A-Za-z0-9._\-\u4e00-\u9fff]", "_", Path(original).name) or "attachment"
        path = workdir / f"{len(attachments) + 1:03d}_{safe}"
        path.write_bytes(payload)
        attachments.append({"filename": original, "stored_name": path.name, "stored_path": str(path),
            "content_type": part.get_content_type(), "size": len(payload), "sha256": hashlib.sha256(payload).hexdigest()})
    body = candidate.extract_body(msg)
    business = {"sender": candidate.decode_header_value(msg.get("From", "")).strip().lower(),
        "subject": candidate.decode_header_value(msg.get("Subject", "")), "date": str(msg.get("Date", "")),
        "body": body, "attachments": sorted((part["filename"], part["sha256"]) for part in attachments)}
    return {"business_fingerprint": hashlib.sha256(json.dumps(business, ensure_ascii=False, sort_keys=True).encode()).hexdigest(),
        "fingerprint": hashlib.sha256(raw).hexdigest(), "message_id": str(msg.get("Message-ID", "")),
        "subject": candidate.decode_header_value(msg.get("Subject", "")), "sender": candidate.decode_header_value(msg.get("From", "")),
        "received_at": str(msg.get("Date", "")), "body_text": body, "body_tables": carrier_tables(msg), "attachments": attachments}


baseline = SimpleNamespace(parse_eml=legacy_parse_eml)

def comparable(value):
    return {key: ([{k: v for k, v in item.items() if k != 'stored_path'} for item in val]
                  if key == 'attachments' else val) for key, val in value.items()}

class Equivalence(unittest.TestCase):
    def compare(self, raw):
        with tempfile.TemporaryDirectory() as directory:
            old = baseline.parse_eml(raw, Path(directory) / 'old')
            new = candidate.parse_eml(raw, Path(directory) / 'new')
            self.assertEqual(comparable(old), comparable(new))
            for a, b in zip(old['attachments'], new['attachments']):
                self.assertEqual(Path(a['stored_path']).read_bytes(), Path(b['stored_path']).read_bytes())
    def test_crlf_lf_and_no_final_newline(self):
        for ending in [b'\r\n', b'\n', b'\r']:
            for tail in [ending, b'']:
                with self.subTest(ending=ending, final=bool(tail)):
                    self.compare(ending.join([b'From: a@example.invalid', b'Subject: synthetic',
                        b'Content-Type: text/plain; charset=utf-8', b'', '中文内容'.encode()]) + tail)
    def test_alternatives_tables_encoded_headers_and_attachments(self):
        msg = EmailMessage()
        msg['From'] = '合成测试 <a@example.invalid>'
        msg['Subject'] = '测试非业务邮件'
        msg['Message-ID'] = '<synthetic@example.invalid>'
        msg['Date'] = 'Mon, 19 Oct 2026 00:00:00 +0000'
        msg.set_content('合成正文')
        msg.add_alternative('<table><tr><td>SO</td><td>carrier</td></tr></table>', subtype='html')
        for filename, data in [('duplicate.pdf', b'abc' * 1000), ('duplicate.pdf', b'xyz'), ('测试.xlsx', bytes(range(256)))]:
            msg.add_attachment(data, maintype='application', subtype='octet-stream', filename=filename)
        self.compare(msg.as_bytes(policy=policy.SMTP))
    def test_all_transfer_encodings_and_malformed_base64(self):
        for encoding, payload in [('base64', b'YQ'), ('base64', b'YQ$=='), ('base64', b'A'),
                                  ('quoted-printable', b'=E4=B8=AD=E6=96=87'), ('8bit', b'\xff\x80abc'),
                                  ('binary', b'\x00\xffabc'), ('x-uuencode', b'broken uuencode')]:
            with self.subTest(encoding=encoding, payload=payload):
                raw = ('MIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary=X\r\n\r\n'
                       '--X\r\nContent-Type: application/octet-stream\r\n'
                       'Content-Disposition: attachment; filename="synthetic.bin"\r\n'
                       'Content-Transfer-Encoding: ' + encoding + '\r\n\r\n').encode() + payload + b'\r\n--X--\r\n'
                self.compare(raw)
    def test_chunk_boundaries_split_header_crlf_boundary_and_payload(self):
        for extra in range(12):
            raw = b'X-Pad: ' + b'a' * (65536 - 12 + extra) + b'\r\nContent-Type: text/plain\r\n\r\n' + b'x' * 131071 + b'\r\n'
            with self.subTest(extra=extra):self.compare(raw)
    def test_nested_message_and_malformed_multipart(self):
        for raw in [b'Content-Type: message/rfc822\r\n\r\nFrom: x@example.invalid\r\n\r\nNested',
                    b'Content-Type: multipart/mixed; boundary=M\r\n\r\n--M\r\nContent-Type: text/plain\r\n\r\nabc',
                    b'not a valid header\r\n\r\nbody', b'']:
            with self.subTest(length=len(raw)):self.compare(raw)

class CanonicalBase64(unittest.TestCase):
    def part(self, payload):
        return email.message_from_bytes(b'Content-Type: application/octet-stream\r\n'
            b'Content-Disposition: attachment; filename="synthetic.bin"\r\n'
            b'Content-Transfer-Encoding: base64\r\n\r\n' + payload, policy=policy.default)
    def test_padding_linebreak_and_chunk_boundaries(self):
        # Raw lengths exercise 0/1/2 padding bytes; line sizes force padding and
        # complete quanta across the 64KiB feed/decode chunk boundary.
        for length in [1,2,3,4,5,6,49149,49150,49151,49152,49153,65535,65536,65537,131073]:
            raw = bytes(range(256)) * (length//256) + bytes(range(length%256))
            encoded = base64.b64encode(raw)
            for line_length,ending in [(76,b'\r\n'),(71,b'\n'),(65535,b'\r\n'),(65536,b'\r'),(len(encoded),b'')]:
                payload=ending.join(encoded[i:i+line_length] for i in range(0,len(encoded),line_length))
                part=self.part(payload);expected=part.get_payload(decode=True)
                actual=part.get_payload
                def bounded_get_payload(*args,**kwargs):
                    self.assertFalse(kwargs.get('decode',False))
                    return actual(*args,**kwargs)
                with self.subTest(length=length,line=line_length,ending=ending),tempfile.TemporaryDirectory() as directory:
                    path=Path(directory)/'attachment'
                    with patch.object(part,'get_payload',side_effect=bounded_get_payload):summary=candidate._write_canonical_base64(part,path)
                    self.assertIsNotNone(summary);self.assertEqual(path.read_bytes(),expected)
                    self.assertEqual(summary,(len(expected),__import__('hashlib').sha256(expected).hexdigest()))
    def test_noncanonical_never_writes_before_stdlib_fallback(self):
        for payload in [b'',b'\r\n',b'YQ',b'YQ=',b'YQ===',b'====',b'A',b'AA=A',b'AA==A',
                        b'AA==\nAA==',b'Y Q==',b'YQ$==',b'YQ==\x0b',b'\xffYQ==']:
            with self.subTest(payload=payload),tempfile.TemporaryDirectory() as directory:
                path=Path(directory)/'attachment'
                self.assertIsNone(candidate._write_canonical_base64(self.part(payload),path))
                self.assertFalse(path.exists())
                Equivalence.compare(self,self.part(payload).as_bytes(policy=policy.SMTP))
    def test_padding_across_boundary_then_later_data_falls_back(self):
        for payload in [b'A'*65535+b'=\r\nAAAA', b'A'*65534+b'=\r\n=A', b'A'*65534+b'===']:
            with self.subTest(length=len(payload)),tempfile.TemporaryDirectory() as directory:
                path=Path(directory)/'attachment'
                self.assertIsNone(candidate._write_canonical_base64(self.part(payload),path));self.assertFalse(path.exists())
    def test_other_encodings_and_multipart_keep_stdlib_path(self):
        for encoding in ['quoted-printable','8bit','x-uuencode','binary']:
            part=self.part(b'YQ==');part.replace_header('Content-Transfer-Encoding',encoding)
            with self.subTest(encoding=encoding),tempfile.TemporaryDirectory() as directory:
                path=Path(directory)/'attachment'
                self.assertIsNone(candidate._write_canonical_base64(part,path));self.assertFalse(path.exists())
        multipart=EmailMessage();multipart.make_mixed();multipart['Content-Transfer-Encoding']='base64'
        with tempfile.TemporaryDirectory() as directory:
            self.assertIsNone(candidate._write_canonical_base64(multipart,Path(directory)/'attachment'))

if __name__ == '__main__':unittest.main(verbosity=2)
