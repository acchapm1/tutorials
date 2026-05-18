---
title: "MicroPython on the TTGO T-Display — A Complete Reference"
date: 2026-04-27
difficulty: advanced
tags:
  - micropython
  - esp32
  - ttgo-t-display
  - iot
  - embedded
  - python
  - st7789
  - mqtt
  - deep-sleep
  - display
  - spi
  - i2c
---

# MicroPython on the TTGO T-Display — A Complete Reference

## Overview

This document is a comprehensive reference for building production-quality MicroPython projects on the TTGO T-Display (ESP32 + ST7789V 240×135 TFT). It covers every hardware peripheral on the board, display optimization techniques, networking patterns for IoT, memory management on a constrained device, and real-world project architecture.

Where the [[micropython-ttgo-t-display-beginner-guide|Beginner Guide]] walks you through setup and your first project, this reference assumes you have a working MicroPython environment and want to understand the hardware deeply, write performant code, and build reliable systems.

**Hardware reference:** TTGO T-Display V1.8, ESP32-D0WDQ6 rev1.0, 4MB flash, 520KB SRAM (~110KB usable by MicroPython), WiFi 802.11 b/g/n, Bluetooth 4.2, 240×135 ST7789V TFT, 2 buttons, battery ADC, I2C, SD card slot.

## Prerequisites

- A working MicroPython installation on the TTGO T-Display (see [[micropython-ttgo-t-display-beginner-guide|Beginner Guide]])
- Comfort with Python — classes, context managers, exception handling
- `esptool`, `mpremote` installed (in a [[dotfiles-deep-dive|properly managed virtual environment]])
- Familiarity with basic electronics concepts (voltage, digital/analog, SPI, I2C)

## Key Concepts

### ESP32 Architecture

The ESP32-D0WDQ6 in the TTGO T-Display has two Xtensa LX6 cores running at 240 MHz. MicroPython uses one core; the other handles WiFi/BLE. The 520KB of SRAM is split between the runtime, the MicroPython heap (where your objects live), and DMA buffers for peripherals like SPI. After the interpreter boots, you typically have ~100-110KB of free heap.

### SPI Bus Architecture

The ST7789V display communicates over SPI (Serial Peripheral Interface). The ESP32 has two usable hardware SPI buses: HSPI and VSPI. The display uses HSPI (SPI bus 1). Key concept: SPI speed directly determines how fast you can update the screen. The pure-Python driver maxes out around 26.6 MHz effective throughput, while the C driver reaches 40 MHz with DMA transfers.

### Memory Model

MicroPython uses a garbage-collected heap. Unlike CPython, there is no virtual memory — when the heap is full, you get `MemoryError`. Understanding allocation patterns is critical: every string concatenation, list append, or `format()` call creates objects on the heap. The `gc` module and `micropython.mem_info()` are your diagnostic tools.

### Firmware Layers

