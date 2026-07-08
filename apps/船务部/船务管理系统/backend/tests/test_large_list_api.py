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

    def test_bulk_update_shipment_items_saves_large_review_without_many_requests(self):
        shipment = self._create_shipment(1)
        ShipmentItem.objects.all().delete()
        items = [
            ShipmentItem.objects.create(
                shipment=shipment,
                seq_number=idx + 1,
                product_code=f"SKU-{idx:02d}",
                pieces=1,
                volume=Decimal("0.1000"),
            )
            for idx in range(75)
        ]

        payload = {
            "items": [
                {
                    "id": item.id,
                    "product_code": item.product_code,
                    "contract_number": f"4500{idx:04d}",
                    "customer_po": f"PO-{idx:04d}",
                    "quantity": idx + 10,
                    "pieces": idx + 1,
                    "pallet_count": idx % 5,
                    "volume": "0.3050",
                    "factory_remark": "兴信",
                    "spec": "52",
                    "box_dimensions": "10x20x30",
                }
                for idx, item in enumerate(items)
            ]
        }

        response = self.client.patch(
            f"/api/shipments/{shipment.id}/items/bulk-update/",
            payload,
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["updated"], 75)
        first = ShipmentItem.objects.get(id=items[0].id)
        last = ShipmentItem.objects.get(id=items[-1].id)
        self.assertEqual(first.contract_number, "45000000")
        self.assertEqual(first.quantity, 10)
        self.assertEqual(first.volume, Decimal("0.3050"))
        self.assertEqual(last.contract_number, "45000074")
        self.assertEqual(last.pieces, 75)

    def test_bulk_update_rejects_item_from_another_shipment(self):
        shipment = self._create_shipment(1)
        other = self._create_shipment(2)
        foreign_item = other.items.first()

        response = self.client.patch(
            f"/api/shipments/{shipment.id}/items/bulk-update/",
            {"items": [{"id": foreign_item.id, "pieces": 99}]},
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        foreign_item.refresh_from_db()
        self.assertNotEqual(foreign_item.pieces, 99)
