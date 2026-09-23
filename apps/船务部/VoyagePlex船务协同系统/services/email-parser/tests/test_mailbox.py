import os
import unittest
from unittest.mock import patch

from app.mailbox import fetch_mailbox


class FakeImap:
    def __init__(self, *_args, **_kwargs):
        self.requested = []

    def login(self, address, secret):
        assert address == "shipping@example.com"
        assert secret == "test-code"

    def select(self, folder, readonly=False):
        assert folder == "INBOX" and readonly
        return "OK", [b"3"]

    def response(self, name):
        assert name == "UIDVALIDITY"
        return "UIDVALIDITY", [b"123"]

    def uid(self, command, *_args):
        if command == "SEARCH":
            return "OK", [b"10 11 12"]
        self.requested.append(int(_args[0]))
        return "OK", [(b'INTERNALDATE "18-Sep-2026 00:30:00 +0800" BODY[]',
                       b"Subject: shipment\r\n\r\nDetails")]

    def logout(self):
        pass


class MailboxTests(unittest.TestCase):
    def test_unconfigured_mailbox_does_not_connect(self):
        with patch.dict(os.environ, {}, clear=True):
            self.assertEqual(fetch_mailbox(), {"configured": False, "messages": []})

    def test_reads_only_new_messages_without_marking_seen(self):
        fake = FakeImap()
        with patch.dict(os.environ, {
            "VOYAGEPLEX_MAIL_ADDRESS": "shipping@example.com",
            "VOYAGEPLEX_MAIL_AUTH_CODE": "test-code",
        }, clear=True), patch("app.mailbox.imaplib.IMAP4_SSL", return_value=fake):
            result = fetch_mailbox(after_uid=10)
        self.assertEqual(result["uid_validity"], 123)
        self.assertEqual([item["uid"] for item in result["messages"]], [11, 12])
        self.assertEqual(fake.requested, [11, 12])
        self.assertEqual(result["messages"][0]["received_at"], "2026-09-17T16:30:00+00:00")

    def test_single_message_fetch_failure_does_not_abort_batch(self):
        class FlakyImap(FakeImap):
            def uid(self, command, *args):
                if command == "FETCH" and int(args[0]) == 11:
                    return "NO", [None]
                return super().uid(command, *args)

        with patch.dict(os.environ, {
            "VOYAGEPLEX_MAIL_ADDRESS": "shipping@example.com",
            "VOYAGEPLEX_MAIL_AUTH_CODE": "test-code",
        }, clear=True), patch("app.mailbox.imaplib.IMAP4_SSL", return_value=FlakyImap()):
            result = fetch_mailbox(after_uid=10)
        self.assertEqual([item["uid"] for item in result["messages"]], [11, 12])
        failed, ok = result["messages"]
        self.assertIsNone(failed["raw"])
        self.assertIn("读取邮件 11 失败", failed["error"])
        self.assertEqual(ok["error"], "")
        self.assertIsNotNone(ok["raw"])


if __name__ == "__main__":
    unittest.main()
