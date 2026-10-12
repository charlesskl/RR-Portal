import os
import imaplib
import unittest
from unittest.mock import patch

from app.mailbox import fetch_mailbox, test_mailbox_connection


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
    def test_identity_is_sent_before_folder_access_for_test_and_sync(self):
        for operation in (test_mailbox_connection, fetch_mailbox):
            with self.subTest(operation=operation.__name__):
                fake = FakeImap()
                fake.capabilities = (b"IMAP4rev1", b"ID")
                events = []

                def identify(command, payload):
                    self.assertEqual(command, "ID")
                    self.assertIn('"VoyagePlex"', payload)
                    self.assertNotIn("test-code", payload)
                    events.append("identity")
                    return "OK", [b"ID completed"]

                original_select = fake.select

                def select(*args, **kwargs):
                    self.assertEqual(events, ["identity"])
                    return original_select(*args, **kwargs)

                fake._simple_command = identify
                fake.select = select
                credentials = {"address": "shipping@example.com", "auth_code": "test-code", "host": "imap.163.com"}
                with patch("app.mailbox.imaplib.IMAP4_SSL", return_value=fake):
                    if operation == fetch_mailbox:
                        self.assertTrue(operation(credentials=credentials)["configured"])
                    else:
                        self.assertTrue(operation(credentials)["connected"])

    def test_folder_errors_distinguish_security_from_missing_folder(self):
        for response, expected in ((b"Unsafe Login", "安全限制"), (b"No such mailbox", "文件夹名称和权限")):
            for raises in (False, True):
                with self.subTest(response=response, raises=raises):
                    fake = FakeImap()
                    def select(*args, **kwargs):
                        if raises:
                            raise imaplib.IMAP4.error(response)
                        return "NO", [response]
                    fake.select = select
                    with patch("app.mailbox.imaplib.IMAP4_SSL", return_value=fake):
                        result = test_mailbox_connection({"address": "shipping@example.com", "auth_code": "test-code"})
                    self.assertFalse(result["connected"])
                    self.assertIn(expected, result["message"])

    def test_identity_rejection_does_not_report_success(self):
        fake = FakeImap()
        fake.capabilities = (b"ID",)
        fake._simple_command = lambda *args: ("NO", [b"Denied"])
        with patch("app.mailbox.imaplib.IMAP4_SSL", return_value=fake):
            result = test_mailbox_connection({"address": "shipping@example.com", "auth_code": "test-code"})
            self.assertFalse(result["connected"])
            self.assertIn("身份声明", result["message"])
            with self.assertRaises(imaplib.IMAP4.error):
                fetch_mailbox(credentials={"address": "shipping@example.com", "auth_code": "test-code"})

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

    def test_search_starts_one_day_before_china_boundary(self):
        fake = FakeImap()
        original_uid = fake.uid
        searches = []

        def capture_uid(command, *args):
            if command == "SEARCH":
                searches.append(args)
            return original_uid(command, *args)

        fake.uid = capture_uid
        with patch.dict(os.environ, {
            "VOYAGEPLEX_MAIL_ADDRESS": "shipping@example.com",
            "VOYAGEPLEX_MAIL_AUTH_CODE": "test-code",
        }, clear=True), patch("app.mailbox.imaplib.IMAP4_SSL", return_value=fake):
            fetch_mailbox(after_uid=12, start_date="2026-08-01")
        self.assertEqual(searches, [(None, "SINCE", "31-Jul-2026")])


if __name__ == "__main__":
    unittest.main()
