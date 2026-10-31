import json
from datetime import timedelta
from django.shortcuts import render
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from .models import RefrigerationTelemetry


def _page_context(page_mode, active_page):
    return {
        'plant_name': 'Cold Storage Zone 01',
        'unit_name': 'Refrigeration Unit',
        'unit_tag': 'FRG-001',
        'page_mode': page_mode,      # 'sim' or 'live'
        'active_page': active_page,  # 'ahu_sim' | 'ahu_live' | 'rf_sim' | 'rf_live'
    }


def refrigerator_dashboard(request):
    """Page 1: AHU / Air-Side Simulation."""
    return render(request, 'refrigerator/index.html', _page_context('sim', 'ahu_sim'))


def ahu_live_page(request):
    """Page 2: AHU / Air-Side Live Mode (live feed from PostgreSQL + replay)."""
    return render(request, 'refrigerator/index.html', _page_context('live', 'ahu_live'))


def refrigeration_cycle_page(request):
    """Page 3: Refrigeration Cycle Simulation."""
    return render(request, 'refrigerator/refrigeration.html', _page_context('sim', 'rf_sim'))


def refrigeration_live_page(request):
    """Page 4: Refrigeration Cycle Live Mode (live feed from PostgreSQL + replay)."""
    return render(request, 'refrigerator/refrigeration.html', _page_context('live', 'rf_live'))


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
            water_evaporator=float(data.get('water_evaporator', 7.0)),
            water_evaporator_inlet=float(data.get('water_evaporator_inlet', 12.0)),
            water_evaporator_outlet=float(data.get('water_evaporator_outlet', 7.0)),
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


THINGSPEAK_CHANNEL_ID = "3560538"
THINGSPEAK_READ_KEY = "04X2RNIITIQ0F0JC"


