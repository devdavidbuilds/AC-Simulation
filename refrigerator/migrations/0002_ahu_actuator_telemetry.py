from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("refrigerator", "0001_initial"),
    ]

    operations = [
        migrations.AddField(model_name="refrigerationtelemetry", name="valve_opening", field=models.FloatField(default=60.0, help_text="Cooling valve opening command in percent")),
        migrations.AddField(model_name="refrigerationtelemetry", name="damper_position", field=models.FloatField(default=70.0, help_text="Supply damper position in percent")),
        migrations.AddField(model_name="refrigerationtelemetry", name="fan_on", field=models.BooleanField(default=False, help_text="Supply fan command state")),
        migrations.AddField(model_name="refrigerationtelemetry", name="vfd_frequency", field=models.FloatField(default=40.0, help_text="Supply fan VFD frequency in Hz")),
        migrations.AddField(model_name="refrigerationtelemetry", name="vav_position", field=models.FloatField(default=70.0, help_text="VAV outdoor/return mixing position in percent")),
        migrations.AddField(model_name="refrigerationtelemetry", name="airflow_cfm", field=models.FloatField(default=0.0, help_text="Supply airflow in CFM")),
        migrations.AddField(model_name="refrigerationtelemetry", name="supply_air_temperature", field=models.FloatField(default=24.0, help_text="Supply air temperature in Celsius")),
        migrations.AddField(model_name="refrigerationtelemetry", name="return_air_temperature", field=models.FloatField(default=24.0, help_text="Return air temperature in Celsius")),
        migrations.AddField(model_name="refrigerationtelemetry", name="supply_static_pressure", field=models.FloatField(default=0.0, help_text="Supply air static pressure in Pa")),
        migrations.AddField(model_name="refrigerationtelemetry", name="set_temperature", field=models.FloatField(default=22.0, help_text="Supply air temperature setpoint in Celsius")),
    ]
