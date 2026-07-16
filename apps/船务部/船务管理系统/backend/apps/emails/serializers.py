from rest_framework import serializers
from .models import EmailRecord


class EmailRecordSerializer(serializers.ModelSerializer):
    class Meta:
        model = EmailRecord
        fields = '__all__'


class EmailRecordListSerializer(serializers.ModelSerializer):
    parsed_items_count = serializers.SerializerMethodField()

    class Meta:
        model = EmailRecord
        fields = [
            'id',
            'subject',
            'sender',
            'received_at',
            'status',
            'created_at',
            'parsed_items_count',
        ]

    def get_parsed_items_count(self, obj):
        parsed = obj.parsed_data or {}
        return len(parsed.get('packing_list_items') or [])


class MailboxConfigSerializer(serializers.Serializer):
    email = serializers.EmailField()
    password = serializers.CharField(write_only=True)
    imap_host = serializers.CharField(max_length=128, default='imaphz.qiye.163.com')
    imap_port = serializers.IntegerField(default=993)
