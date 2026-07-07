from rest_framework import serializers
from .models import EmailRecord


class EmailRecordSerializer(serializers.ModelSerializer):
    class Meta:
        model = EmailRecord
        fields = '__all__'


class MailboxConfigSerializer(serializers.Serializer):
    email = serializers.EmailField()
    password = serializers.CharField(write_only=True)
    imap_host = serializers.CharField(max_length=128, default='imaphz.qiye.163.com')
    imap_port = serializers.IntegerField(default=993)
