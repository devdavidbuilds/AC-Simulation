from django.urls import path

from . import views

app_name = 'refrigerator'

urlpatterns = [
    path('', views.refrigerator_dashboard, name='dashboard'),
    path('refrigeration/', views.refrigeration_cycle_page, name='refrigeration'),
    path('api/telemetry/save/', views.save_telemetry, name='save_telemetry'),
    path('api/telemetry/history/', views.get_telemetry_history, name='telemetry_history'),
    path('api/telemetry/range-info/', views.get_telemetry_range_info, name='telemetry_range_info'),
]
