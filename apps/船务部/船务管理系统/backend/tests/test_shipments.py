from decimal import Decimal
from django.test import TestCase
from apps.accounts.models import User
from apps.master_data.models import Customer
from apps.shipments.models import Shipment, ShipmentItem


class ShipmentModelTest(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username='testuser', password='testpass123')
        self.customer = Customer.objects.create(name='ZURU')

    def test_create_shipment(self):
        shipment = Shipment.objects.create(
            shipment_type=Shipment.ShipmentType.NORMAL,
            customer=self.customer,
            so_number='SO-2026-001',
            container_type='40HQ',
            port='YANTIAN',
            created_by=self.user,
        )
        self.assertEqual(shipment.shipment_type, 'normal')
        self.assertEqual(shipment.customer, self.customer)
        self.assertEqual(shipment.so_number, 'SO-2026-001')
        self.assertIsNotNone(shipment.created_at)

    def test_create_warehouse_shipment(self):
        shipment = Shipment.objects.create(
            shipment_type=Shipment.ShipmentType.WAREHOUSE,
            customer=self.customer,
            warehouse='东莞仓库',
            created_by=self.user,
        )
        self.assertEqual(shipment.shipment_type, 'warehouse')
        self.assertEqual(shipment.warehouse, '东莞仓库')


class ShipmentItemModelTest(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username='testuser', password='testpass123')
        self.customer = Customer.objects.create(name='ZURU')
        self.shipment = Shipment.objects.create(
            shipment_type=Shipment.ShipmentType.NORMAL,
            customer=self.customer,
            created_by=self.user,
        )

    def test_create_item_with_auto_calc(self):
        item = ShipmentItem.objects.create(
            shipment=self.shipment,
            seq_number=1,
            product_code='77711GQ4',
            product_name='冰箱迷你球',
            pieces=10,
            gross_weight_per_box=Decimal('1.578'),
            net_weight_per_box=Decimal('1.022'),
            volume=Decimal('5.5'),
        )
        self.assertEqual(item.gross_weight, Decimal('15.780'))
        self.assertEqual(item.net_weight, Decimal('10.220'))

    def test_create_item_without_weights(self):
        item = ShipmentItem.objects.create(
            shipment=self.shipment,
            seq_number=1,
            product_code='77711GQ4',
            pieces=10,
        )
        self.assertIsNone(item.gross_weight)
        self.assertIsNone(item.net_weight)

    def test_update_item_recalculates(self):
        item = ShipmentItem.objects.create(
            shipment=self.shipment,
            seq_number=1,
            product_code='77711GQ4',
            pieces=10,
            gross_weight_per_box=Decimal('1.578'),
            net_weight_per_box=Decimal('1.022'),
        )
        item.pieces = 20
        item.save()
        self.assertEqual(item.gross_weight, Decimal('31.560'))
        self.assertEqual(item.net_weight, Decimal('20.440'))

    def test_item_related_to_shipment(self):
        ShipmentItem.objects.create(
            shipment=self.shipment,
            seq_number=1,
            product_code='ITEM1',
        )
        ShipmentItem.objects.create(
            shipment=self.shipment,
            seq_number=2,
            product_code='ITEM2',
        )
        self.assertEqual(self.shipment.items.count(), 2)
