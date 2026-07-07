from django.db import models


class EmailRecord(models.Model):
    class Status(models.TextChoices):
        UNPROCESSED = 'unprocessed', '未处理'
        PARSED = 'parsed', '已解析'
        SHIPMENT_CREATED = 'shipment_created', '已创建出货单'
        PARSE_FAILED = 'parse_failed', '解析失败'

    message_id = models.CharField(max_length=500, blank=True)
    subject = models.CharField(max_length=500, blank=True)
    sender = models.CharField(max_length=200, blank=True)
    received_at = models.DateTimeField(null=True, blank=True)
    body_text = models.TextField(blank=True)
    parsed_data = models.JSONField(default=dict, blank=True)
    attachments = models.JSONField(default=list, blank=True)
    status = models.CharField(
        max_length=20,
        choices=Status.choices,
        default=Status.UNPROCESSED,
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']
        verbose_name = '邮件记录'
        verbose_name_plural = '邮件记录'

    def __str__(self):
        return f'{self.subject} ({self.get_status_display()})'
