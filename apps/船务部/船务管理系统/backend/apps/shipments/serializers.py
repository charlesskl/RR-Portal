from decimal import Decimal, InvalidOperation

from rest_framework import serializers
from .models import Shipment, ShipmentItem, ShipmentSubItem


class ShipmentSubItemSerializer(serializers.ModelSerializer):
    class Meta:
        model = ShipmentSubItem
        fields = '__all__'
        read_only_fields = ['parent_item']


class ShipmentItemSerializer(serializers.ModelSerializer):
    sub_items = ShipmentSubItemSerializer(many=True, read_only=True)

    class Meta:
        model = ShipmentItem
        fields = '__all__'
        read_only_fields = ['gross_weight', 'net_weight']


class ShipmentSerializer(serializers.ModelSerializer):
    """出货单序列化器（读取，含嵌套明细）"""
    items = ShipmentItemSerializer(many=True, read_only=True)

    class Meta:
        model = Shipment
        fields = '__all__'


class ShipmentListSerializer(serializers.ModelSerializer):
    items_count = serializers.IntegerField(read_only=True)
    total_cbm = serializers.SerializerMethodField()

    class Meta:
        model = Shipment
        fields = [
            'id',
            'shipment_type',
            'status',
            'customer',
            'si_deadline',
            'so_number',
            'cutoff_date',
            'container_type',
            'port',
            'ship_date',
            'container_number',
            'seal_number',
            'container_weight',
            'main_factory',
            'customs_broker',
            'delivery_address',
            'special_requirements',
            'remarks',
            'warehouse',
            'customs_cutoff',
            'source_email_id',
            'created_by',
            'created_at',
            'items_count',
            'total_cbm',
        ]

    def get_total_cbm(self, obj):
        value = getattr(obj, 'total_cbm', None)
        if value in (None, ''):
            return '0.000'
        try:
            return f'{Decimal(value):.3f}'
        except (InvalidOperation, TypeError, ValueError):
            return '0.000'


class ShipmentItemCreateSerializer(serializers.ModelSerializer):
    """出货明细创建序列化器"""
    class Meta:
        model = ShipmentItem
        exclude = ['shipment']
        read_only_fields = ['gross_weight', 'net_weight']


class ShipmentCreateSerializer(serializers.ModelSerializer):
    """出货单创建序列化器（写入，含嵌套明细创建）"""
    items = ShipmentItemCreateSerializer(many=True, required=False)

    class Meta:
        model = Shipment
        fields = '__all__'
        read_only_fields = ['created_by', 'created_at']

    def create(self, validated_data):
        items_data = validated_data.pop('items', [])
        shipment = Shipment.objects.create(**validated_data)
        for item_data in items_data:
            ShipmentItem.objects.create(shipment=shipment, **item_data)
        return shipment
