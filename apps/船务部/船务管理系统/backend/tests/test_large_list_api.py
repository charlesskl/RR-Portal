from decimal import Decimal

from django.utils import timezone
from rest_framework.test import APITestCase

from apps.accounts.models import User
from apps.emails.models import EmailRecord
from apps.master_data.models import Customer
from apps.shipments.models import Shipment, ShipmentItem


class LargeListApiTest(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username="supervisor",
            password="testpass123",
            role="supervisor",
        )
        self.customer = Customer.objects.create(name="ZURU")
        self.client.force_authenticate(self.user)

    def _create_shipment(self, idx):
        shipment = Shipment.objects.create(
            shipment_type=Shipment.ShipmentType.NORMAL,
            customer=self.customer,
            so_number=f"SO-{idx:03d}",
            container_type="40HQ",
            port="YANTIAN",
            delivery_address="US",
            created_by=self.user,
        )
        for item_idx in range(2):
            ShipmentItem.objects.create(
                shipment=shipment,
                seq_number=item_idx + 1,
                product_code=f"SKU-{idx}-{item_idx}",
                pieces=10,
                volume=Decimal("1.5000"),
            )
        return shipment

    def test_shipment_list_is_paginated_and_omits_nested_items(self):
        shipment = self._create_shipment(1)
        self._create_shipment(2)
        self._create_shipment(3)

        response = self.client.get("/api/shipments/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["count"], 3)
        self.assertIn("results", response.data)

        row = response.data["results"][0]
        self.assertNotIn("items", row)
        self.assertEqual(row["items_count"], 2)
        self.assertEqual(row["total_cbm"], "3.000")

        detail_response = self.client.get(f"/api/shipments/{shipment.id}/")

        self.assertEqual(detail_response.status_code, 200)
        self.assertIn("items", detail_response.data)
        self.assertEqual(len(detail_response.data["items"]), 2)

    def test_email_list_is_paginated_and_detail_keeps_full_payload(self):
        email = EmailRecord.objects.create(
            subject="SO test",
            sender="shipping@example.com",
            received_at=timezone.now(),
            body_text="large body" * 1000,
            parsed_data={"packing_list_items": [{"product_code": "SKU-1"}]},
            attachments=[{"filename": "pl.xlsx", "path": "/tmp/pl.xlsx"}],
            status=EmailRecord.Status.PARSED,
        )
        EmailRecord.objects.create(
            subject="SO other",
            sender="shipping@example.com",
            body_text="large body" * 1000,
            parsed_data={"packing_list_items": [{"product_code": "SKU-2"}]},
            status=EmailRecord.Status.PARSED,
        )

        response = self.client.get("/api/emails/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["count"], 2)
        row = response.data["results"][0]
        self.assertNotIn("body_text", row)
        self.assertNotIn("parsed_data", row)
        self.assertEqual(row["parsed_items_count"], 1)

        detail_response = self.client.get(f"/api/emails/{email.id}/")

        self.assertEqual(detail_response.status_code, 200)
        self.assertIn("body_text", detail_response.data)
        self.assertEqual(
            detail_response.data["parsed_data"]["packing_list_items"][0]["product_code"],
            "SKU-1",
        )
