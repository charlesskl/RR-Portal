from django.conf import settings
from django.db import models

from .calculations import calculate_weights


class Shipment(models.Model):
    """出货单模型"""

    class ShipmentType(models.TextChoices):
        NORMAL = 'normal', '正常柜单'
        WAREHOUSE = 'warehouse', '入仓(车)'
        CUSTOMER_LOAD = 'customer_load', '客上柜'
        CUSTOMER_TRUCK = 'customer_truck', '客上车'
        QINGXI = 'qingxi', '清溪物流园'

    class Status(models.TextChoices):
        CREATED = 'created', '已创建'
        PENDING_QC = 'pending_qc', '待验货'
        PENDING_LOADING = 'pending_loading', '待装柜'
        SHIPPED = 'shipped', '已出货'

    shipment_type = models.CharField(max_length=20, choices=ShipmentType.choices, verbose_name='出货类型')
    status = models.CharField(
        max_length=20, choices=Status.choices,
        default=Status.CREATED, verbose_name='状态'
    )
    customer = models.ForeignKey('master_data.Customer', on_delete=models.PROTECT, verbose_name='客户')
    si_deadline = models.DateTimeField(null=True, blank=True, verbose_name='SI截止时间')
    so_number = models.CharField(max_length=100, blank=True, verbose_name='SO号')
    cutoff_date = models.DateTimeField(null=True, blank=True, verbose_name='截关时间')
    container_type = models.CharField(max_length=50, blank=True, verbose_name='柜型')
    port = models.CharField(max_length=50, blank=True, verbose_name='港口')
    ship_date = models.DateField(null=True, blank=True, verbose_name='装船日期')
    container_number = models.CharField(max_length=50, blank=True, verbose_name='柜号')
    seal_number = models.CharField(max_length=50, blank=True, verbose_name='封条号')
    container_weight = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True, verbose_name='柜重')
    main_factory = models.CharField(max_length=100, blank=True, verbose_name='主要工厂')
    customs_broker = models.CharField(max_length=200, blank=True, verbose_name='报关行')
    delivery_address = models.CharField(max_length=500, blank=True, verbose_name='送货地址')
    special_requirements = models.TextField(blank=True, verbose_name='特殊要求')
    remarks = models.TextField(blank=True, verbose_name='备注')
    warehouse = models.CharField(max_length=200, blank=True, verbose_name='仓库')
    customs_cutoff = models.DateTimeField(null=True, blank=True, verbose_name='报关截止时间')
    source_email_id = models.CharField(max_length=100, blank=True, verbose_name='来源邮件ID')
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, verbose_name='创建人')
    created_at = models.DateTimeField(auto_now_add=True, verbose_name='创建时间')

    class Meta:
        verbose_name = '出货单'
        verbose_name_plural = '出货单'
        ordering = ['-created_at']

    def __str__(self):
        return f'{self.customer} - {self.so_number or self.id}'


class ShipmentItem(models.Model):
    """出货明细模型"""
    shipment = models.ForeignKey(Shipment, on_delete=models.CASCADE, related_name='items', verbose_name='出货单')
    factory_remark = models.CharField(max_length=200, blank=True, verbose_name='工厂备注')
    seq_number = models.IntegerField(default=0, verbose_name='序号')
    trading_company = models.CharField(max_length=200, blank=True, verbose_name='贸易公司')
    contract_number = models.CharField(max_length=100, blank=True, verbose_name='合同号')
    product_code = models.CharField(max_length=100, blank=True, verbose_name='产品代码')
    product_name = models.CharField(max_length=200, blank=True, verbose_name='产品名称')
    spec = models.CharField(max_length=200, blank=True, verbose_name='规格')
    country = models.CharField(max_length=100, blank=True, verbose_name='国家')
    toy_category = models.CharField(max_length=200, blank=True, verbose_name='玩具类别')
    quantity = models.IntegerField(null=True, blank=True, verbose_name='数量')
    pieces = models.IntegerField(null=True, blank=True, verbose_name='件数')
    gross_weight_per_box = models.DecimalField(max_digits=10, decimal_places=3, null=True, blank=True, verbose_name='每箱毛重(kg)')
    net_weight_per_box = models.DecimalField(max_digits=10, decimal_places=3, null=True, blank=True, verbose_name='每箱净重(kg)')
    gross_weight = models.DecimalField(max_digits=10, decimal_places=3, null=True, blank=True, verbose_name='总毛重(kg)')
    net_weight = models.DecimalField(max_digits=10, decimal_places=3, null=True, blank=True, verbose_name='总净重(kg)')
    volume = models.DecimalField(max_digits=10, decimal_places=4, null=True, blank=True, verbose_name='体积(CBM)')
    customer_po = models.CharField(max_length=100, blank=True, verbose_name='客户PO')
    customer_po_item_no = models.CharField(max_length=50, blank=True, verbose_name='客户PO项号')
    total_pieces_per_order = models.IntegerField(null=True, blank=True, verbose_name='订单总件数')
    brand = models.CharField(max_length=100, blank=True, verbose_name='品牌')
    pallet_count = models.IntegerField(null=True, blank=True, verbose_name='栈板数')
    box_dimensions = models.CharField(max_length=100, blank=True, verbose_name='箱规')

    class Meta:
        verbose_name = '出货明细'
        verbose_name_plural = '出货明细'
        ordering = ['seq_number']

    def __str__(self):
        return f'{self.product_code} - {self.product_name}'

    def save(self, *args, **kwargs):
        if self.pieces is not None:
            gw, nw = calculate_weights(self.pieces, self.gross_weight_per_box, self.net_weight_per_box)
            if gw is not None:
                self.gross_weight = gw
            if nw is not None:
                self.net_weight = nw
        super().save(*args, **kwargs)