The binary you flash contains, from bottom to top: the ESP-IDF (Espressif's OS layer), the MicroPython virtual machine, frozen bytecode modules (built into the firmware image), and the filesystem (where your `.py` files live). Frozen modules load faster and use less RAM than files on the filesystem because they execute directly from flash.

## Step-by-Step Instructions

### 1. Choosing and Building Firmware

#### Generic Firmware

The standard MicroPython ESP32 firmware from micropython.org works on the TTGO T-Display but includes no display driver. You must copy a pure-Python ST7789 driver to the filesystem, which is slower and uses more RAM.

```bash
# Download latest stable
curl -LO https://micropython.org/resources/firmware/ESP32_GENERIC-20260101-v1.25.0.bin

# Flash (assumes port is set)
esptool --chip esp32 --port $PORT --baud 460800 write_flash -z 0x1000 ESP32_GENERIC-20260101-v1.25.0.bin
```

#### Russ Hughes Pre-Compiled Firmware (Recommended)

Russ Hughes publishes firmware with the ST7789 C driver compiled in as a frozen module. This is 3–5x faster for display operations and uses significantly less RAM than the pure-Python driver.

Repository: https://github.com/russhughes/st7789_mpy

```bash
# Download the pre-compiled .bin for generic ESP32
# Check the repo's firmware/ directory for the latest build
esptool --chip esp32 --port $PORT --baud 460800 write_flash -z 0x1000 firmware.bin
```

With this firmware, `import st7789` works out of the box — no file copy needed.

#### Building Custom Firmware with Frozen Modules

For production projects, you can freeze your own modules into firmware. This eliminates filesystem reads at boot and reduces RAM usage.

```bash
# Clone MicroPython source
git clone https://github.com/micropython/micropython.git
cd micropython

# Build the cross-compiler
make -C mpy-cross

# Set up ESP-IDF (Espressif's SDK)
cd ports/esp32
# Follow the README for installing ESP-IDF v5.x

# Add your modules to the freeze manifest
# Edit boards/manifest.py or create a custom board definition
# Add: freeze("$(PORT_DIR)/modules", "your_module.py")

make BOARD=ESP32_GENERIC submodules
make BOARD=ESP32_GENERIC
```

The resulting firmware is in `build-ESP32_GENERIC/firmware.bin`.

### 2. Complete TTGO T-Display Pin Reference

```
┌─────────────────────────────────────────────┐
│              TTGO T-Display                  │
│                                              │
│  Display (SPI — HSPI, Bus 1):                │
│    SCLK  = GPIO 18                           │
│    MOSI  = GPIO 19                           │
│    CS    = GPIO 5                             │
│    DC    = GPIO 16                            │
│    RST   = GPIO 23                            │
│    BL    = GPIO 4  (backlight, active HIGH)   │
│                                              │
│  Buttons:                                    │
│    BTN1  = GPIO 35 (left,  active LOW)        │
│    BTN2  = GPIO 0  (right, active LOW, BOOT) │
│                                              │
│  Battery:                                    │
│    ADC   = GPIO 34 (voltage divider output)   │
│    EN    = GPIO 14 (pull HIGH to enable ADC)  │
│                                              │
│  I2C (default):                              │
│    SDA   = GPIO 21                            │
│    SCL   = GPIO 22                            │
│                                              │
│  SD Card (secondary SPI):                    │
│    CS    = GPIO 33                            │
│    SCLK  = GPIO 25                            │
│    MISO  = GPIO 27                            │
│    MOSI  = GPIO 26                            │
│                                              │
│  USB Serial: CP2104 or CH9102                │
│    TX    = GPIO 1                             │
│    RX    = GPIO 3                             │
│                                              │
│  Free GPIOs (directly usable):               │
│    GPIO 2, 12, 13, 15, 17, 25, 26, 27, 32,  │
│    33 (if not using SD card)                  │
└─────────────────────────────────────────────┘
```

**Important notes:**

- GPIO 34–39 are **input-only** on ESP32 — they cannot be used as outputs
- GPIO 0 doubles as BOOT — pulling it LOW during reset enters bootloader mode
- GPIO 12 (MTDI) controls flash voltage at boot — driving it HIGH on boards with 3.3V flash can cause boot failure
- GPIO 2 must be LOW or floating during flash; safe to use afterward

### 3. Display Deep Dive

#### ST7789 Initialization

The critical initialization parameters for the TTGO T-Display's 240×135 panel:

```python
import st7789
from machine import Pin, SPI

# C driver initialization (with Russ Hughes firmware)
spi = SPI(1, baudrate=40000000, polarity=1, phase=0,
          sck=Pin(18), mosi=Pin(19), miso=Pin(-1))

tft = st7789.ST7789(
    spi,
    135,         # width (physical short side)
    240,         # height (physical long side)
    reset=Pin(23, Pin.OUT),
    cs=Pin(5, Pin.OUT),
    dc=Pin(16, Pin.OUT),
    backlight=Pin(4, Pin.OUT),
    rotation=1,  # Landscape: 0=portrait, 1=landscape, 2=inv portrait, 3=inv landscape
    color_order=st7789.BGR,  # ST7789 uses BGR natively
    custom_init=None,
    custom_rotations=None,
)
tft.init()
```

#### Display Offset Gotcha

The ST7789 controller addresses a 240×320 buffer internally, but the TTGO T-Display's panel is only 135×240 pixels. The visible area starts at an offset. When using `rotation=1` (landscape), the offset is handled by setting `tfa=40` (top fixed area) and `bfa=40` (bottom fixed area). Most maintained drivers handle this automatically, but if you see content shifted or clipped, this is the cause.

#### RGB565 Color Format

The display uses 16-bit color encoded as RGB565: 5 bits red, 6 bits green, 5 bits blue.

```python
def color565(r, g, b):
    """Convert 8-bit RGB to 16-bit RGB565."""
    return ((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3)

# Common colors
BLACK   = 0x0000
WHITE   = 0xFFFF
RED     = 0xF800
GREEN   = 0x07E0
BLUE    = 0x001F
YELLOW  = 0xFFE0
CYAN    = 0x07FF
MAGENTA = 0xF81F
```

#### Drawing Primitives

With the C driver:

```python
# Fill entire screen
tft.fill(color565(0, 0, 0))

# Draw a filled rectangle
tft.fill_rect(x, y, width, height, color)

# Draw a single pixel
tft.pixel(x, y, color)

# Draw horizontal/vertical lines (fast — single SPI transaction)
tft.hline(x, y, length, color)
tft.vline(x, y, length, color)

# Draw text with built-in 8x8 font
tft.text(font, "Hello", x, y, color)
# Or with foreground and background colors (faster — no read-back)
tft.text(font, "Hello", x, y, fg_color, bg_color)
```

#### Custom Bitmap Fonts

The C driver supports bitmap fonts compiled from TTF/OTF. Russ Hughes provides a `font2bitmap` tool:

```bash
# On your Mac — generate a frozen font module
python3 font2bitmap.py -f "Roboto-Regular.ttf" -s 16 roboto_16
```

This produces a `.py` file you can freeze into firmware or copy to the device:

```python
import roboto_16
tft.text(roboto_16, "Big text!", 10, 50, st7789.WHITE)
```

#### Flicker-Free Updates with Framebuffer

For animations or rapidly changing data, drawing directly to the display causes visible flicker. The solution is double-buffering using MicroPython's `framebuf` module:

```python
import framebuf

# Allocate a buffer for the full screen (135 * 240 * 2 bytes = 64,800 bytes)
# WARNING: This uses ~63KB of your ~110KB heap! Use partial buffers for complex apps.
buf = bytearray(135 * 240 * 2)
fb = framebuf.FrameBuffer(buf, 240, 135, framebuf.RGB565)

# Draw to the framebuffer (off-screen)
fb.fill(0x0000)
fb.text("Frame 1", 10, 60, 0xFFFF)
fb.rect(50, 20, 100, 80, 0xF800)

# Blit the entire buffer to the display in one SPI transaction
tft.blit_buffer(buf, 0, 0, 240, 135)
```

For memory-constrained situations, use partial buffers (e.g., update one 135×40 strip at a time).

#### Performance Comparison

| Method | Full Screen Fill | Text Rendering | Notes |
|--------|-----------------|----------------|-------|
| Pure Python driver @ 26 MHz | ~350ms | ~8ms/char | Simplest setup |
| C driver @ 40 MHz | ~45ms | ~1ms/char | Frozen in firmware |
| C driver + DMA @ 40 MHz | ~30ms | ~0.5ms/char | Non-blocking SPI |
| Framebuffer + blit | ~50ms blit | Instant (to buffer) | Flicker-free |

### 4. The `machine` Module — Hardware Interfaces

#### Pin Control

```python
from machine import Pin

# Digital output
led = Pin(2, Pin.OUT)
led.value(1)  # HIGH
led.value(0)  # LOW
led.on()      # Same as value(1)
led.off()     # Same as value(0)

# Digital input with internal pull-up
button = Pin(35, Pin.IN, Pin.PULL_UP)
print(button.value())  # 0 when pressed (active LOW)

# IRQ — interrupt on button press
def button_handler(pin):
    print(f"Button pressed! Pin: {pin}")

button.irq(trigger=Pin.IRQ_FALLING, handler=button_handler)
```

#### SPI

```python
from machine import SPI, Pin

# Hardware SPI (bus 1 = HSPI, bus 2 = VSPI)
spi = SPI(1,
    baudrate=10000000,  # 10 MHz
    polarity=0,
    phase=0,
    sck=Pin(18),
    mosi=Pin(19),
    miso=Pin(23)  # Specify explicitly even if unused (recent firmware change)
)

# Write bytes
spi.write(b'\x01\x02\x03')

# Read 5 bytes
data = spi.read(5)

# Write and read simultaneously
buf_out = b'\x00\x00\x00'
buf_in = bytearray(3)
spi.write_readinto(buf_out, buf_in)
```

**Gotcha:** Recent MicroPython firmware versions require you to specify the `miso` pin explicitly when initializing SPI, even if the peripheral is write-only (like a display). Pass `miso=Pin(-1)` to indicate no MISO pin.

#### I2C

```python
from machine import I2C, Pin

i2c = I2C(0, scl=Pin(22), sda=Pin(21), freq=400000)

# Scan for connected devices
devices = i2c.scan()
print(f"Found devices at: {[hex(d) for d in devices]}")

# Read from a sensor (e.g., BME280 at address 0x76)
data = i2c.readfrom_mem(0x76, 0xD0, 1)  # Read chip ID register
print(f"Chip ID: {hex(data[0])}")

# Write a configuration register
i2c.writeto_mem(0x76, 0xF4, b'\x27')  # Normal mode, oversampling x1
```

#### ADC (Analog-to-Digital Converter)

```python
from machine import ADC, Pin

# Battery voltage on TTGO T-Display
# MUST enable the voltage divider first
adc_enable = Pin(14, Pin.OUT, value=1)

adc = ADC(Pin(34))
adc.atten(ADC.ATTN_11DB)    # Full-scale range: ~0-3.6V
adc.width(ADC.WIDTH_12BIT)  # 0-4095 resolution

raw = adc.read()
voltage = (raw / 4095) * 3.6 * 2  # ×2 because voltage divider halves it

# For better accuracy, average multiple readings
def read_battery_avg(samples=10):
    total = 0
    for _ in range(samples):
        total += adc.read()
    raw_avg = total / samples
    return (raw_avg / 4095) * 3.6 * 2
```

**Gotcha:** The ESP32's ADC is notoriously noisy, especially on the original revision (non-S2/S3). WiFi operation increases noise significantly on ADC readings. For battery monitoring, take multiple samples and average. For precision analog work, use an external ADC (ADS1115 over I2C).

#### PWM (Pulse Width Modulation)

```python
from machine import Pin, PWM

# Control backlight brightness
backlight = PWM(Pin(4))
backlight.freq(1000)      # 1 kHz
backlight.duty(512)       # 50% brightness (0-1023)
backlight.duty(1023)      # Full brightness
backlight.duty(0)         # Off

# Produce a tone on a piezo buzzer (if connected)
buzzer = PWM(Pin(25))
buzzer.freq(440)          # A4 note
buzzer.duty(512)
import time
time.sleep(0.5)
buzzer.deinit()           # Stop
```

#### Timers

```python
from machine import Timer

# Periodic callback — runs every 5 seconds
def tick(timer):
    print("Timer fired!")

timer = Timer(0)  # Timer ID 0-3
timer.init(period=5000, mode=Timer.PERIODIC, callback=tick)

# One-shot timer
timer.init(period=10000, mode=Timer.ONE_SHOT, callback=tick)

# Stop a timer
timer.deinit()
```

#### RTC (Real-Time Clock)

```python
from machine import RTC

rtc = RTC()

# Set time manually: (year, month, day, weekday, hour, minute, second, microsecond)
rtc.datetime((2026, 4, 27, 0, 14, 30, 0, 0))

# Read current time
dt = rtc.datetime()
print(f"{dt[0]}-{dt[1]:02d}-{dt[2]:02d} {dt[4]:02d}:{dt[5]:02d}:{dt[6]:02d}")
```

The RTC loses its time on power cycle. Sync it from NTP after WiFi connects (see networking section).

#### Deep Sleep and Light Sleep

```python
import machine
import esp32

# ── Deep sleep ── (lowest power, ~10µA, resets on wake)

# Wake after 30 seconds
machine.deepsleep(30000)  # Milliseconds

# Wake on button press (GPIO 35 = ext0 wake source)
esp32.wake_on_ext0(pin=machine.Pin(35), level=esp32.WAKEUP_ALL_LOW)
machine.deepsleep()

# After waking from deep sleep, boot.py and main.py run from scratch
# Check wake reason:
if machine.reset_cause() == machine.DEEPSLEEP_RESET:
    print("Woke from deep sleep!")

# ── Light sleep ── (faster wake, ~0.8mA, resumes execution)

# Sleep for 5 seconds, then continue where you left off
machine.lightsleep(5000)
print("Woke from light sleep — execution continues here")
```

**Power consumption reference:**

| Mode | Current Draw | Wake Time |
|------|-------------|-----------|
| Active (WiFi on) | ~120-160 mA | — |
| Active (WiFi off) | ~30-50 mA | — |
| Light sleep | ~0.8 mA | ~1 ms |
| Deep sleep | ~10 µA | ~300 ms (full reboot) |

### 5. WiFi and Networking

#### Station Mode (Connect to an Access Point)

```python
import network
import time

sta = network.WLAN(network.STA_IF)
sta.active(True)

def connect_wifi(ssid, password, timeout=15):
    """Connect to WiFi with timeout and error handling."""
    if sta.isconnected():
        return True

    sta.connect(ssid, password)
    start = time.time()
    while not sta.isconnected():
        if time.time() - start > timeout:
            sta.disconnect()
            return False
        time.sleep(0.5)
    return True

# Connection info
if sta.isconnected():
    ip, subnet, gateway, dns = sta.ifconfig()
    rssi = sta.status('rssi')
    print(f"IP: {ip}, Gateway: {gateway}, RSSI: {rssi} dBm")
```

#### Access Point Mode

```python
ap = network.WLAN(network.AP_IF)
ap.active(True)
ap.config(essid="TTGO-Setup", password="12345678", authmode=network.AUTH_WPA2_PSK)
print(f"AP active at {ap.ifconfig()[0]}")
# Other devices can now connect to "TTGO-Setup" and reach the ESP32's web server
```

#### NTP Time Sync

```python
import ntptime
from machine import RTC

def sync_time():
    """Sync RTC from NTP server."""
    ntptime.host = "pool.ntp.org"
    try:
        ntptime.settime()  # Sets the RTC
        rtc = RTC()
        print(f"Time synced: {rtc.datetime()}")
        return True
    except OSError:
        print("NTP sync failed")
        return False
```

#### HTTP Requests with `urequests`

```python
import urequests
import json

# GET request
response = urequests.get("http://api.example.com/sensor/data")
data = response.json()
response.close()  # CRITICAL — always close to free the socket

# POST request with JSON body
payload = json.dumps({"temperature": 23.5, "humidity": 65.2})
response = urequests.post(
    "http://api.example.com/sensor/data",
    data=payload,
    headers={"Content-Type": "application/json"}
)
print(response.status_code)
response.close()
```

**Memory warning:** `urequests` buffers the entire response in RAM. For large responses, use raw sockets with `usocket` to read in chunks.

#### MQTT with `umqtt.simple`

MQTT is the standard protocol for IoT device communication. Install `umqtt.simple` if it's not in your firmware:

```bash
mpremote mip install umqtt.simple
```

```python
from umqtt.simple import MQTTClient
import json
import time

BROKER = "broker.hivemq.com"  # Free public broker for testing
CLIENT_ID = "ttgo-display-001"
TOPIC_PUB = b"home/sensors/ttgo"
TOPIC_SUB = b"home/commands/ttgo"

def on_message(topic, msg):
    """Callback for incoming messages."""
    print(f"Received on {topic}: {msg}")
    data = json.loads(msg)
    if data.get("command") == "refresh":
        draw_dashboard()

# Connect
client = MQTTClient(CLIENT_ID, BROKER, port=1883)
client.set_callback(on_message)
client.connect()
client.subscribe(TOPIC_SUB)
print(f"Connected to {BROKER}")

# Publish sensor data
def publish_reading(temperature, humidity, battery_v):
    payload = json.dumps({
        "device": CLIENT_ID,
        "temperature": temperature,
        "humidity": humidity,
        "battery_v": battery_v,
        "timestamp": time.time()
    })
    client.publish(TOPIC_PUB, payload)

# Main loop — check for messages and publish periodically
last_publish = 0
while True:
    client.check_msg()  # Non-blocking check for incoming messages
    if time.time() - last_publish > 60:
        publish_reading(23.5, 65.0, read_battery_avg())
        last_publish = time.time()
    time.sleep(0.1)
```

#### Robust Reconnection Pattern

WiFi drops are inevitable. Wrap your network code in a reconnection handler:

```python
import time
import network

class WiFiManager:
    def __init__(self, ssid, password):
        self.ssid = ssid
        self.password = password
        self.sta = network.WLAN(network.STA_IF)
        self.sta.active(True)

    def ensure_connected(self, timeout=15):
        """Check connection and reconnect if needed."""
        if self.sta.isconnected():
            return True

        print(f"Reconnecting to {self.ssid}...")
        self.sta.disconnect()
        time.sleep(1)
        self.sta.connect(self.ssid, self.password)

        start = time.time()
        while not self.sta.isconnected():
            if time.time() - start > timeout:
                print("Reconnection failed")
                return False
            time.sleep(0.5)

        print(f"Reconnected: {self.sta.ifconfig()[0]}")
        return True

    @property
    def rssi(self):
        return self.sta.status('rssi') if self.sta.isconnected() else None
```

### 6. File System and Storage

#### Internal Flash Filesystem

MicroPython mounts a FAT filesystem on the ESP32's internal flash. With 4MB flash, after the firmware image, you typically have ~1.5–2MB for files.

```python
import os

# List files in root
print(os.listdir('/'))

# File info
stat = os.stat('main.py')
print(f"Size: {stat[6]} bytes")

# Create directories
os.mkdir('data')

# Disk space
fs_stat = os.statvfs('/')
block_size = fs_stat[0]
total_blocks = fs_stat[2]
free_blocks = fs_stat[3]
print(f"Total: {total_blocks * block_size // 1024} KB")
print(f"Free:  {free_blocks * block_size // 1024} KB")
```

#### Config Files with JSON

```python
import json

CONFIG_FILE = "config.json"

def load_config():
    try:
        with open(CONFIG_FILE) as f:
            return json.load(f)
    except (OSError, ValueError):
        # File doesn't exist or is corrupt — return defaults
        return {"ssid": "", "password": "", "update_interval": 60}

def save_config(config):
    with open(CONFIG_FILE, "w") as f:
        json.dump(config, f)

# Usage
config = load_config()
config["ssid"] = "MyNetwork"
save_config(config)
```

#### SD Card via Secondary SPI

```python
import os
from machine import SPI, Pin
import sdcard

# SD card uses a separate SPI bus
sd_spi = SPI(2,
    baudrate=1000000,
    sck=Pin(25),
    mosi=Pin(26),
    miso=Pin(27)
)
sd = sdcard.SDCard(sd_spi, Pin(33))

# Mount the SD card
os.mount(sd, '/sd')
print(os.listdir('/sd'))

# Write a log file
with open('/sd/sensor_log.csv', 'a') as f:
    f.write(f"{time.time()},{temperature},{humidity}\n")

# Unmount before removing
os.umount('/sd')
```

You'll need the `sdcard.py` driver: `mpremote mip install sdcard`.

### 7. Memory Management

#### Diagnostic Tools

```python
import gc
import micropython

# Free heap
gc.collect()
print(f"Free memory: {gc.mem_free()} bytes")

# Detailed memory map
micropython.mem_info()       # Summary
micropython.mem_info(1)      # Full map — shows fragmentation

# Stack usage
micropython.stack_use()
```

#### Memory Optimization Techniques

**Use `const()` for compile-time constants:**

```python
from micropython import const

# These are stored in ROM, not allocated on the heap
_BTN1_PIN = const(35)
_BTN2_PIN = const(0)
_DISPLAY_WIDTH = const(240)
_DISPLAY_HEIGHT = const(135)
_UPDATE_INTERVAL_MS = const(5000)
```

**Pre-allocate buffers:**

```python
# BAD — creates new bytearray each time
def read_sensor():
    buf = bytearray(16)
    i2c.readfrom_into(0x76, buf)
    return buf

# GOOD — reuse a pre-allocated buffer
_sensor_buf = bytearray(16)
def read_sensor():
    i2c.readfrom_into(0x76, _sensor_buf)
    return _sensor_buf
```

**Avoid string concatenation in loops:**

```python
# BAD — creates O(n) intermediate strings
msg = ""
for reading in readings:
    msg += f"{reading},"

# GOOD — join once
msg = ",".join(str(r) for r in readings)
```

**Force garbage collection before large allocations:**

```python
gc.collect()
large_buffer = bytearray(32000)
```

**Use generators instead of lists:**

```python
# BAD — builds full list in memory
values = [adc.read() for _ in range(1000)]
avg = sum(values) / len(values)

# GOOD — generator, processes one value at a time
total = 0
for _ in range(1000):
    total += adc.read()
avg = total / 1000
```

### 8. Debugging and Development Workflow

#### mpremote Power Features

```bash
# Run a script on the device without copying it
mpremote run test_display.py

# Mount your local directory — files on your Mac appear as the device's filesystem
# Edit on Mac, run on device instantly
mpremote mount .

# Copy files to/from device
mpremote cp local_file.py :remote_file.py   # Local → device
mpremote cp :data/log.csv ./log.csv         # Device → local

# List files
mpremote ls

# Delete a file
mpremote rm :main.py

# Reset the device
mpremote reset

# Enter raw REPL (for scripted automation)
mpremote exec "import machine; print(machine.freq())"
```

If you use [[just-beginner-guide|Just]] as a command runner, create a `justfile` to automate repetitive commands:

```just
# justfile for TTGO T-Display MicroPython development

port := "/dev/cu.usbserial-01C8B207"

# Flash firmware
flash firmware:
    esptool --chip esp32 --port {{port}} --baud 460800 write_flash -z 0x1000 {{firmware}}

# Deploy all project files
deploy:
    mpremote cp boot.py :boot.py
    mpremote cp main.py :main.py
    mpremote cp lib/ :lib/
    mpremote reset

# Open REPL
repl:
    mpremote

# Live development with mounted filesystem
dev:
    mpremote mount src/

# Erase and reflash
reflash firmware: && flash firmware
    esptool --chip esp32 --port {{port}} erase_flash
```

#### Thonny IDE

Thonny provides a GUI for MicroPython development. It auto-detects the serial port, provides a file manager, and lets you run scripts with a single click. Useful for beginners, but the `mpremote` CLI is more powerful for automation.

#### Exception Handling and Logging

```python
import sys
import time

def log_error(e):
    """Write exception to a log file on flash."""
    with open("error.log", "a") as f:
        f.write(f"\n--- {time.time()} ---\n")
        sys.print_exception(e, f)

# In your main loop
while True:
    try:
        main_loop_iteration()
    except KeyboardInterrupt:
        break
    except Exception as e:
        sys.print_exception(e)
        log_error(e)
        time.sleep(5)  # Back off before retrying
```

### 9. Real-World Project: IoT Sensor Dashboard

This project ties together everything covered above: display, WiFi, MQTT, deep sleep, buttons, and watchdog timer.

#### Architecture

```
┌──────────────┐      MQTT       ┌──────────────┐
│  TTGO        │ ──────────────→ │  MQTT Broker  │
│  T-Display   │ ←────────────── │  (HiveMQ/     │
│              │                 │   Mosquitto)  │
│  • BME280    │                 └──────────────┘
│  • Battery   │                        ↑
│  • Buttons   │                        │
│  • Display   │                  ┌─────┴──────┐
└──────────────┘                  │  Dashboard  │
                                  │  (Grafana/  │
                                  │   Node-RED) │
                                  └────────────┘
```

#### Complete Code

```python
# main.py — IoT Sensor Dashboard with Deep Sleep

from micropython import const
from machine import Pin, SPI, ADC, Timer, RTC, WDT, deepsleep, reset_cause, DEEPSLEEP_RESET
import st7789
import network
import time
import json
import gc

from umqtt.simple import MQTTClient

# ── Configuration ──
_SSID = const("YourSSID")
_PASSWORD = const("YourPassword")
_BROKER = const("192.168.1.100")
_CLIENT_ID = const("ttgo-001")
_TOPIC = const("home/sensors/ttgo-001")
_SLEEP_SECONDS = const(300)        # 5 minutes between updates
_DISPLAY_SECONDS = const(10)       # Show display for 10 seconds before sleeping
_WDT_TIMEOUT_MS = const(30000)     # Watchdog: 30 seconds

# ── Pin Constants ──
_SPI_SCK   = const(18)
_SPI_MOSI  = const(19)
_DISP_DC   = const(16)
_DISP_CS   = const(5)
_DISP_RST  = const(23)
_DISP_BL   = const(4)
_BTN1      = const(35)
_BTN2      = const(0)
_ADC_PIN   = const(34)
_ADC_EN    = const(14)

# ── Hardware Init ──
spi = SPI(1, baudrate=40000000, polarity=1, sck=Pin(_SPI_SCK), mosi=Pin(_SPI_MOSI), miso=Pin(-1))
tft = st7789.ST7789(spi, 135, 240,
    reset=Pin(_DISP_RST, Pin.OUT), cs=Pin(_DISP_CS, Pin.OUT),
    dc=Pin(_DISP_DC, Pin.OUT), backlight=Pin(_DISP_BL, Pin.OUT), rotation=1)
tft.init()

adc_en = Pin(_ADC_EN, Pin.OUT, value=1)
battery_adc = ADC(Pin(_ADC_PIN))
battery_adc.atten(ADC.ATTN_11DB)

btn1 = Pin(_BTN1, Pin.IN)
btn2 = Pin(_BTN2, Pin.IN, Pin.PULL_UP)

# ── Functions ──
def read_battery(samples=20):
    total = sum(battery_adc.read() for _ in range(samples))
    return (total / samples / 4095) * 3.6 * 2

def connect_wifi(timeout=15):
    sta = network.WLAN(network.STA_IF)
    sta.active(True)
    if sta.isconnected():
        return sta
    sta.connect(_SSID, _PASSWORD)
    start = time.time()
    while not sta.isconnected() and (time.time() - start) < timeout:
        time.sleep(0.5)
    return sta if sta.isconnected() else None

def sync_ntp():
    try:
        import ntptime
        ntptime.settime()
    except:
        pass

def publish_data(battery_v):
    try:
        client = MQTTClient(_CLIENT_ID, _BROKER)
        client.connect()
        payload = json.dumps({
            "device": _CLIENT_ID,
            "battery_v": round(battery_v, 2),
            "timestamp": time.time(),
            "wake_reason": "deepsleep" if reset_cause() == DEEPSLEEP_RESET else "power_on"
        })
        client.publish(_TOPIC, payload)
        client.disconnect()
        return True
    except Exception as e:
        print(f"MQTT error: {e}")
        return False

def draw_status(sta, battery_v, mqtt_ok):
    tft.fill(0x0000)
    y = 5

    # Header
    tft.text(st7789.BOLD_FONT, "SENSOR DASHBOARD", 10, y, st7789.CYAN)
    y += 25

    # WiFi
    if sta and sta.isconnected():
        ip = sta.ifconfig()[0]
        rssi = sta.status('rssi')
        tft.text(st7789.FONT, f"WiFi: {ip}", 10, y, st7789.GREEN)
        y += 18
        tft.text(st7789.FONT, f"RSSI: {rssi} dBm", 10, y, st7789.WHITE)
    else:
        tft.text(st7789.FONT, "WiFi: OFFLINE", 10, y, st7789.RED)
    y += 22

    # Battery
    bat_color = st7789.GREEN if battery_v > 3.7 else st7789.YELLOW if battery_v > 3.4 else st7789.RED
    tft.text(st7789.FONT, f"Battery: {battery_v:.2f}V", 10, y, bat_color)
    y += 22

    # MQTT status
    mqtt_color = st7789.GREEN if mqtt_ok else st7789.RED
    mqtt_text = "MQTT: Published" if mqtt_ok else "MQTT: Failed"
    tft.text(st7789.FONT, mqtt_text, 10, y, mqtt_color)
    y += 22

    # Next wake
    tft.text(st7789.FONT, f"Sleep: {_SLEEP_SECONDS}s", 10, y, st7789.WHITE)

# ── Main ──
def main():
    # Enable watchdog — if anything hangs for 30s, force reset
    wdt = WDT(timeout=_WDT_TIMEOUT_MS)

    # Connect WiFi
    wdt.feed()
    sta = connect_wifi()

    # Sync time (first boot only — RTC persists through deep sleep)
    if reset_cause() != DEEPSLEEP_RESET and sta:
        sync_ntp()

    # Read sensors
    wdt.feed()
    battery_v = read_battery()

    # Publish to MQTT
    wdt.feed()
    mqtt_ok = publish_data(battery_v) if sta else False

    # Show status on display
    wdt.feed()
    draw_status(sta, battery_v, mqtt_ok)

    # Keep display on, check for button hold to stay awake
    start = time.time()
    stay_awake = False
    while time.time() - start < _DISPLAY_SECONDS:
        wdt.feed()
        if btn1.value() == 0:  # Button held = stay awake
            stay_awake = True
            break
        time.sleep(0.1)

    if not stay_awake:
        # Turn off display and enter deep sleep
        tft.fill(0x0000)
        Pin(_DISP_BL, Pin.OUT).value(0)
        deepsleep(_SLEEP_SECONDS * 1000)

main()
```

## Practical Examples

### Example 1: I2C Sensor (BME280) Integration

```python
from machine import I2C, Pin
import bme280  # mpremote mip install bme280

i2c = I2C(0, scl=Pin(22), sda=Pin(21), freq=400000)
sensor = bme280.BME280(i2c=i2c)

temp, pressure, humidity = sensor.values
# Returns strings like "23.45C", "1013.25hPa", "65.20%"
print(f"Temp: {temp}, Pressure: {pressure}, Humidity: {humidity}")
```

### Example 2: Simple Web Server for Configuration

```python
import socket
import network
import json

def start_config_server():
    """Serve a simple config page on port 80."""
    addr = socket.getaddrinfo('0.0.0.0', 80)[0][-1]
    s = socket.socket()
    s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    s.bind(addr)
    s.listen(1)
    print(f"Config server on {network.WLAN(network.STA_IF).ifconfig()[0]}:80")

    while True:
        cl, addr = s.accept()
        request = cl.recv(1024).decode()

        if "GET / " in request:
            html = """<html><body>
            <h1>TTGO T-Display Config</h1>
            <form method="POST" action="/save">
                SSID: <input name="ssid"><br>
                Password: <input name="password" type="password"><br>
                <input type="submit" value="Save">
            </form></body></html>"""
            cl.send("HTTP/1.0 200 OK\r\nContent-Type: text/html\r\n\r\n" + html)

        cl.close()
```

### Example 3: Multiple Display Pages

```python
class PageManager:
    def __init__(self, tft):
        self.tft = tft
        self.pages = []
        self.current = 0

    def add_page(self, name, draw_func):
        self.pages.append((name, draw_func))

    def show_current(self):
        if self.pages:
            name, draw = self.pages[self.current]
            self.tft.fill(0x0000)
            draw(self.tft)

    def next_page(self):
        self.current = (self.current + 1) % len(self.pages)
        self.show_current()

# Define pages
def draw_wifi_page(tft):
    sta = network.WLAN(network.STA_IF)
    tft.text(font, f"IP: {sta.ifconfig()[0]}", 10, 20, st7789.GREEN)
    tft.text(font, f"RSSI: {sta.status('rssi')}", 10, 50, st7789.WHITE)

def draw_battery_page(tft):
    v = read_battery()
    tft.text(font, f"Battery: {v:.2f}V", 10, 20, st7789.YELLOW)

pages = PageManager(tft)
pages.add_page("WiFi", draw_wifi_page)
pages.add_page("Battery", draw_battery_page)
pages.show_current()

# Button 1 cycles pages
while True:
    if btn1.value() == 0:
        pages.next_page()
        time.sleep(0.3)
    time.sleep(0.05)
```

## Hands-On Exercises

### Exercise 1: Weather Station Display

Connect a BME280 sensor over I2C and build a weather station that shows temperature, humidity, and pressure with trend arrows (↑↓→) based on the last 10 readings. Publish data over MQTT every 5 minutes.

### Exercise 2: OTA File Updater

Build a simple HTTP endpoint on another machine that serves updated `main.py`. Write a function on the TTGO that downloads the new file and saves it to flash, then reboots. Handle partial downloads and corrupt files gracefully.

### Exercise 3: Battery Life Optimizer

Measure actual current draw in different modes using a USB power meter. Find the optimal deep sleep interval for 24-hour battery life with a 1000mAh LiPo cell. Factor in WiFi connection time (which consumes ~150mA for several seconds).

### Exercise 4: Multi-Device MQTT Network

Set up two TTGO T-Displays: one as a sensor node (reads temperature, publishes to MQTT) and one as a display node (subscribes to MQTT, shows the readings). The display node should handle the sensor node going offline gracefully.

## Troubleshooting

### SPI initialization fails or display shows garbage

Recent MicroPython versions changed SPI initialization. Always specify `miso` explicitly:

```python
# Even though the display doesn't use MISO, you must specify it
spi = SPI(1, baudrate=40000000, polarity=1,
          sck=Pin(18), mosi=Pin(19), miso=Pin(-1))
```

### Display offset — content drawn at wrong position

The ST7789 controller addresses a 240×320 framebuffer, but the panel is 135×240. Use a driver that handles the offset, or configure `tfa=40, bfa=40` manually. If switching rotation, the offsets change — test each rotation you use.

### Battery ADC reads zero or wildly inaccurate

GPIO 14 must be driven HIGH to enable the voltage divider. Without this, the ADC pin is disconnected from the battery:

```python
Pin(14, Pin.OUT, value=1)  # MUST do this before any ADC read on GPIO 34
```

Also, the ESP32's ADC is noisy near WiFi activity. Read after WiFi operations complete, or average 20+ samples.

### WiFi connects then immediately disconnects

Common causes: incorrect password (typos are invisible), router MAC filtering, too many clients, or 5GHz-only network (ESP32 only supports 2.4GHz).

### main.py crash loop — can't access REPL

If `main.py` crashes and the device reboots in a tight loop:

1. Try `Ctrl-C` in mpremote — you have a brief window after reset
2. If that fails: hold the BOOT button (GPIO 0) during reset to enter bootloader, then `mpremote rm :main.py`
3. Nuclear option: `esptool erase_flash` and reflash firmware

### MemoryError during display operations

A full-screen framebuffer (135×240×2 = 64,800 bytes) uses more than half of available RAM. Solutions:

- Use partial buffers (update in strips)
- Use the C driver (lower overhead)
- Call `gc.collect()` before allocating the buffer
- Avoid holding other large objects during display updates

### Deep sleep draws more current than expected

Make sure WiFi is fully stopped before entering deep sleep:

```python
import network
sta = network.WLAN(network.STA_IF)
sta.active(False)
```

Also disable the ADC enable pin to cut the voltage divider's quiescent current:

```python
Pin(14, Pin.OUT, value=0)
```

## Related Tutorials

- [[micropython-ttgo-t-display-beginner-guide|MicroPython TTGO T-Display Beginner Guide]] — setup, first flash, and first project
- [[dotfiles-beginner-guide|Dotfiles Beginner Guide]] — managing shell environments and virtual environments on macOS
- [[dotfiles-deep-dive|Dotfiles Deep Dive]] — advanced shell configuration and tool management
- [[linux-permissions-beginner-guide|Linux Permissions Beginner Guide]] — understanding serial device permissions
- [[linux-permissions-deep-dive|Linux Permissions Deep Dive]] — device files, udev rules for serial ports
- [[mosh-beginner-guide|Mosh Beginner Guide]] — remote access to headless ESP32 setups
- [[mosh-deep-dive|Mosh Deep Dive]] — persistent sessions for remote development
- [[just-beginner-guide|Just Beginner Guide]] — automating flash/deploy/REPL commands
- [[just-deep-dive|Just Deep Dive]] — advanced justfile patterns for embedded development workflows
- [[sesh-beginner-guide|Sesh Beginner Guide]] — terminal session management for juggling multiple serial connections

## References

- [MicroPython Official Documentation](https://docs.micropython.org/en/latest/)
- [MicroPython ESP32 Quick Reference](https://docs.micropython.org/en/latest/esp32/quickref.html)
- [ESP32 MicroPython Reset & Boot Sequence](https://docs.micropython.org/en/latest/reference/reset_boot.html)
- [Russ Hughes ST7789 C Driver (fast)](https://github.com/russhughes/st7789_mpy)
- [Russ Hughes ST7789 Pure Python Driver](https://github.com/russhughes/st7789py_mpy)
- [TTGO ST7789 MicroPython Project](https://github.com/schumixmd/TTGO-ST7789-MicroPython)
- [TTGO T-Display MicroPython Community Guide](https://github.com/Opinion/LILYGO-T-Display-ESP32-16MB-Micropython-guide)
- [Random Nerd Tutorials: ESP32 MicroPython](https://randomnerdtutorials.com/flashing-micropython-firmware-esptool-py-esp32-esp8266/)
- [umqtt.simple Documentation](https://github.com/micropython/micropython-lib/tree/master/micropython/umqtt.simple)
- [ESP32 Datasheet (Espressif)](https://www.espressif.com/sites/default/files/documentation/esp32_datasheet_en.pdf)

## Summary

This reference covered the full depth of MicroPython on the TTGO T-Display:

- **Firmware options** — generic vs. C-driver-embedded firmware vs. custom builds with frozen modules, and when to use each
- **Complete pin mapping** — every GPIO on the board documented with its function and caveats
- **Display mastery** — ST7789 initialization, RGB565 color, drawing primitives, custom fonts, framebuffer double-buffering, and performance benchmarks
- **Hardware interfaces** — Pin, SPI, I2C, ADC, PWM, Timer, RTC, deep sleep with practical code for each
- **Networking** — WiFi station/AP modes, NTP sync, HTTP requests, MQTT pub/sub, and robust reconnection patterns
- **Storage** — internal flash filesystem, JSON config files, SD card access
- **Memory management** — diagnostics, `const()`, buffer pre-allocation, generator patterns, and garbage collection strategy
- **Development workflow** — mpremote power features, justfile automation, Thonny, error logging
- **Production patterns** — watchdog timers, deep sleep duty cycling, multi-page displays, OTA updates

For your next steps, consider building a mesh network of TTGO displays using ESP-NOW (peer-to-peer, no WiFi router needed), or exploring the ESP32's Bluetooth LE capabilities for phone-based configuration.
# Related Tutorials

- [[ttgo-display-beginner-guide|TTGO Display Projects Beginner Guide]] — hands-on display projects including WiFi dashboard, countdown timer, and multi-page apps
- [[ttgo-display-deep-dive|TTGO Display Projects Deep Dive]] — advanced display techniques, C driver migration, MQTT, deep sleep, and production patterns

- [[circuitpython-beginner-guide|CircuitPython Beginner Guide]] — Adafruit's beginner-friendly MicroPython fork for RP2040/RP2350 boards
- [[circuitpython-deep-dive|CircuitPython Deep Dive]] — advanced CircuitPython including displayio, PIO, USB HID, and memory optimization
