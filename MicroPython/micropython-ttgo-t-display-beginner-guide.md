---
title: "Getting Started with MicroPython on the TTGO T-Display"
date: 2026-04-27
difficulty: beginner
tags:
  - micropython
  - esp32
  - ttgo-t-display
  - iot
  - embedded
  - python
  - display
  - st7789
---

# Getting Started with MicroPython on the TTGO T-Display

## Overview

MicroPython is a lean implementation of Python 3 designed to run on microcontrollers — tiny computers with limited memory and processing power. Instead of writing C++ and waiting for lengthy compile-upload cycles (as you would with the Arduino framework), MicroPython gives you an interactive Python shell (called a REPL) running directly on the chip. You type a command, the hardware responds immediately.

The **TTGO T-Display** (also sold under the LILYGO brand) is an ESP32-based development board that comes with a built-in 1.14-inch color TFT display (240×135 pixels, ST7789V controller). This makes it an excellent platform for learning MicroPython because you get visual feedback without wiring up external components. The board also has WiFi, Bluetooth, two programmable buttons, a battery connector with voltage monitoring, and an I2C bus for connecting sensors.

In this tutorial you will learn how to:

- Flash MicroPython firmware onto the TTGO T-Display
- Connect to the device and use the interactive REPL
- Drive the built-in display to show text and graphics
- Manage files on the device with `boot.py` and `main.py`
- Build a WiFi-connected status screen as your first real project

By the end, you will have a fully working MicroPython environment and a live WiFi status display — the foundation for any IoT project you want to build.

## Prerequisites

### Hardware

- **TTGO T-Display** (V1.1 or V1.8) — the ESP32 board with the built-in 240×135 TFT screen
- **USB cable** — must be a data cable, not a charge-only cable. If the device does not appear when plugged in, try a different cable. This is the most common "it doesn't work" issue.
- **A computer running macOS** (this guide uses macOS commands; Linux and Windows equivalents are noted where they differ)

### Software