class BillOfLadingRecord(models.Model):
    """提单记录 — 找提单/核对提单功能保存的匹配记录"""
    file_name = models.CharField(max_length=200, verbose_name='文件名')  # "XX车 XX柜"
    shipment = models.ForeignKey(
        Shipment, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='bl_records', verbose_name='关联出货单'
    )
    email_subject = models.CharField(max_length=500, blank=True, verbose_name='邮件主题')
    items_snapshot = models.JSONField(default=list, verbose_name='明细快照')
    total_cbm = models.DecimalField(max_digits=10, decimal_places=3, null=True, blank=True, verbose_name='总CBM')
    total_pieces = models.IntegerField(null=True, blank=True, verbose_name='总件数')
    verified = models.BooleanField(default=False, verbose_name='已核对')
    verify_discrepancies = models.JSONField(null=True, blank=True, verbose_name='核对差异')
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
        null=True, blank=True, verbose_name='创建人'
    )
    created_at = models.DateTimeField(auto_now_add=True, verbose_name='创建时间')

    class Meta:
        verbose_name = '提单记录'
        verbose_name_plural = '提单记录'
        ordering = ['-created_at']

    def __str__(self):
        return self.file_name


class QCInspection(models.Model):
    """QC验货记录"""

    class Result(models.TextChoices):
        PASS = 'pass', '通过'
        FAIL = 'fail', '不通过'
        PARTIAL = 'partial', '部分通过'

    shipment = models.ForeignKey(
        Shipment, on_delete=models.CASCADE,
        related_name='qc_inspections', verbose_name='出货单'
    )
    inspector = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT,
        related_name='qc_inspections', verbose_name='验货人'
    )
    result = models.CharField(max_length=10, choices=Result.choices, verbose_name='验货结果')
    notes = models.TextField(blank=True, verbose_name='备注')
    created_at = models.DateTimeField(auto_now_add=True, verbose_name='验货时间')
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = 'QC验货记录'
        verbose_name_plural = 'QC验货记录'
        ordering = ['-created_at']

    def __str__(self):
        return f'{self.shipment} - {self.get_result_display()}'


class QCPhoto(models.Model):
    """QC验货照片"""
    inspection = models.ForeignKey(
        QCInspection, on_delete=models.CASCADE,
        related_name='photos', verbose_name='验货记录'
    )
    image = models.ImageField(upload_to='qc_photos/%Y%m/', verbose_name='照片')
    uploaded_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = 'QC照片'
        verbose_name_plural = 'QC照片'


class Notification(models.Model):
    """站内通知"""

    class Type(models.TextChoices):
        STATUS_CHANGE = 'status_change', '状态变更'
        QC_RESULT = 'qc_result', 'QC结果'

    recipient = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE,
        related_name='notifications', verbose_name='接收人'
    )
    shipment = models.ForeignKey(
        Shipment, on_delete=models.CASCADE,
        null=True, blank=True, related_name='notifications', verbose_name='关联出货单'
    )
    type = models.CharField(max_length=20, choices=Type.choices, verbose_name='通知类型')
    message = models.CharField(max_length=500, verbose_name='消息')
    is_read = models.BooleanField(default=False, verbose_name='已读')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = '通知'
        verbose_name_plural = '通知'
        ordering = ['-created_at']


class ShipmentSubItem(models.Model):
    """混合装子行 - 一个货号包含多种不同产品"""
    parent_item = models.ForeignKey(ShipmentItem, on_delete=models.CASCADE, related_name='sub_items', verbose_name='父明细')
    product_name = models.CharField(max_length=200, blank=True, default='', verbose_name='产品名称')
    quantity = models.IntegerField(default=0, verbose_name='数量')
    spec = models.CharField(max_length=200, blank=True, default='', verbose_name='规格')
    toy_category = models.CharField(max_length=200, blank=True, default='', verbose_name='玩具类别')
    country = models.CharField(max_length=100, blank=True, default='', verbose_name='国家')
    pieces = models.IntegerField(default=0, verbose_name='件数')
    volume = models.DecimalField(max_digits=10, decimal_places=4, null=True, blank=True, verbose_name='体积(CBM)')
    order_index = models.IntegerField(default=0, verbose_name='排序')

    class Meta:
        verbose_name = '混合装子行'
        verbose_name_plural = '混合装子行'
        ordering = ['order_index']

    def __str__(self):
        return f'{self.parent_item.product_code} - {self.product_name}'
