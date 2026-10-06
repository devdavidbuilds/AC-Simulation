import json
from datetime import timedelta
from django.shortcuts import render
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from .models import RefrigerationTelemetry


def refrigerator_dashboard(request):
    """
    Serve the Industrial Refrigeration HMI dashboard.
    """
    context = {
        'plant_name': 'Cold Storage Zone 01',
        'unit_name': 'Refrigeration Unit',
        'unit_tag': 'FRG-001',
    }
    return render(request, 'refrigerator/index.html', context)


def refrigeration_cycle_page(request):
    """
    Serve the Refrigeration Cycle Simulation page (Page 2).
    Completely separate from the AHU page.
    """
    context = {
        'plant_name': 'Cold Storage Zone 01',
        'unit_name': 'Refrigeration Unit',
        'unit_tag': 'FRG-001',
    }
    return render(request, 'refrigerator/refrigeration.html', context)


def ahu_controls_page(request):
    """
    Serve the AHU Controls & Monitoring page (Page 2).
    Dedicated controls and monitoring view.
    """
    context = {
        'plant_name': 'Cold Storage Zone 01',
        'unit_name': 'Refrigeration Unit',
        'unit_tag': 'FRG-001',
    }
    return render(request, 'refrigerator/controls.html', context)


@csrf_exempt
@require_http_methods(["POST"])
def save_telemetry(request):
    """
    POST /api/telemetry/save/
    Store live refrigeration cycle performance record in PostgreSQL.
    Called every 5 seconds during LIVE MODE.
    """
    try:
        data = json.loads(request.body.decode('utf-8'))
        
        # Parse timestamp if provided, else use current time
        ts = None
        if data.get('timestamp'):
            ts = parse_datetime(data['timestamp'])
        if not ts:
            ts = timezone.now()

        record = RefrigerationTelemetry.objects.create(
            timestamp=ts,
            suction_pressure=float(data.get('suction_pressure', 1.0)),
            discharge_pressure=float(data.get('discharge_pressure', 1.0)),
            discharge_temperature=float(data.get('discharge_temperature', data.get('discharge_temp', 24.0))),
            condenser_outlet_temp=float(data.get('condenser_outlet_temp', 24.0)),
            evaporator_inlet_temp=float(data.get('evaporator_inlet_temp', 24.0)),
            evaporator_outlet_temp=float(data.get('evaporator_outlet_temp', 24.0)),
            compressor_status=str(data.get('compressor_status', 'OFF')),
            condenser_fan_status=str(data.get('condenser_fan_status', 'IDLE')),
            evaporator_fan_status=str(data.get('evaporator_fan_status', 'IDLE')),
            system_status=str(data.get('system_status', 'STOPPED')),
            fault_type=data.get('fault_type', 'None') or 'None',
            valve_opening=float(data.get('valve_opening', 60.0)),
            damper_position=float(data.get('damper_position', 70.0)),
            fan_on=bool(data.get('fan_on', False)),
            vfd_frequency=float(data.get('vfd_frequency', 40.0)),
            vav_position=float(data.get('vav_position', 70.0)),
            airflow_cfm=float(data.get('airflow_cfm', 0.0)),
            supply_air_temperature=float(data.get('supply_air_temperature', 24.0)),
            return_air_temperature=float(data.get('return_air_temperature', 24.0)),
            supply_static_pressure=float(data.get('supply_static_pressure', 0.0)),
            set_temperature=float(data.get('set_temperature', 22.0)),
        )

        return JsonResponse({
            'status': 'ok',
            'id': record.id,
            'timestamp': record.timestamp.isoformat(),
            'message': 'Telemetry record saved successfully.',
        }, status=201)

    except (ValueError, KeyError, TypeError, json.JSONDecodeError) as e:
        return JsonResponse({
            'status': 'error',
            'message': f'Invalid telemetry data: {str(e)}',
        }, status=400)
    except Exception as e:
        return JsonResponse({
            'status': 'error',
            'message': f'Database error: {str(e)}',
        }, status=500)


@require_http_methods(["GET"])
def get_telemetry_history(request):
    """
    GET /api/telemetry/history/
    Retrieve historical telemetry records from PostgreSQL for a given time range / duration.
    Query parameters:
      - start_time: ISO string (e.g. 2026-09-20T10:00:00)
      - end_time: ISO string (optional)
      - duration_seconds: Integer seconds (optional if end_time not given)
      - duration_minutes: Integer minutes (optional if end_time not given)
      - limit: Max records to return (default 5000)
    """
    try:
        start_str = request.GET.get('start_time')
        end_str = request.GET.get('end_time')
        duration_sec = request.GET.get('duration_seconds')
        duration_min = request.GET.get('duration_minutes')
        limit = int(request.GET.get('limit', 5000))

        qs = RefrigerationTelemetry.objects.all()

        if start_str:
            start_dt = parse_datetime(start_str)
            if start_dt:
                if timezone.is_naive(start_dt):
                    start_dt = timezone.make_aware(start_dt)
                qs = qs.filter(timestamp__gte=start_dt)

                if end_str:
                    end_dt = parse_datetime(end_str)
                    if end_dt:
                        if timezone.is_naive(end_dt):
                            end_dt = timezone.make_aware(end_dt)
                        qs = qs.filter(timestamp__lte=end_dt)
                elif duration_sec:
                    end_dt = start_dt + timedelta(seconds=float(duration_sec))
                    qs = qs.filter(timestamp__lte=end_dt)
                elif duration_min:
                    end_dt = start_dt + timedelta(minutes=float(duration_min))
                    qs = qs.filter(timestamp__lte=end_dt)
        else:
            # If no start_time specified, default to latest 100 records or last 30 minutes
            if end_str:
                end_dt = parse_datetime(end_str)
                if end_dt:
                    if timezone.is_naive(end_dt):
                        end_dt = timezone.make_aware(end_dt)
                    qs = qs.filter(timestamp__lte=end_dt)

        # Order chronologically for smooth simulation playback
        records = list(qs.order_by('timestamp')[:limit])

        return JsonResponse({
            'status': 'ok',
            'count': len(records),
            'records': [rec.to_dict() for rec in records],
        })

    except Exception as e:
        return JsonResponse({
            'status': 'error',
            'message': f'Failed to retrieve telemetry history: {str(e)}',
        }, status=500)


@require_http_methods(["GET"])
def get_telemetry_range_info(request):
    """
    GET /api/telemetry/range-info/
    Returns summary metadata about available recorded telemetry in PostgreSQL.
    """
    try:
        total_count = RefrigerationTelemetry.objects.count()
        earliest = RefrigerationTelemetry.objects.order_by('timestamp').first()
        latest = RefrigerationTelemetry.objects.order_by('-timestamp').first()

        return JsonResponse({
            'status': 'ok',
            'total_records': total_count,
            'earliest_timestamp': earliest.timestamp.isoformat() if earliest else None,
            'latest_timestamp': latest.timestamp.isoformat() if latest else None,
            'latest_record': latest.to_dict() if latest else None,
        })
    except Exception as e:
        return JsonResponse({
            'status': 'error',
            'message': f'Failed to get range info: {str(e)}',
        }, status=500)

