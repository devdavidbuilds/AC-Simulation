from django.contrib import admin
from .models import RefrigerationTelemetry


@admin.register(RefrigerationTelemetry)
class RefrigerationTelemetryAdmin(admin.ModelAdmin):
    list_display = (
        'timestamp',
        'system_status',
        'compressor_status',
        'suction_pressure',
        'discharge_pressure',
        'discharge_temperature',
        'condenser_outlet_temp',
        'evaporator_inlet_temp',
        'evaporator_outlet_temp',
        'fault_type',
    )
    list_filter = ('system_status', 'compressor_status', 'fault_type')
    ordering = ('-timestamp',)
