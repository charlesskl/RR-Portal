from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('master_data', '0006_add_factory_short_to_productmapping'),
    ]

    operations = [
        migrations.AddField(
            model_name='productmapping',
            name='qty_per_box',
            field=models.IntegerField(blank=True, null=True, verbose_name='每箱个数'),
        ),
        migrations.AlterUniqueTogether(
            name='productmapping',
            unique_together={('product_code', 'customer_name', 'qty_per_box')},
        ),
    ]