@require_http_methods(["GET"])
def get_thingspeak_telemetry(request):
    """
    GET /api/telemetry/thingspeak/
    Fetches the latest live reading from the ESP32-S3 ThingSpeak channel (3560538),
    maps the 4 Thermocouple + DHT22 sensors to the AHU / Refrigeration telemetry schema,
    saves the record to PostgreSQL, and returns the real-time telemetry payload.
    """
    import urllib.request
    import urllib.error

    url = f"https://api.thingspeak.com/channels/{THINGSPEAK_CHANNEL_ID}/feeds/last.json?api_key={THINGSPEAK_READ_KEY}"
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read().decode('utf-8'))

        if not data or data == -1:
            return JsonResponse({
                'status': 'waiting',
                'channel_id': THINGSPEAK_CHANNEL_ID,
                'message': f'ThingSpeak channel #{THINGSPEAK_CHANNEL_ID} connected. Awaiting initial upload from ESP32.',
                'telemetry': None
            })

        # Robust Sensor Value Parser (Returns None if disconnected/empty/NaN/-127)
        def parse_sensor_val(raw, min_v=-50.0, max_v=5000.0):
            if raw is None:
                return None
            s = str(raw).strip().lower()
            if s in ("", "null", "nan", "none", "-127", "-127.0", "ovf"):
                return None
            try:
                v = float(s)
                if v < min_v or v > max_v:
                    return None
                return v
            except (ValueError, TypeError):
                return None

        # Channel 3560538 Fields (ESP32 Temperature Monitoring System):
        # Field 1: Thermocouple 1 (°C) -> Compressor Discharge Temp / Condenser Inlet Temp
        # Field 2: Thermocouple 2 (°C) -> Condenser Outlet Temp / Expansion Valve Inlet Temp
        # Field 3: Thermocouple 3 (°C) -> Expansion Valve Outlet Temp / Evaporator Inlet Temp
        # Field 4: Thermocouple 4 (°C) -> Evaporator Outlet Temp / Compressor Suction Temp
        # Field 5: DHT22 Temperature (°C) -> Ambient / Return Air Temp
        # Field 6: DHT22 Humidity (%) -> Ambient / Return Air RH
        tc1 = parse_sensor_val(data.get('field1'), -50.0, 1370.0)
        tc2 = parse_sensor_val(data.get('field2'), -50.0, 1370.0)
        tc3 = parse_sensor_val(data.get('field3'), -50.0, 1370.0)
        tc4 = parse_sensor_val(data.get('field4'), -50.0, 1370.0)
        dht_temp = parse_sensor_val(data.get('field5'), -40.0, 120.0)
        dht_humidity = parse_sensor_val(data.get('field6'), 0.0, 100.0)

        sensor_connected = any(v is not None for v in (tc1, tc2, tc3, tc4, dht_temp))

        # Sensor readings with realistic engineering defaults if any individual probe is disconnected
        t_discharge = round(tc1, 1) if tc1 is not None else 41.2
        t_cond_out = round(tc2, 1) if tc2 is not None else 31.2
        t_evap_in = round(tc3, 1) if tc3 is not None else 16.2
        t_evap_out = round(tc4, 1) if tc4 is not None else 26.2
        t_ambient = round(dht_temp, 1) if dht_temp is not None else 28.8
        rh_ambient = round(dht_humidity, 1) if dht_humidity is not None else 86.0

        # Normal thermodynamic operating pressures for R134a refrigeration cycle
        press_bar = 10.5
        suction_p = 1.5
        duct_static_pa = 75.0 if sensor_connected else 0.0

        created_at_str = data.get('created_at')
        entry_id = data.get('entry_id')

        ts = parse_datetime(created_at_str) if created_at_str else timezone.now()
        if not ts:
            ts = timezone.now()

        # Check if record with this timestamp already exists to prevent duplicate entries
        payload = None
        try:
            record = RefrigerationTelemetry.objects.filter(timestamp=ts).first()
            if not record:
                record = RefrigerationTelemetry.objects.create(
                    timestamp=ts,
                    suction_pressure=suction_p,
                    discharge_pressure=press_bar,
                    discharge_temperature=t_discharge if sensor_connected else 24.0,
                    condenser_outlet_temp=t_cond_out if sensor_connected else 24.0,
                    evaporator_inlet_temp=t_evap_in if sensor_connected else 24.0,
                    evaporator_outlet_temp=t_evap_out if sensor_connected else 24.0,
                    water_evaporator=round(max(6.0, t_evap_in - 2.0), 1) if sensor_connected else 14.2,
                    water_evaporator_inlet=round(max(10.0, t_evap_out - 7.0), 1) if sensor_connected else 19.2,
                    water_evaporator_outlet=round(max(6.0, t_evap_in - 2.0), 1) if sensor_connected else 14.2,
                    compressor_status="RUNNING" if sensor_connected else "STANDBY",
                    condenser_fan_status="ACTIVE" if sensor_connected else "IDLE",
                    evaporator_fan_status="ACTIVE" if sensor_connected else "IDLE",
                    system_status="RUNNING" if sensor_connected else "SENSOR_DISCONNECTED",
                    fault_type="None" if sensor_connected else "Temperature Sensor Disconnected",
                    valve_opening=60.0,
                    damper_position=70.0,
                    fan_on=sensor_connected,
                    vfd_frequency=45.0 if sensor_connected else 0.0,
                    vav_position=70.0,
                    airflow_cfm=850.0 if sensor_connected else 0.0,
                    supply_air_temperature=t_evap_out if sensor_connected else 24.0,
                    return_air_temperature=t_ambient if sensor_connected else 24.0,
                    supply_static_pressure=round(duct_static_pa, 1),
                    set_temperature=22.0,
                )
            payload = record.to_dict()
        except Exception as db_err:
            payload = {
                "id": entry_id or 0,
                "timestamp": ts.isoformat(),
                "time_display": ts.strftime("%H:%M:%S"),
                "date_display": ts.strftime("%Y-%m-%d"),
                "suction_pressure": suction_p,
                "discharge_pressure": press_bar,
                "discharge_temperature": t_discharge if sensor_connected else None,
                "condenser_outlet_temp": t_cond_out if sensor_connected else None,
                "evaporator_inlet_temp": t_evap_in if sensor_connected else None,
                "evaporator_outlet_temp": t_evap_out if sensor_connected else None,
                "water_evaporator": 14.2,
                "water_evaporator_inlet": 19.2,
                "water_evaporator_outlet": 14.2,
                "compressor_status": "RUNNING" if sensor_connected else "STANDBY",
                "condenser_fan_status": "ACTIVE" if sensor_connected else "IDLE",
                "evaporator_fan_status": "ACTIVE" if sensor_connected else "IDLE",
                "system_status": "RUNNING" if sensor_connected else "SENSOR_DISCONNECTED",
                "fault_type": "None" if sensor_connected else "Temperature Sensor Disconnected",
                "valve_opening": 60.0,
                "damper_position": 70.0,
                "fan_on": sensor_connected,
                "vfd_frequency": 45.0 if sensor_connected else 0.0,
                "vav_position": 70.0,
                "airflow_cfm": 850.0 if sensor_connected else 0.0,
                "supply_air_temperature": t_evap_out if sensor_connected else None,
                "return_air_temperature": t_ambient if sensor_connected else None,
                "supply_static_pressure": round(duct_static_pa, 1),
                "set_temperature": 22.0,
                "db_status": f"Warning: DB sync skipped ({str(db_err)})",
            }

        payload['supply_air_temperature'] = t_evap_out if sensor_connected else None
        payload['return_air_temperature'] = t_ambient if sensor_connected else None
        payload['discharge_temperature'] = t_discharge if sensor_connected else None
        payload['condenser_outlet_temp'] = t_cond_out if sensor_connected else None
        payload['evaporator_inlet_temp'] = t_evap_in if sensor_connected else None
        payload['evaporator_outlet_temp'] = t_evap_out if sensor_connected else None
        payload['water_evaporator_inlet'] = 19.2
        payload['water_evaporator_outlet'] = 14.2
        payload['water_evaporator'] = 14.2
        payload['discharge_pressure'] = press_bar
        payload['suction_pressure'] = suction_p
        payload['dht_temp'] = t_ambient
        payload['dht_humidity'] = rh_ambient
        payload['field1_tc1'] = tc1
        payload['field2_tc2'] = tc2
        payload['field3_tc3'] = tc3
        payload['field4_tc4'] = tc4
        payload['field5'] = t_ambient
        payload['sensor_connected'] = sensor_connected
        payload['thingspeak_entry_id'] = entry_id
        payload['hardware_source'] = f"ESP32-S3 (ThingSpeak #{THINGSPEAK_CHANNEL_ID})"

        return JsonResponse({
            'status': 'ok',
            'entry_id': entry_id,
            'created_at': created_at_str,
            'telemetry': payload,
        })

    except urllib.error.URLError as e:
        return JsonResponse({'status': 'error', 'message': f'ThingSpeak network error: {str(e)}'}, status=502)
    except Exception as e:
        return JsonResponse({'status': 'error', 'message': f'ThingSpeak processing error: {str(e)}'}, status=500)
