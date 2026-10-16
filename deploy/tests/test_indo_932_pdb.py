"""Synthetic real-format PE/Portable PDB binding and source checksum negative cases."""
import hashlib
import importlib.util
import pathlib
import struct
import unittest
import uuid
from unittest import mock

SPEC = importlib.util.spec_from_file_location('indo_932_pdb', pathlib.Path(__file__).parents[1] / 'ops/indo-932-pdb.py')
proof = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(proof)
DOCUMENT = 'src/IndoShipping.Api/Controllers/DictionariesController.cs'
SOURCE = hashlib.sha256(b'reviewed C# fixture').hexdigest()
PDB_ID = bytes(range(20))


def compressed(value):
    if value < 128:
        return bytes([value])
    if value < 16384:
        return bytes([0x80 | (value >> 8), value & 255])
    return bytes([0xc0 | (value >> 24), (value >> 16) & 255, (value >> 8) & 255, value & 255])


def fixture(source=SOURCE, pdb_id=PDB_ID, name=DOCUMENT):
    blob = bytearray(b'\0')
    def add(content):
        offset = len(blob)
        blob.extend(compressed(len(content)) + content)
        return offset
    segments = [add(part.encode()) if part else 0 for part in name.split('/')]
    name_offset = add(b'/' + b''.join(compressed(index) for index in segments))
    hash_offset = add(bytes.fromhex(source))
    table = (struct.pack('<IBBBBQQ', 0, 2, 0, 0, 1, 1 << 48, 0)
             + struct.pack('<IHHHH', 1, name_offset, 1, hash_offset, 1))
    streams = {'#Pdb': pdb_id + b'\0' * 16, '#~': table,
               '#Blob': bytes(blob), '#GUID': uuid.UUID(proof.SHA256_GUID).bytes_le}
    root = bytearray(b'BSJB' + struct.pack('<HHII', 1, 1, 0, 4) + b'v4\0\0'
                     + struct.pack('<HH', 0, len(streams)))
    header_size = len(root) + sum(8 + ((len(key) + 4) & ~3) for key in streams)
    payload = bytearray()
    for key, content in streams.items():
        encoded = key.encode() + b'\0'
        encoded += b'\0' * ((-len(encoded)) % 4)
        root.extend(struct.pack('<II', header_size + len(payload), len(content)) + encoded)
        payload.extend(content)
    pdb = bytes(root + payload)
    pe = bytearray(1024)
    pe[:2] = b'MZ'
    struct.pack_into('<I', pe, 0x3c, 0x80)
    pe[0x80:0x84] = b'PE\0\0'
    struct.pack_into('<HH', pe, 0x84, 0x14c, 1)
    struct.pack_into('<H', pe, 0x94, 224)
    optional = 0x98
    struct.pack_into('<H', pe, optional, 0x10b)
    struct.pack_into('<I', pe, optional + 92, 16)
    struct.pack_into('<II', pe, optional + 96 + 48, 0x2000, 28)
    section = optional + 224
    struct.pack_into('<IIII', pe, section + 8, 512, 0x2000, 512, 512)
    codeview = b'RSDS' + pdb_id[:16] + b'\1\0\0\0' + b'IndoShipping.Api.pdb\0'
    pe[512 + 4:512 + 8] = pdb_id[16:20]
    struct.pack_into('<I', pe, 512 + 12, 2)
    struct.pack_into('<III', pe, 512 + 16, len(codeview), 0x2040, 576)
    pe[576:576 + len(codeview)] = codeview
    return bytes(pe), pdb