- **Python 3** installed on your computer (check with `python3 --version`)
- **A terminal** — Terminal.app, iTerm2, or any terminal emulator you prefer
- **esptool** — the Espressif flashing tool (we'll install it below)
- **mpremote** — the official MicroPython file-management and REPL tool

If you manage your Python packages with virtual environments (recommended on macOS to keep system Python clean), set one up first. If you are new to virtual environments, see [[dotfiles-beginner-guide|the Dotfiles Beginner Guide]] for tips on managing your shell environment:

```bash
python3 -m venv .venv
source .venv/bin/activate
```

Then install the tools:

```bash
pip install esptool mpremote
```

### Knowledge

- Basic comfort with the command line — navigating directories, running commands. If permissions errors come up, [[linux-permissions-beginner-guide|the Linux Permissions Beginner Guide]] covers how file permissions work.
- Basic Python knowledge — variables, functions, `if` statements, `for` loops. You do not need to be an expert.

## Key Concepts

Before touching hardware, let's clarify a few ideas that will come up repeatedly.

### MicroPython vs. Standard Python

MicroPython implements most of Python 3's syntax and many standard library modules, but it runs in kilobytes of RAM instead of gigabytes. Some differences:

- No `pip install` on the device — you copy library files manually
- Module names sometimes differ: `urequests` instead of `requests`, `ujson` instead of `json` (though recent firmware often aliases these)
- Memory is precious — you will learn to think about object sizes

### MicroPython vs. Arduino (C++)

| Aspect | Arduino C++ | MicroPython |
|--------|-------------|-------------|
| Edit-run cycle | Write → Compile → Upload → Test | Write → Run instantly in REPL |
| Language | C/C++ | Python |
| Performance | Very fast | Slower (interpreted), but plenty fast for most IoT tasks |
| Display libraries | TFT_eSPI (full-featured) | ST7789 drivers (simpler, fewer fonts) |
| Debugging | Serial.print() | Interactive REPL — inspect variables live |

### The REPL

REPL stands for Read-Eval-Print-Loop. When you connect to the TTGO T-Display over USB, you get a Python prompt (`>>>`) where you can type commands and see results immediately. This is the single biggest advantage of MicroPython for prototyping.

### boot.py and main.py

The ESP32 runs files in this order at startup:

1. **`boot.py`** — runs first, typically used for WiFi setup and configuration
2. **`main.py`** — runs second, your main application code
3. **REPL** — if `main.py` finishes (or doesn't exist), you get the interactive prompt

### GPIO (General Purpose Input/Output)

GPIO pins are the numbered connections on the board that can read sensors, control LEDs, or communicate with other devices. On the TTGO T-Display, the important ones are:

- **GPIO 35** — Button 1 (left button), active LOW (reads 0 when pressed)
- **GPIO 0** — Button 2 (right button), active LOW. Also the BOOT button for entering flash mode.
- **GPIO 34** — Battery voltage ADC (analog-to-digital converter)
- **GPIO 14** — Must be set HIGH to enable the battery ADC reading

## Step-by-Step Instructions

### Step 1: Verify the Device Is Connected

Plug the TTGO T-Display into your Mac via USB. Open a terminal and run:

```bash
ls /dev/cu.usbserial-*
```

**Expected output:**

```
/dev/cu.usbserial-01C8B207
```

The exact number will differ. If nothing appears, try a different USB cable (charge-only cables are extremely common) or a different USB port.

To confirm it's an ESP32:

```bash
esptool --port /dev/cu.usbserial-01C8B207 chip_id
```

**Expected output:**

```
esptool.py v4.x
Serial port /dev/cu.usbserial-01C8B207
Connecting....
Detecting chip type... ESP32
Chip is ESP32-D0WDQ6 (revision 1)
...
```

> **Tip:** Replace `/dev/cu.usbserial-01C8B207` with whatever your `ls` command showed. Throughout this tutorial, we'll use `PORT` as a shorthand — substitute your actual port.

### Step 2: Download MicroPython Firmware

Go to the official MicroPython downloads page for ESP32:

**https://micropython.org/download/esp32/**

Download the latest **stable** `.bin` file (not "nightly" or "preview"). At the time of writing, the file is named something like `ESP32_GENERIC-20260101-v1.25.0.bin`. Save it somewhere you can find it (e.g., `~/Downloads/`).

### Step 3: Erase the Existing Flash

Before flashing MicroPython, erase whatever firmware is currently on the device:

```bash
esptool --chip esp32 --port /dev/cu.usbserial-01C8B207 erase_flash
```

**Expected output:**

```
esptool.py v4.x
...
Erasing flash (this may take a while)...
Chip erase completed successfully in 3.2s
Hard resetting via RTS pin...
```

> **If the command hangs at "Connecting...":** The device needs to be put into bootloader mode. Hold the **right button** (GPIO 0 / BOOT) while pressing and releasing the small **RESET** button on the side of the board. Then release the BOOT button. The command should proceed.

### Step 4: Flash MicroPython

Now flash the firmware you downloaded:

```bash
esptool --chip esp32 --port /dev/cu.usbserial-01C8B207 --baud 460800 write_flash -z 0x1000 ~/Downloads/ESP32_GENERIC-20260101-v1.25.0.bin
```

**Expected output:**

```
esptool.py v4.x
...
Writing at 0x001a0000... (100 %)
Wrote 1568768 bytes (1030663 compressed) at 0x00001000 in 24.7 seconds
...
Hard resetting via RTS pin...
```

The device will restart automatically. MicroPython is now running!

### Step 5: Connect to the REPL

The simplest way to connect is with `mpremote`:

```bash
mpremote
```

**Expected output:**

```
Connected to MicroPython at /dev/cu.usbserial-01C8B207
Use Ctrl-] to exit this shell
>>>
```

You're now in a live Python session running on the ESP32. Try it:

```python
>>> print("Hello from ESP32!")
Hello from ESP32!
>>> 2 + 2
4
>>> import sys
>>> sys.platform
'esp32'
```

**Useful REPL shortcuts:**

- **Ctrl-C** — interrupt a running program
- **Ctrl-D** — soft reset (re-runs boot.py and main.py)
- **Ctrl-]** — exit mpremote (return to your Mac terminal)

> **Alternative: screen command.** If mpremote isn't working, you can use: `screen /dev/cu.usbserial-01C8B207 115200`. Exit screen with `Ctrl-A` then `K`, then `Y`.

### Step 6: Hello World on the Display

Now for the fun part — driving the built-in screen. First, you need the ST7789 display driver. The pure-Python driver by Russ Hughes works well for getting started.

Download the driver file (`st7789py.py`) from:
**https://github.com/russhughes/st7789py_mpy**

Copy it to the device using mpremote:

```bash
mpremote cp st7789py.py :st7789py.py
```

Now connect to the REPL and run this code to display "Hello World":

```python
>>> from machine import Pin, SPI
>>> import st7789py as st7789

>>> # Set up the SPI bus and display
>>> spi = SPI(1, baudrate=20000000, polarity=1,
...           sck=Pin(18), mosi=Pin(19), miso=Pin(-1))
>>> display = st7789.ST7789(spi, 135, 240,
...                         dc=Pin(16, Pin.OUT),
...                         cs=Pin(5, Pin.OUT),
...                         reset=Pin(23, Pin.OUT),
...                         backlight=Pin(4, Pin.OUT),
...                         rotation=1,
...                         options=0,
...                         buffer_size=0)

>>> # Turn on the backlight and clear screen
>>> display.init()

>>> # Fill screen with dark blue
>>> display.fill(st7789.color565(0, 0, 40))

>>> # Draw text (built-in font is 8x8 pixels)
>>> display.text(st7789.YELLOW, "Hello, TTGO!", 10, 60)
```

You should see yellow "Hello, TTGO!" text on a dark blue background. If the display is blank, double-check these common issues:

- **Backlight not on** — the backlight pin (GPIO 4) must be set HIGH
- **Wrong rotation** — try `rotation=0` or `rotation=3`
- **Display offset** — the ST7789 on this board has physical padding. Some drivers need `tfa=40, bfa=40` offset parameters

> **Understanding `color565`:** The display uses 16-bit color (RGB565). The function `color565(r, g, b)` takes values 0–255 for each channel and packs them into a 16-bit integer.

### Step 7: Set Up boot.py and main.py

Instead of typing code into the REPL every time, save your programs as files on the device.

Create a `boot.py` that connects to WiFi:

```python
# boot.py — runs at startup
import network
import time

SSID = "YourWiFiName"
PASSWORD = "YourWiFiPassword"

sta = network.WLAN(network.STA_IF)
sta.active(True)
if not sta.isconnected():
    print(f"Connecting to {SSID}...")
    sta.connect(SSID, PASSWORD)
    timeout = 10
    while not sta.isconnected() and timeout > 0:
        time.sleep(1)
        timeout -= 1

if sta.isconnected():
    print("Connected:", sta.ifconfig())
else:
    print("WiFi connection failed!")
```

Create a `main.py` that shows a message on the display:

```python
# main.py — main application
from machine import Pin, SPI
import st7789py as st7789
import network

# Initialize display
spi = SPI(1, baudrate=20000000, polarity=1,
          sck=Pin(18), mosi=Pin(19), miso=Pin(-1))
display = st7789.ST7789(spi, 135, 240,
                        dc=Pin(16, Pin.OUT),
                        cs=Pin(5, Pin.OUT),
                        reset=Pin(23, Pin.OUT),
                        backlight=Pin(4, Pin.OUT),
                        rotation=1,
                        options=0,
                        buffer_size=0)
display.init()
display.fill(st7789.color565(0, 0, 0))  # Black background

# Show WiFi status
sta = network.WLAN(network.STA_IF)
if sta.isconnected():
    ip = sta.ifconfig()[0]
    display.text(st7789.GREEN, "WiFi: Connected", 10, 20)
    display.text(st7789.WHITE, f"IP: {ip}", 10, 40)
else:
    display.text(st7789.RED, "WiFi: OFFLINE", 10, 20)

display.text(st7789.CYAN, "TTGO T-Display", 10, 80)
display.text(st7789.YELLOW, "MicroPython Ready", 10, 100)
```

Save these files to the device:

```bash
mpremote cp boot.py :boot.py
mpremote cp main.py :main.py
```

Press the RESET button on the device (or run `mpremote reset`). The board will restart, connect to WiFi, and display the status screen.

### Step 8: First Real Project — WiFi Status Dashboard

Let's enhance `main.py` into a proper status dashboard that reads battery voltage and responds to button presses:

```python
# main.py — WiFi Status Dashboard
from machine import Pin, SPI, ADC
import st7789py as st7789
import network
import time

# ── Display setup ──
spi = SPI(1, baudrate=20000000, polarity=1,
          sck=Pin(18), mosi=Pin(19), miso=Pin(-1))
display = st7789.ST7789(spi, 135, 240,
                        dc=Pin(16, Pin.OUT),
                        cs=Pin(5, Pin.OUT),
                        reset=Pin(23, Pin.OUT),
                        backlight=Pin(4, Pin.OUT),
                        rotation=1,
                        options=0,
                        buffer_size=0)
display.init()

# ── Battery ADC setup ──
# GPIO 14 must be HIGH to enable the battery voltage divider
adc_enable = Pin(14, Pin.OUT, value=1)
battery_adc = ADC(Pin(34))
battery_adc.atten(ADC.ATTN_11DB)  # Full range: 0-3.3V

# ── Button setup ──
button1 = Pin(35, Pin.IN)  # Left button, active LOW
button2 = Pin(0, Pin.IN, Pin.PULL_UP)  # Right button, active LOW

# ── Helper: read battery voltage ──
def read_battery_voltage():
    raw = battery_adc.read()
    # The voltage divider halves the battery voltage
    # ADC range is 0-4095 for 0-3.3V
    voltage = (raw / 4095) * 3.3 * 2
    return voltage

# ── Helper: draw the dashboard ──
def draw_dashboard():
    display.fill(st7789.color565(0, 0, 0))

    # WiFi status
    sta = network.WLAN(network.STA_IF)
    if sta.isconnected():
        ip = sta.ifconfig()[0]
        rssi = sta.status('rssi')
        display.text(st7789.GREEN, "WiFi: Connected", 10, 10)
        display.text(st7789.WHITE, f"IP: {ip}", 10, 30)
        display.text(st7789.WHITE, f"Signal: {rssi} dBm", 10, 50)
    else:
        display.text(st7789.RED, "WiFi: OFFLINE", 10, 10)

    # Battery voltage
    voltage = read_battery_voltage()
    color = st7789.GREEN if voltage > 3.7 else st7789.YELLOW if voltage > 3.4 else st7789.RED
    display.text(color, f"Battery: {voltage:.2f}V", 10, 80)

    # Timestamp
    display.text(st7789.CYAN, "Press BTN1 to refresh", 10, 110)

# ── Main loop ──
draw_dashboard()
while True:
    if button1.value() == 0:  # Button pressed (active LOW)
        draw_dashboard()
        time.sleep(0.3)  # Simple debounce
    time.sleep(0.1)
```

Upload it:

```bash
mpremote cp main.py :main.py
mpremote reset
```

You now have a live dashboard showing WiFi info, signal strength, and battery voltage. Pressing the left button refreshes the display.

## Practical Examples

### Example 1: Color Fill Patterns

Cycle through colors to test the display:

```python
import time
import st7789py as st7789

colors = [
    ("Red",    st7789.color565(255, 0, 0)),
    ("Green",  st7789.color565(0, 255, 0)),
    ("Blue",   st7789.color565(0, 0, 255)),
    ("White",  st7789.color565(255, 255, 255)),
    ("Yellow", st7789.color565(255, 255, 0)),
]

for name, color in colors:
    display.fill(color)
    display.text(st7789.BLACK, name, 100, 60)
    time.sleep(1)
```

### Example 2: Reading the On-Chip Temperature

The ESP32 has a built-in temperature sensor (it reads the die temperature, not ambient):

```python
import esp32

temp_f = esp32.raw_temperature()  # Fahrenheit
temp_c = (temp_f - 32) * 5 / 9
print(f"Chip temperature: {temp_c:.1f}°C ({temp_f}°F)")
```

**Expected output:**

```
Chip temperature: 53.3°C (128°F)
```

### Example 3: Scan for WiFi Networks

```python
import network

sta = network.WLAN(network.STA_IF)
sta.active(True)
networks = sta.scan()

for ssid, bssid, channel, rssi, authmode, hidden in networks:
    print(f"  {ssid.decode():30s} ch:{channel:2d}  rssi:{rssi}dBm")
```

### Example 4: Simple HTTP GET Request

```python
import urequests

response = urequests.get("http://httpbin.org/ip")
print(response.json())
response.close()
```

**Expected output:**

```
{'origin': '203.0.113.42'}
```

## Hands-On Exercises

### Exercise 1: Custom Splash Screen

Create a splash screen that shows your name in large text (draw each character at a larger scale by filling rectangles) with a colored background. Display it for 3 seconds when the board boots.

**Hint:** Use `display.fill_rect(x, y, width, height, color)` to draw blocks that form letters.

### Exercise 2: Button Counter

Write a program that displays a counter on screen. Pressing Button 1 (GPIO 35) increments the counter, pressing Button 2 (GPIO 0) resets it to zero. Add debounce logic so a single press doesn't count twice.

**Hint:** Read the button, wait 50ms, read again — if still pressed, it's a real press.

### Exercise 3: WiFi Signal Strength Monitor

Create a continuously-updating display that shows WiFi signal strength (RSSI) as both a number and a simple bar graph. Update once per second. Change the bar color from green to yellow to red as the signal degrades.

### Exercise 4: Temperature Logger

Read the ESP32's internal temperature every 10 seconds and store readings in a list. After collecting 10 readings, display the minimum, maximum, and average on screen. This teaches you about memory management on a constrained device.

## Troubleshooting

### "Connecting..." hangs during flash

The device is not in bootloader mode. Hold the **BOOT button** (right button, GPIO 0) while pressing and releasing the **RESET** button, then release BOOT.

### Device not appearing as /dev/cu.usbserial-*

- Try a different USB cable — charge-only cables are extremely common
- Try a different USB port
- On macOS, you may need the CP2104 or CH9102 USB-serial driver. Check System Information → USB to see if the device enumerates at all.

### Display stays blank after running code

- Check that backlight pin (GPIO 4) is set as output and HIGH
- Verify SPI pin assignments: SCLK=18, MOSI=19, DC=16, CS=5, RST=23
- Try different `rotation` values (0, 1, 2, 3)
- Some driver versions need `tfa=40, bfa=40` for the display offset

### main.py crash loop — can't access REPL

If `main.py` has a bug that crashes and restarts repeatedly, you can't get to the REPL. To break out:

1. Open your terminal with `mpremote` (or `screen`)
2. Press **Ctrl-C** rapidly during the brief moment between reboots
3. If that doesn't work: hold **BOOT** during reset, then use `mpremote rm :main.py` to delete the file

### ImportError: no module named 'st7789py'

The driver file hasn't been copied to the device. Run:

```bash
mpremote cp st7789py.py :st7789py.py
```

### MemoryError

The ESP32 has limited RAM (~110KB usable in MicroPython). Common fixes:

- Use `gc.collect()` before large allocations
- Avoid loading large strings or data structures
- Use smaller display buffers

## Related Tutorials

- [[dotfiles-beginner-guide|Dotfiles Beginner Guide]] — setting up your shell environment and virtual environments on macOS
- [[dotfiles-deep-dive|Dotfiles Deep Dive]] — advanced shell configuration and tool management
- [[linux-permissions-beginner-guide|Linux Permissions Beginner Guide]] — understanding file permissions when working with serial devices
- [[linux-permissions-deep-dive|Linux Permissions Deep Dive]] — device files, udev rules, and serial port access
- [[mosh-beginner-guide|Mosh Beginner Guide]] — remote access to headless devices over unreliable connections
- [[mosh-deep-dive|Mosh Deep Dive]] — persistent remote sessions for long-running IoT projects
- [[just-beginner-guide|Just Beginner Guide]] — automating repetitive flash/upload/connect commands with a justfile
- [[micropython-ttgo-t-display-deep-dive|MicroPython TTGO T-Display Deep Dive]] — advanced topics including custom firmware, C drivers, MQTT, deep sleep, and memory optimization

## References

- [MicroPython Official Documentation](https://docs.micropython.org/en/latest/)
- [MicroPython ESP32 Quick Reference](https://docs.micropython.org/en/latest/esp32/quickref.html)
- [MicroPython ESP32 Tutorial](https://docs.micropython.org/en/latest/esp32/tutorial/intro.html)
- [mpremote Documentation](https://docs.micropython.org/en/latest/reference/mpremote.html)
- [esptool Documentation](https://docs.espressif.com/projects/esptool/en/release-v4/esp32/esptool/basic-commands.html)
- [Russ Hughes ST7789 Pure Python Driver](https://github.com/russhughes/st7789py_mpy)
- [TTGO T-Display MicroPython Community Guide](https://github.com/Opinion/LILYGO-T-Display-ESP32-16MB-Micropython-guide)
- [Thonny IDE (beginner-friendly MicroPython editor)](https://thonny.org)
- [Random Nerd Tutorials: MicroPython on ESP32](https://randomnerdtutorials.com/flashing-micropython-firmware-esptool-py-esp32-esp8266/)

## Summary

You've gone from an empty TTGO T-Display to a working MicroPython environment with a live WiFi status dashboard. Here's what you accomplished:

1. Installed `esptool` and `mpremote` in a Python virtual environment
2. Erased and flashed MicroPython firmware onto the ESP32
3. Connected to the REPL and ran interactive Python on the device
4. Installed the ST7789 display driver and drew text on screen
5. Set up `boot.py` for WiFi and `main.py` for your application
6. Built a dashboard showing WiFi status, signal strength, and battery voltage

**Suggested next steps:**

- Read the [[micropython-ttgo-t-display-deep-dive|Deep Dive Reference]] to learn about custom firmware with faster C display drivers, MQTT for IoT, deep sleep for battery life, and memory optimization
- Try connecting an I2C sensor (like a BME280 temperature/humidity sensor) to GPIO 21/22 and displaying its readings
- Explore the `mpremote mount` command to edit files on your Mac and have them run on the device in real-time — no copy step needed
- Build a clock display that syncs time via NTP over WiFi
# Related Tutorials

- [[ttgo-display-beginner-guide|TTGO Display Projects Beginner Guide]] — hands-on display projects including WiFi dashboard, countdown timer, and multi-page apps
- [[ttgo-display-deep-dive|TTGO Display Projects Deep Dive]] — advanced display techniques, C driver migration, MQTT, deep sleep, and production patterns

- [[circuitpython-beginner-guide|CircuitPython Beginner Guide]] — Adafruit's beginner-friendly MicroPython fork for RP2040/RP2350 boards
- [[circuitpython-deep-dive|CircuitPython Deep Dive]] — advanced CircuitPython topics including displayio, PIO, and USB HID
