#!/usr/bin/python
from __future__ import print_function
import json
import math
import os
import subprocess
import sys
import tempfile
import time

# MET Norway Locationforecast, CC BY 4.0. Cache outside Nordic region for 3 hours.
# https://api.met.no/weatherapi/locationforecast/2.0/documentation
base = '/var/lib/webosbrew/hearth-boot-audio'
lat, lon = float(sys.argv[1]), float(sys.argv[2])
if math.isnan(lat) or math.isinf(lat) or math.isnan(lon) or math.isinf(lon) or abs(lat) > 90 or abs(lon) > 180:
    raise ValueError('Invalid weather coordinates')
folder = base + '/weather-cache'
if not os.path.isdir(folder):
    os.makedirs(folder, int('700', 8))
name = folder + '/%.4f-%.4f.json' % (lat, lon)
data = None
try:
    age = time.time() - os.path.getmtime(name)
    if 0 <= age < 10800:
        with open(name, 'rb') as handle:
            data = handle.read()
        if not json.loads(data).get('properties', {}).get('timeseries'):
            data = None
except (IOError, OSError, ValueError):
    data = None
if data is None:
    url = 'https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=%.4f&lon=%.4f' % (lat, lon)
    data = subprocess.check_output([
        '/usr/bin/curl', '-fsS', '--connect-timeout', '4', '--max-time', '10',
        '--cacert', base + '/weather-ca.crt', '-A', 'WebOSHomeWeather', url
    ])
    if len(data) > 131072 or not json.loads(data).get('properties', {}).get('timeseries'):
        raise ValueError('Invalid weather response')
    handle = tempfile.NamedTemporaryFile(dir=folder, delete=False)
    try:
        handle.write(data)
        handle.flush()
        os.fsync(handle.fileno())
        handle.close()
        os.chmod(handle.name, int('600', 8))
        os.rename(handle.name, name)
    finally:
        if os.path.exists(handle.name):
            os.unlink(handle.name)
sys.stdout.write(data.decode('utf-8'))
