---
title: "CircuitPython — Deep Dive"
date: 2026-05-18
difficulty: advanced
tags: [circuitpython, python, microcontroller, rp2040, rp2350, adafruit, embedded, hardware, displayio, pio, i2c, neopixel]
---

# CircuitPython — Deep Dive

## Overview

This reference goes beyond the basics covered in the [[circuitpython-beginner-guide|CircuitPython Beginner's Guide]] and explores the internals, advanced patterns, and design decisions that matter when you build real projects with CircuitPython on RP2040 and RP2350 hardware. Topics include the `displayio` graphics system, PIO (Programmable I/O) state machines, memory management under tight constraints, the boot sequence and filesystem architecture, power management, writing custom libraries, and performance optimization.

This guide is designed to be revisited as a reference rather than read linearly. Sections are self-contained.

## Prerequisites

- Completion of (or equivalent experience to) the [[circuitpython-beginner-guide|CircuitPython Beginner's Guide]]
- A working CircuitPython board (RP2040 or RP2350) with serial console access
- Familiarity with I2C, SPI, and basic electronics (pull-ups, logic levels, datasheets)
- Comfortable reading Python 3 code including classes, decorators, and context managers
- A text editor and `circup` installed (`pip install circup`)

## Key Concepts

### CircuitPython's relationship to MicroPython and CPython

CircuitPython forked from [[micropython-ttgo-t-display-deep-dive|MicroPython]] in 2017. The fork's guiding principle is **board-to-board consistency**: code written for one CircuitPython board should work on any other board with equivalent hardware, without `#ifdef`-style conditionals. This is achieved through a Hardware Abstraction Layer (HAL) that exposes the same API names (`board`, `busio`, `digitalio`) regardless of the underlying silicon.

Key architectural differences from MicroPython:

| Aspect | CircuitPython | MicroPython |
|---|---|---|
| USB mass storage | Always on (CIRCUITPY drive) | Not available by default |
| Auto-reload | Yes — saves trigger reload | No — manual reset or tool needed |
| HAL consistency | Strict cross-board API | Per-port, chip-specific APIs |
| Library ecosystem | Adafruit Bundle (500+ `.mpy` libs) | `upip` / manual install |
| Dual-core (RP2040/RP2350) | Not exposed to user code | `_thread` module available |
| PIO access | `rp2pio` module (high-level) | `rp2` module (low-level) |
| Display framework | `displayio` (built-in, compositing) | Framebuffer-based (manual) |

### The boot sequence in detail

Understanding the boot sequence is critical for power management, filesystem configuration, and USB behavior:

```
1. Hardware reset / power-on
2. ROM bootloader (RP2040/RP2350 silicon)
3. CircuitPython firmware loads from external flash
4. boot.py executes (if present)
   - Configure USB devices (HID, MIDI, storage)
   - Set filesystem read/write permissions
   - Configure NVM (non-volatile memory)
5. USB enumeration completes
   - CIRCUITPY drive mounts
   - CDC serial port appears
6. code.py executes (or main.py, then code.txt)
7. On completion/error: drops to REPL
8. On file save: auto-reload → back to step 6
```

`boot.py` runs **before** USB is fully initialized, so you can control which USB devices appear. This is how you create HID keyboards, MIDI controllers, or disable the USB drive entirely for production deployments.

### Memory architecture on RP2040 vs RP2350

The RP2040 provides 264 KB of SRAM. After CircuitPython's runtime overhead (~80-100 KB), you have roughly 160-180 KB for your code, libraries, and data. The RP2350 doubles this to 520 KB total, leaving ~350-400 KB available — a significant improvement for display buffers and complex state.

Check available memory at any time:

```python
import gc
gc.collect()
print(f"Free memory: {gc.mem_free():,} bytes")
```

Expected output (RP2350):

```
Free memory: 389,216 bytes
```

Expected output (RP2040):

```
Free memory: 165,440 bytes
```

## Step-by-Step Instructions

### Understanding and using `displayio`

`displayio` is CircuitPython's compositing display framework. Unlike framebuffer-based approaches where you draw pixels directly, `displayio` uses a layer model: you compose groups of visual elements (tiles, labels, shapes) and the system renders them efficiently, only updating regions that changed.

#### The `displayio` object hierarchy

```
Display (physical screen)
  └── root_group (Group)
        ├── TileGrid (background image or color)
        ├── Group (a sub-group)
        │     ├── Label ("Hello")
        │     └── TileGrid (icon sprite)
        └── TileGrid (status bar)
```

#### Step 1: Initialize a display over SPI

For an ST7789 240x135 TFT (common on many Adafruit boards):

```python
import board
import busio
import displayio
import fourwire

# Release any previously configured displays
displayio.release_displays()

spi = busio.SPI(clock=board.SCK, MOSI=board.MOSI)
display_bus = fourwire.FourWire(
    spi, command=board.D6, chip_select=board.D5, reset=board.D9
)

from adafruit_st7789 import ST7789
display = ST7789(display_bus, width=240, height=135, rowstart=40, colstart=53)
```

#### Step 2: Create a display group with elements

```python
import terminalio
from adafruit_display_text import label

# Create the root group
splash = displayio.Group()
display.root_group = splash

# Background — solid color
bg_bitmap = displayio.Bitmap(240, 135, 1)
bg_palette = displayio.Palette(1)
bg_palette[0] = 0x000033  # Dark blue
bg_tile = displayio.TileGrid(bg_bitmap, pixel_shader=bg_palette)
splash.append(bg_tile)

# Text label
text = label.Label(
    terminalio.FONT,
    text="Angle: 45.0°",
    color=0xFFFF00,
    x=20,
    y=67
)
splash.append(text)

# Update text dynamically
text.text = "Angle: 90.0°"  # Display updates automatically
```

#### Step 3: Use `vectorio` for efficient shapes

`vectorio` draws shapes without bitmap memory:

```python
import vectorio

# Draw a filled circle
circle = vectorio.Circle(
    pixel_shader=bg_palette,
    radius=20,
    x=120,
    y=67
)
splash.append(circle)

# Draw a rectangle
rect = vectorio.Rectangle(
    pixel_shader=bg_palette,
    width=50,
    height=30,
    x=10,
    y=10
)
splash.append(rect)
```

### Working with PIO on RP2040/RP2350

The RP2040 has 8 PIO state machines (2 blocks of 4); the RP2350 has 12 (3 blocks of 4). PIO state machines execute tiny assembly programs at the system clock rate, independent of the CPU. CircuitPython's `rp2pio` module provides a high-level interface.

#### Using `rp2pio.StateMachine` directly

```python
import rp2pio
import board
import array
import microcontroller

# PIO program: toggle a pin at a precise frequency
# This is PIO assembly encoded as a byte array
pio_program = bytes([
    # set pins, 1    [31]  ; set pin high, delay 31
    0b11100001_11111000 >> 8, 0b11100001_11111000 & 0xFF,
    # set pins, 0    [31]  ; set pin low, delay 31
    0b11100000_11111000 >> 8, 0b11100000_11111000 & 0xFF,
])

# Most CircuitPython users won't write raw PIO — it's used internally
# by NeoPixel timing, audio output, etc.
```

In practice, CircuitPython uses PIO behind the scenes for:

- NeoPixel output timing (precise 800 KHz signal)
- `audiobusio.I2SOut` for digital audio
- `rotaryio.IncrementalEncoder` for quadrature decoding
- Custom protocols via `rp2pio.StateMachine`

### Advanced I2C patterns

#### Multi-device bus sharing

```python
import board
import busio

i2c = busio.I2C(board.SCL, board.SDA, frequency=400_000)  # Fast mode

# Use try_lock/unlock for shared bus access
while not i2c.try_lock():
    pass

try:
    # Read 2 bytes from AS5600 (addr 0x36), raw angle register 0x0C
    result = bytearray(2)
    i2c.writeto_then_readfrom(0x36, bytes([0x0C]), result)
    raw_angle = (result[0] << 8) | result[1]
    degrees = raw_angle * 360.0 / 4096.0
    print(f"Angle: {degrees:.1f}°")
finally:
    i2c.unlock()
```

#### Writing a minimal I2C driver class

When no Adafruit library exists for your sensor, write a minimal driver:

```python
class AS5600:
    """Minimal driver for the AS5600 magnetic rotary encoder."""
    
    _REG_RAW_ANGLE = 0x0C
    _REG_STATUS = 0x0B
    _REG_MAGNITUDE = 0x1B
    
    def __init__(self, i2c, address=0x36):
        self._i2c = i2c
        self._address = address
        self._buf = bytearray(2)
    
    def _read_register_16(self, reg):
        while not self._i2c.try_lock():
            pass
        try:
            self._i2c.writeto_then_readfrom(
                self._address, bytes([reg]), self._buf
            )
        finally:
            self._i2c.unlock()
        return (self._buf[0] << 8) | self._buf[1]
    
    @property
    def raw_angle(self):
        """Raw 12-bit angle value (0–4095)."""
        return self._read_register_16(self._REG_RAW_ANGLE) & 0x0FFF
    
    @property
    def degrees(self):
        """Angle in degrees (0.0–360.0)."""
        return self.raw_angle * 360.0 / 4096.0
    
    @property
    def magnet_detected(self):
        """True if the magnet is in range."""
        status = self._read_register_16(self._REG_STATUS)
        return bool(status & 0x20)
```

Usage:

```python
import board
import busio

i2c = busio.I2C(board.SCL, board.SDA)
sensor = AS5600(i2c)

print(f"Angle: {sensor.degrees:.1f}°")
print(f"Magnet detected: {sensor.magnet_detected}")
```

### Filesystem and data logging

#### Configuring writable storage

By default, the USB host (your computer) has write access to CIRCUITPY and CircuitPython code does not. To let your code write files (for data logging), create `boot.py`:

```python
import board
import digitalio
import storage

# Use a button to choose the mode:
# Button pressed at boot → code.py can write (USB read-only)
# Button not pressed     → normal mode (USB read-write)
switch = digitalio.DigitalInOut(board.D5)
switch.direction = digitalio.Direction.INPUT
switch.pull = digitalio.Pull.UP

if not switch.value:  # Button pressed (pulled LOW)
    storage.remount("/", readonly=False)
```

Then in `code.py`:

```python
import time

with open("/data.csv", "a") as f:
    f.write(f"{time.monotonic()},{sensor.degrees:.2f}\n")
```

#### Non-volatile memory (NVM)

For small persistent values (calibration offsets, settings), use `microcontroller.nvm` — a byte array that survives resets:

```python
import microcontroller
import struct

# Write a float to NVM (4 bytes starting at offset 0)
offset_angle = 45.5
struct.pack_into("f", microcontroller.nvm, 0, offset_angle)

# Read it back after a reset
stored = struct.unpack_from("f", microcontroller.nvm, 0)[0]
print(f"Stored offset: {stored}")
```

NVM size varies by board (typically 256 bytes to 8 KB).

### USB HID — building a custom keyboard or gamepad

```python
# boot.py — must be configured before USB enumeration
import usb_hid

# Enable keyboard and gamepad HID devices
usb_hid.enable(
    (usb_hid.Device.KEYBOARD, usb_hid.Device.GAMEPAD)
)
```

```python
# code.py — send keystrokes
import board
import digitalio
import usb_hid
from adafruit_hid.keyboard import Keyboard
from adafruit_hid.keycode import Keycode

kbd = Keyboard(usb_hid.devices)

button = digitalio.DigitalInOut(board.D5)
button.direction = digitalio.Direction.INPUT
button.pull = digitalio.Pull.UP

while True:
    if not button.value:
        kbd.send(Keycode.SPACE)
        while not button.value:  # Wait for release
            pass
```

### Power management and sleep

#### Light sleep

```python
import alarm
import time

# Sleep for 10 seconds, then wake
time_alarm = alarm.time.TimeAlarm(monotonic_time=time.monotonic() + 10)
alarm.light_sleep_until_alarms(time_alarm)
print("Woke up!")
```

#### Deep sleep (lowest power, board resets on wake)

```python
import alarm
import board

# Wake on pin change (e.g., button press)
pin_alarm = alarm.pin.PinAlarm(pin=board.D5, value=False, pull=True)

# This does not return — board resets on wake
alarm.exit_and_deep_sleep_until_alarms(pin_alarm)
```

After deep sleep, `code.py` runs from the beginning. Check `alarm.wake_alarm` to determine what triggered the wake:

```python
import alarm

if alarm.wake_alarm:
    print(f"Woke from deep sleep via: {type(alarm.wake_alarm)}")
else:
    print("Normal boot (not waking from deep sleep)")
```

### Performance optimization

#### Profiling with `time.monotonic_ns()`

```python
import time

start = time.monotonic_ns()
# ... code to profile ...
elapsed_us = (time.monotonic_ns() - start) / 1000
print(f"Elapsed: {elapsed_us:.0f} us")
```

#### Speed tips

1. **Use `const()` for integer constants** — avoids runtime dictionary lookups:

```python
from micropython import const

_REG_ANGLE = const(0x0C)
_I2C_ADDR = const(0x36)
```

2. **Pre-allocate buffers** — avoid creating new `bytearray` objects in loops:

```python
# Bad: allocates every iteration
while True:
    data = bytearray(2)
    i2c.readfrom_into(0x36, data)

# Good: allocate once
data = bytearray(2)
while True:
    i2c.readfrom_into(0x36, data)
```

3. **Minimize imports** — each import uses RAM. Import only what you need:

```python
# Bad
import adafruit_bme280

# Better — if you only use one class
from adafruit_bme280.basic import Adafruit_BME280_I2C
```

4. **Use `.mpy` files** — pre-compiled bytecode uses less RAM than `.py` source. The Adafruit bundle ships `.mpy` by default. For your own libraries:

```bash
mpy-cross my_library.py
# Produces my_library.mpy — copy to CIRCUITPY/lib/
```

5. **RP2350 hardware FPU** — floating-point math is 5-10x faster on RP2350 than RP2040. If your project does heavy math (sensor fusion, signal processing), the RP2350 is worth the few extra dollars.

### Creating a proper library package

Structure your library as a Python package with metadata:

```
my_sensor/
  __init__.py       # Contains the driver class
  constants.py      # Register addresses, config values
```

Follow Adafruit's conventions:

```python
# my_sensor/__init__.py
"""
CircuitPython driver for the MY_SENSOR breakout.

* Author: Your Name
* License: MIT

Implementation Notes
--------------------
**Hardware:**
* MY_SENSOR breakout (Adafruit #XXXX)

**Software and Dependencies:**
* Adafruit CircuitPython firmware for the supported boards:
  https://circuitpython.org/downloads
* Adafruit Bus Device library:
  https://github.com/adafruit/Adafruit_CircuitPython_BusDevice
"""

from adafruit_bus_device.i2c_device import I2CDevice
from micropython import const

_DEFAULT_ADDRESS = const(0x36)

class MySensor:
    def __init__(self, i2c_bus, address=_DEFAULT_ADDRESS):
        self._device = I2CDevice(i2c_bus, address)
        self._buf = bytearray(2)
    
    @property
    def value(self):
        with self._device as i2c:
            i2c.write_then_readinto(
                bytes([0x00]), self._buf
            )
        return (self._buf[0] << 8) | self._buf[1]
```

Using `I2CDevice` from `adafruit_bus_device` handles locking automatically and provides a clean context-manager interface.

## Practical Examples

### Example 1: Real-time angle display with rolling average

A complete project combining I2C sensor reading, display output, and signal smoothing — similar to the faceting angle finder project:

```python
import board
import busio
import time
import adafruit_ssd1306

# --- I2C setup ---
i2c = busio.I2C(board.SCL, board.SDA, frequency=400_000)
oled = adafruit_ssd1306.SSD1306_I2C(128, 64, i2c)

# --- AS5600 raw driver ---
def read_angle(i2c_bus):
    while not i2c_bus.try_lock():
        pass
    try:
        buf = bytearray(2)
        i2c_bus.writeto_then_readfrom(0x36, bytes([0x0C]), buf)
    finally:
        i2c_bus.unlock()
    return ((buf[0] << 8) | buf[1]) * 360.0 / 4096.0

# --- Rolling average filter ---
WINDOW = 10
readings = [0.0] * WINDOW
idx = 0

while True:
    readings[idx] = read_angle(i2c)
    idx = (idx + 1) % WINDOW
    avg = sum(readings) / WINDOW
    
    oled.fill(0)
    oled.text(f"{avg:6.1f} deg", 16, 24, 1, size=2)
    oled.show()
    
    time.sleep(0.05)  # 20 Hz update
```

### Example 2: USB HID macro pad

Turn a board with 4 buttons into a macro keyboard:

```python
import board
import digitalio
import usb_hid
from adafruit_hid.keyboard import Keyboard
from adafruit_hid.keycode import Keycode
import time

kbd = Keyboard(usb_hid.devices)

PINS = [board.D2, board.D3, board.D4, board.D5]
MACROS = [
    (Keycode.CONTROL, Keycode.C),         # Copy
    (Keycode.CONTROL, Keycode.V),         # Paste
    (Keycode.CONTROL, Keycode.Z),         # Undo
    (Keycode.CONTROL, Keycode.SHIFT, Keycode.Z),  # Redo
]

buttons = []
for pin in PINS:
    btn = digitalio.DigitalInOut(pin)
    btn.direction = digitalio.Direction.INPUT
    btn.pull = digitalio.Pull.UP
    buttons.append(btn)

prev_state = [True] * len(buttons)

while True:
    for i, btn in enumerate(buttons):
        if not btn.value and prev_state[i]:  # Falling edge
            kbd.send(*MACROS[i])
        prev_state[i] = btn.value
    time.sleep(0.01)  # 100 Hz polling, debounce via edge detection
```

### Example 3: WiFi data poster (RP2040-W / ESP32-S3)

For WiFi-capable boards, CircuitPython includes `wifi`, `socketpool`, and `adafruit_requests`:

```python
import os
import wifi
import socketpool
import adafruit_requests
import ssl
import json

# Credentials come from settings.toml:
# CIRCUITPY_WIFI_SSID = "MyNetwork"
# CIRCUITPY_WIFI_PASSWORD = "MyPassword"

wifi.radio.connect(
    os.getenv("CIRCUITPY_WIFI_SSID"),
    os.getenv("CIRCUITPY_WIFI_PASSWORD")
)
print(f"Connected to WiFi, IP: {wifi.radio.ipv4_address}")

pool = socketpool.SocketPool(wifi.radio)
session = adafruit_requests.Session(pool, ssl.create_default_context())

# POST sensor data to a webhook
data = {"temperature": 23.5, "humidity": 45.2}
response = session.post(
    "https://httpbin.org/post",
    json=data,
    headers={"Content-Type": "application/json"}
)
print(f"Response: {response.status_code}")
response.close()
```

## Hands-On Exercises

### Exercise 1: Custom `displayio` dashboard

Build a display layout using `displayio` that shows: sensor name (static label), current value (updating number), a bar graph that scales with the value, and a min/max tracker. Use a real sensor or simulate values with `random`.

### Exercise 2: Dual I2C bus

The RP2350 has two I2C peripherals. Configure `busio.I2C` on both `board.SCL`/`board.SDA` and a second pair of pins. Put a sensor on each bus and read them alternately. Measure whether parallel buses improve throughput compared to two devices sharing one bus.

### Exercise 3: Deep sleep data logger

Build a battery-powered temperature logger that wakes from deep sleep every 60 seconds, reads a sensor, appends to a CSV file on CIRCUITPY, and goes back to deep sleep. Use `alarm.wake_alarm` to track boot count via NVM. Measure current draw in deep sleep with a multimeter (target: < 1 mA on the RP2350).

### Exercise 4: PIO NeoPixel timing analysis

Use `rp2pio.StateMachine` to output a test signal on a GPIO pin. Connect that pin to another GPIO configured as a digital input and measure the pulse width using `pulseio.PulseIn`. Compare the measured timing against the programmed timing to understand PIO precision.

## Troubleshooting

### `displayio` shows garbled image or wrong colors

- Verify the `rowstart` and `colstart` values for your specific display module — these offsets differ between manufacturers even for the same controller chip.
- Ensure the SPI clock speed is not too high. Start at 24 MHz and increase if stable.
- Check that `displayio.release_displays()` is called before reinitializing.

### I2C device not responding after sleep

After `light_sleep`, I2C peripherals may need re-initialization:

```python
i2c.deinit()
i2c = busio.I2C(board.SCL, board.SDA)
```

### USB HID device not appearing

`usb_hid.enable()` must be in `boot.py`, not `code.py`. Changes to `boot.py` require a full reset (not just auto-reload) to take effect. Double-tap reset if needed.

### `MemoryError` with `displayio`

Display buffers consume significant RAM. A 240x135 16-bit display uses ~63 KB. Strategies:

- Reduce color depth with `displayio.ColorConverter(input_colorspace=displayio.Colorspace.RGB565)`.
- Use smaller `Bitmap` objects and tile them.
- On RP2040, consider an SSD1306 monochrome OLED (128x64 = 1 KB buffer) instead of a color TFT.

### `rp2pio` program crashes or hangs

- PIO programs have a 32-instruction limit per state machine.
- Verify pin assignments do not conflict with other peripherals.
- Use `print(rp2pio.StateMachine)` to inspect available state machines.

### CircuitPython code runs but CIRCUITPY drive disappeared

If `boot.py` disables the USB mass storage device:

```python
# This was in boot.py:
import storage
storage.disable_usb_drive()
```

Recovery: enter safe mode by holding a button during reset (board-specific — check your board's guide) or re-flash the `.uf2` in bootloader mode.

## References

- [CircuitPython API Documentation](https://docs.circuitpython.org/en/latest/) — complete module reference
- [CircuitPython Core Modules](https://docs.circuitpython.org/en/latest/shared-bindings/index.html) — `displayio`, `busio`, `rp2pio`, `alarm`, etc.
- [Adafruit CircuitPython Library Bundle](https://circuitpython.org/libraries) — 500+ device drivers
- [RP2040 Datasheet](https://datasheets.raspberrypi.com/rp2040/rp2040-datasheet.pdf) — hardware reference for PIO, DMA, peripherals
- [RP2350 Datasheet](https://datasheets.raspberrypi.com/rp2350/rp2350-datasheet.pdf) — RP2350 hardware reference
- [circuitpython-tricks (todbot)](https://github.com/todbot/circuitpython-tricks) — community patterns and snippets
- [displayio Guide](https://learn.adafruit.com/circuitpython-display-support-using-displayio) — Adafruit's `displayio` tutorial
- [CircuitPython Deep Dive Streams](https://www.youtube.com/playlist?list=PLjF7R1fz_OOXBHlu9msoXq2jQN44Nt2a8) — Scott Shawcroft's weekly streams covering internals
- [mpy-cross](https://github.com/adafruit/circuitpython/tree/main/mpy-cross) — pre-compile `.py` to `.mpy`

## Related Tutorials

- [[circuitpython-beginner-guide|CircuitPython Beginner's Guide]] — installation, first programs, basic hardware
- [[micropython-ttgo-t-display-beginner-guide|MicroPython TTGO T-Display Beginner Guide]] — MicroPython on similar hardware, compare approaches
- [[micropython-ttgo-t-display-deep-dive|MicroPython TTGO T-Display Deep Dive]] — advanced MicroPython including display drivers and dual-core
- [[ttgo-display-beginner-guide|TTGO Display Beginner Guide]] — another microcontroller display project
- [[ttgo-display-deep-dive|TTGO Display Deep Dive]] — TTGO hardware deep dive

## Summary

CircuitPython provides a productive environment for embedded development that scales from simple LED blinks to complex display-driven sensor projects. The `displayio` compositing system, PIO access via `rp2pio`, USB HID support, and WiFi capabilities make it suitable for a wide range of applications without leaving Python.

**Key takeaways:**

- `displayio` composites visual layers efficiently — prefer it over raw framebuffer drawing for maintainable display code.
- PIO state machines handle timing-critical protocols (NeoPixels, audio, custom protocols) at hardware speed, freeing the CPU.
- Memory is the primary constraint on RP2040 (264 KB). Use `.mpy` files, pre-allocated buffers, and `const()` to minimize overhead. The RP2350 (520 KB) gives substantially more headroom.
- `boot.py` runs before USB enumeration and controls which USB devices appear — essential for HID, MIDI, and production deployments.
- NVM and filesystem writes require explicit configuration; deep sleep resets the board entirely.

**Next steps:**

- Build a complete project combining a sensor, display, and data logging to exercise all the patterns in this guide.
- Explore the [Adafruit Learning System](https://learn.adafruit.com/) for advanced projects like BLE (Bluetooth Low Energy) on nRF-based boards or camera integration on ESP32-S3.
- Contribute a library to the community — follow the Adafruit library structure and submit a PR to the CircuitPython Library Bundle.
