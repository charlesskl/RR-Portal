from rest_framework import serializers
from .models import Customer, TransportCompany, FactoryMapping, ProductMapping, DestinationPortMapping


class CustomerSerializer(serializers.ModelSerializer):
    class Meta:
        model = Customer
        fields = '__all__'


class TransportCompanySerializer(serializers.ModelSerializer):
    class Meta:
        model = TransportCompany
        fields = '__all__'


class FactoryMappingSerializer(serializers.ModelSerializer):
    class Meta:
        model = FactoryMapping
        fields = '__all__'


class ProductMappingSerializer(serializers.ModelSerializer):
    class Meta:
        model = ProductMapping
        fields = '__all__'

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        # PATCH/PUT 更新时，将 unique_together 的定位字段设为只读，避免约束冲突
        if self.instance is not None:
            self.fields['product_code'].read_only = True
            self.fields['customer_name'].read_only = True
            self.fields['qty_per_box'].read_only = True


class DestinationPortMappingSerializer(serializers.ModelSerializer):
    class Meta:
        model = DestinationPortMapping
        fields = ['id', 'port_name', 'country_cn', 'created_at']
