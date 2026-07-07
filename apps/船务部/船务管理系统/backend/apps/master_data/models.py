from django.db import models


class Customer(models.Model):
    """客户模型 - 7个固定客户"""
    name = models.CharField(max_length=100, unique=True, verbose_name='客户名称')
    consignee = models.CharField(max_length=200, blank=True, default='', verbose_name='收货人')
    consignee_code = models.CharField(max_length=50, blank=True, default='', verbose_name='收货人代码')
    schedule_path = models.CharField(max_length=500, blank=True, default='', verbose_name='排期路径')
    template_config = models.JSONField(default=dict, blank=True, verbose_name='模板配置')
    is_brand_auto = models.BooleanField(default=False, verbose_name='是否自动匹配品牌')
    cabinet_seq = models.IntegerField(default=1000, verbose_name='柜号序列（当前值）')

    class Meta:
        verbose_name = '客户'
        verbose_name_plural = '客户'

    def next_cabinet_number(self):
        """获取下一个柜号并自增。仅限柜类型使用。"""
        self.cabinet_seq += 1
        self.save(update_fields=['cabinet_seq'])
        return self.cabinet_seq
        ordering = ['name']

    def __str__(self):
        return self.name


class TransportCompany(models.Model):
    """运输公司模型"""
    name = models.CharField(max_length=200, verbose_name='公司名称')
    short_name = models.CharField(max_length=50, verbose_name='简称')
    contact = models.CharField(max_length=100, blank=True, default='', verbose_name='联系人')
    phone = models.CharField(max_length=50, blank=True, default='', verbose_name='联系电话')

    class Meta:
        verbose_name = '运输公司'
        verbose_name_plural = '运输公司'
        ordering = ['short_name']

    def __str__(self):
        return self.short_name


class FactoryMapping(models.Model):
    """工厂映射 - 英文名到中文简称"""
    english_name = models.CharField(max_length=300, unique=True, verbose_name='英文名称')
    chinese_short_name = models.CharField(max_length=50, verbose_name='中文简称')
    is_local = models.BooleanField(default=True, verbose_name='是否本地工厂')

    class Meta:
        verbose_name = '工厂映射'
        verbose_name_plural = '工厂映射'
        ordering = ['chinese_short_name']

    def __str__(self):
        return f'{self.english_name} -> {self.chinese_short_name}'


class ProductMapping(models.Model):
    """货号映射 - 产品代码到名称和重量"""
    product_code = models.CharField(max_length=100, verbose_name='产品代码')
    product_name = models.CharField(max_length=200, blank=True, default='', verbose_name='产品名称')
    toy_category = models.CharField(max_length=200, blank=True, default='', verbose_name='玩具类别')
    gross_weight_per_box = models.DecimalField(max_digits=10, decimal_places=3, null=True, blank=True, verbose_name='每箱毛重(kg)')
    net_weight_per_box = models.DecimalField(max_digits=10, decimal_places=3, null=True, blank=True, verbose_name='每箱净重(kg)')
    factory_short = models.CharField(max_length=50, blank=True, default='', verbose_name='做货工厂')
    source = models.CharField(max_length=100, blank=True, default='', verbose_name='数据来源')
    customer_name = models.CharField(max_length=50, blank=True, default='', verbose_name='客户名称')
    qty_per_box = models.IntegerField(null=True, blank=True, verbose_name='每箱个数')

    class Meta:
        verbose_name = '货号映射'
        verbose_name_plural = '货号映射'
        ordering = ['customer_name', 'product_code']
        unique_together = ['product_code', 'customer_name', 'qty_per_box']
        indexes = [
            models.Index(fields=['customer_name']),
            models.Index(fields=['product_code']),
            models.Index(fields=['customer_name', 'product_code']),
        ]

    def __str__(self):
        return f'{self.product_code} - {self.product_name}'


class DestinationPortMapping(models.Model):
    """目的港/交货地 → 中文国家名 动态映射表"""
    port_name = models.CharField(max_length=200, unique=True, verbose_name='原始目的港文本')
    country_cn = models.CharField(max_length=50, verbose_name='中文国家名')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = '目的港映射'
        verbose_name_plural = '目的港映射'

    def __str__(self):
        return f'{self.port_name} → {self.country_cn}'
