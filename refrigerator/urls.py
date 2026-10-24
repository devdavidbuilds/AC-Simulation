from django.urls import path

from . import views

app_name = 'refrigerator'

urlpatterns = [
    path('', views.refrigerator_dashboard, name='dashboard'),
    path('ahu/live/', views.ahu_live_page, name='ahu_live'),
    path('refrigeration/', views.refrigeration_cycle_page, name='refrigeration'),
    path('refrigerator/', views.refrigeration_cycle_page, name='refrigerator_alias'),
    path('refrigeration/live/', views.refrigeration_live_page, name='refrigeration_live'),
    path('refrigerator/live/', views.refrigeration_live_page, name='refrigerator_live_alias'),
    path('api/telemetry/save/', views.save_telemetry, name='save_telemetry'),
    path('api/telemetry/history/', views.get_telemetry_history, name='telemetry_history'),
    path('api/telemetry/range-info/', views.get_telemetry_range_info, name='telemetry_range_info'),
]