class PdbTests(unittest.TestCase):
    def test_matching_actual_format_document_and_dll_proven(self):
        dll, pdb = fixture()
        result = proof.prove(dll, pdb, {DOCUMENT: SOURCE})
        self.assertTrue(result['codeViewMatchesPortablePdb'])
        self.assertEqual(result['reviewedDocuments'], 1)
        self.assertNotIn(DOCUMENT, str(result))

    def test_absolute_container_document_path_matches_suffix(self):
        dll, pdb = fixture(name='/src/' + DOCUMENT)
        self.assertTrue(proof.prove(dll, pdb, {DOCUMENT: SOURCE})['reviewedDocumentChecksumsMatched'])

    def test_stale_source_checksum_rejected(self):
        dll, pdb = fixture(source='a' * 64)
        with self.assertRaises(ValueError):
            proof.prove(dll, pdb, {DOCUMENT: SOURCE})

    def test_unrelated_pdb_same_source_rejected(self):
        dll, _ = fixture()
        _, pdb = fixture(pdb_id=bytes(reversed(PDB_ID)))
        with self.assertRaises(ValueError):
            proof.prove(dll, pdb, {DOCUMENT: SOURCE})

    def test_stamp_mismatch_rejected_even_if_guid_matches(self):
        dll, _ = fixture()
        _, pdb = fixture(pdb_id=PDB_ID[:16] + b'abcd')
        with self.assertRaises(ValueError):
            proof.prove(dll, pdb, {DOCUMENT: SOURCE})

    def test_missing_document_rejected(self):
        dll, pdb = fixture(name='src/IndoShipping.Api/Unrelated.cs')
        with self.assertRaises(ValueError):
            proof.prove(dll, pdb, {DOCUMENT: SOURCE})

    def test_generated_fake_parent_path_not_allowed(self):
        dll, pdb = fixture(name='src/IndoShipping.Api/../fixture.cs')
        with self.assertRaises(ValueError):
            proof.prove(dll, pdb, {'src/IndoShipping.Api/../fixture.cs': SOURCE})

    def test_empty_document_pin_rejected(self):
        dll, pdb = fixture()
        with self.assertRaises(ValueError):
            proof.prove(dll, pdb, {})

    def test_bad_pe_and_pdb_bounds_rejected(self):
        dll, pdb = fixture()
        for bad in (b'x', dll[:100], dll[:580]):
            with self.assertRaises(ValueError):
                proof.prove(bad, pdb, {DOCUMENT: SOURCE})
        for bad in (b'x', pdb[:24], pdb[:-20]):
            with self.assertRaises(ValueError):
                proof.prove(dll, bad, {DOCUMENT: SOURCE})

    def test_bounded_files(self):
        with self.assertRaises(ValueError):
            proof.Reader(b'a' * (proof.MAX_FILE + 1))
        with self.assertRaises(ValueError):
            proof.Reader(b'')

    def test_compressed_blob_indexes(self):
        for value in (1, 127, 128, 16383, 16384, 0x1fffffff):
            encoded = compressed(value)
            self.assertEqual(proof.compressed(proof.Reader(encoded), 0), (value, len(encoded)))
        with self.assertRaises(ValueError):
            proof.compressed(proof.Reader(b'\xff\0\0\0'), 0)

    def test_wrong_hash_algorithm_rejected(self):
        dll, pdb = fixture()
        wrong = pdb.replace(uuid.UUID(proof.SHA256_GUID).bytes_le, b'\0' * 16)
        with self.assertRaises(ValueError):
            proof.prove(dll, wrong, {DOCUMENT: SOURCE})

    def test_extra_untracked_source_document_rejected(self):
        dll, pdb = fixture()
        pid, docs = proof.pdb_documents(pdb)
        docs['/src/src/IndoShipping.Api/Untracked.cs'] = 'a' * 64
        with mock.patch.object(proof, 'pdb_documents', return_value=(pid, docs)), self.assertRaises(ValueError):
            proof.prove(dll, pdb, {DOCUMENT: SOURCE})

    def test_only_exact_known_release_generated_documents_allowed(self):
        dll, pdb = fixture()
        pid, docs = proof.pdb_documents(pdb)
        for filename in ('IndoShipping.Api.GlobalUsings.g.cs', 'IndoShipping.Api.AssemblyInfo.cs',
                         '.NETCoreApp,Version=v8.0.AssemblyAttributes.cs', 'IndoShipping.Api.MvcApplicationPartsAssemblyInfo.cs'):
            docs['/src/src/IndoShipping.Api/obj/Release/net8.0/' + filename] = 'a' * 64
        with mock.patch.object(proof, 'pdb_documents', return_value=(pid, docs)):
            self.assertTrue(proof.prove(dll, pdb, {DOCUMENT: SOURCE})['nonGeneratedDocumentInventoryMatched'])

    def test_unknown_obj_debug_or_different_project_document_rejected(self):
        dll, pdb = fixture()
        for relative in ('IndoShipping.Api/obj/Release/net8.0/Malicious.cs',
                         'IndoShipping.Api/obj/Debug/net8.0/IndoShipping.Api.GlobalUsings.g.cs',
                         'IndoShipping.Domain/obj/Release/net8.0/IndoShipping.Domain.GlobalUsings.g.cs'):
            pid, docs = proof.pdb_documents(pdb)
            docs['/src/src/' + relative] = 'a' * 64
            with self.subTest(relative=relative), mock.patch.object(proof, 'pdb_documents', return_value=(pid, docs)), self.assertRaises(ValueError):
                proof.prove(dll, pdb, {DOCUMENT: SOURCE})



if __name__ == '__main__':
    unittest.main()
