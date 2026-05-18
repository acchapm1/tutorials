---
title: "CircuitPython — Beginner's Guide"
date: 2026-05-18
difficulty: beginner
tags: [circuitpython, python, microcontroller, rp2040, rp2350, adafruit, embedded, hardware]
---

# CircuitPython — Beginner's Guide

## Overview

CircuitPython is Adafruit's beginner-friendly fork of [[micropython-ttgo-t-display-beginner-guide|MicroPython]] designed to make programming microcontrollers as simple as editing a text file. When you plug in a CircuitPython board, it appears as a USB drive on your computer. You write Python code, save the file, and the board runs it immediately — no compiler, no flashing tool, no IDE required.

This guide walks you through everything you need to go from unboxing an RP2040 or RP2350 board to blinking LEDs, reading sensors over I2C, driving displays, and building your first interactive project. By the end you will understand the CircuitPython workflow, know how to install libraries, and have several working examples running on real hardware.

CircuitPython supports over 650 boards and ships with 500+ community-maintained libraries covering sensors, displays, motors, communication protocols, and more.

## Prerequisites

Before you start, make sure you have:

- **A supported board** — this guide focuses on the RP2040 (e.g., Raspberry Pi Pico, Seeed XIAO RP2040) and RP2350 (e.g., Adafruit Feather RP2350). Any CircuitPython-compatible board will work.
- **A USB cable** — USB-C or micro-USB depending on your board. Must be a data cable, not charge-only.
- **A computer** — macOS, Windows, or Linux. No special software needed — just a text editor and a file manager.
- **A text editor** — anything works (VS Code, Sublime Text, Thonny, or even TextEdit/Notepad). The Mu Editor is popular with beginners because it has a built-in serial console.
- **Basic Python knowledge** — variables, loops, functions, and `import` statements. You do not need embedded systems experience.

## Key Concepts

### How CircuitPython differs from regular Python

CircuitPython is a subset of Python 3 that runs directly on microcontroller hardware. It does not have the full standard library (no `os.path`, no `requests`, no `pip`), but it adds hardware-specific modules like `board`, `digitalio`, `analogio`, and `busio` that let you control pins, read sensors, and drive peripherals.

### The CIRCUITPY drive

When a board running CircuitPython is plugged into USB, it mounts as a drive called `CIRCUITPY`. This drive contains:

```
CIRCUITPY/
  code.py        # Your main program — runs automatically on boot
  boot.py        # Optional — runs before code.py, configures USB/storage
  lib/           # Third-party libraries go here
  settings.toml  # WiFi credentials and other config (CP 8.x+)
```

CircuitPython watches `code.py`. Every time you save changes, the board automatically reloads and runs the new code.

### Libraries and the Adafruit Bundle

CircuitPython's built-in modules cover the basics (GPIO, I2C, SPI, PWM). For specific hardware — sensors, displays, NeoPixels — you install libraries by copying files into the `lib/` folder on the CIRCUITPY drive.

Adafruit maintains the **CircuitPython Library Bundle**, a zip file containing every community library compiled as `.mpy` files (pre-compiled bytecode, smaller than `.py` source). You download the bundle matching your CircuitPython version and copy only the libraries you need.

### The REPL

CircuitPython includes an interactive REPL (Read-Eval-Print Loop) accessible over the USB serial connection. You can use it to test one-liners, inspect pin states, and debug interactively. Connect with any serial terminal at 115200 baud, or use Mu Editor's built-in serial panel.

### RP2040 vs RP2350

Both chips are made by Raspberry Pi and are excellent CircuitPython targets:

| Feature | RP2040 | RP2350 |
|---|---|---|
| CPU | Dual Cortex-M0+ @ 133 MHz | Dual Cortex-M33 @ 150 MHz |
| RAM | 264 KB | 520 KB |
| Flash | External (typically 2–16 MB) | External (typically 8–16 MB) |
| USB | 1.1 | 1.1 |
| PIO state machines | 8 (2 blocks of 4) | 12 (3 blocks of 4) |
| FPU | No | Yes (hardware floating point) |
| Price | ~$4–12 | ~$7–15 |

The RP2350's extra RAM, faster clock, and hardware FPU make it noticeably snappier in CircuitPython — especially for display-heavy projects. Your CircuitPython code is identical on both chips; only the `.uf2` firmware file differs.

## Step-by-Step Instructions

### Step 1: Download CircuitPython firmware

1. Go to [circuitpython.org/downloads](https://circuitpython.org/downloads).
2. Search for your board (e.g., "Feather RP2350" or "Raspberry Pi Pico").
3. Download the latest stable `.uf2` file. As of this writing, that is CircuitPython 10.x.

### Step 2: Flash CircuitPython onto the board

1. **Enter bootloader mode:**
   - Hold the **BOOT** (or **BOOTSEL**) button on your board.
   - While holding, plug the USB cable into your computer.
   - Release the button. A new drive called `RPI-RP2` (or similar) appears.

2. **Copy the firmware:**
   - Drag the `.uf2` file onto the `RPI-RP2` drive.
   - The board reboots automatically. The `RPI-RP2` drive disappears and a new drive called `CIRCUITPY` appears.

```
# On macOS, you can also use the terminal:
cp adafruit-circuitpython-feather_rp2350-en_US-10.1.3.uf2 /Volumes/RPI-RP2/
```

Expected result: the `CIRCUITPY` drive mounts with a default `code.py` and a `lib/` folder.

### Step 3: Write your first program — Blink

Open `code.py` on the `CIRCUITPY` drive in your text editor and replace its contents:

```python
import board
import digitalio
import time

led = digitalio.DigitalInOut(board.LED)
led.direction = digitalio.Direction.OUTPUT

while True:
    led.value = True
    time.sleep(0.5)
    led.value = False
    time.sleep(0.5)
```

Save the file. The board reloads automatically and the onboard LED starts blinking.

**What each line does:**

- `board` — provides named references to the board's pins (`board.LED`, `board.D5`, `board.SDA`, etc.)
- `digitalio` — lets you configure pins as inputs or outputs
- `led.value = True` — sets the pin HIGH (3.3 V), turning the LED on

### Step 4: Connect to the serial console

The serial console lets you see `print()` output and error messages from your code.

**Using Mu Editor:** Click the "Serial" button at the top.

**Using the terminal (macOS):**

```bash
# Find the serial device
ls /dev/tty.usbmodem*

# Connect (press Ctrl-C to interrupt running code, Ctrl-D to reload)
screen /dev/tty.usbmodem14101 115200
```

**Using the terminal (Linux):**

```bash
ls /dev/ttyACM*
screen /dev/ttyACM0 115200
```

Expected output from the blink program: nothing printed, but pressing Ctrl-C drops you into the REPL:

```
Press any key to enter the REPL. Use CTRL-D to reload.

Adafruit CircuitPython 10.1.3 on 2026-02-18; Adafruit Feather RP2350 with rp2350a
>>> 
```

### Step 5: Install libraries

1. Go to [circuitpython.org/libraries](https://circuitpython.org/libraries).
2. Download the **Bundle for Version 10.x** (match your CircuitPython major version).
3. Unzip the bundle on your computer.
4. Copy only the libraries you need from `lib/` in the bundle to `CIRCUITPY/lib/`.

For example, to use a NeoPixel strip:

```bash
# Copy the neopixel library
cp -r adafruit-circuitpython-bundle-10.x/lib/neopixel.mpy /Volumes/CIRCUITPY/lib/
```

Alternatively, use `circup` — a command-line tool that manages libraries automatically:

```bash
pip install circup
circup install neopixel
```

`circup` detects your board, checks which libraries are installed, and copies the correct versions.

### Step 6: Read a sensor over I2C

I2C is the most common way to talk to sensors and displays in CircuitPython. Here is how to scan for connected devices:

```python
import board
import busio

i2c = busio.I2C(board.SCL, board.SDA)

while not i2c.try_lock():
    pass

devices = i2c.scan()
print("I2C devices found:", [hex(d) for d in devices])
i2c.unlock()
```

Expected output (with an SSD1306 OLED and AS5600 sensor connected):

```
I2C devices found: ['0x36', '0x3c']
```

Once you know the address, install the appropriate library and use its driver. For example, reading temperature from a BME280:

```python
import board
import busio
import adafruit_bme280

i2c = busio.I2C(board.SCL, board.SDA)
bme = adafruit_bme280.Adafruit_BME280_I2C(i2c)

print(f"Temperature: {bme.temperature:.1f} C")
print(f"Humidity: {bme.humidity:.1f} %")
print(f"Pressure: {bme.pressure:.1f} hPa")
```

### Step 7: Drive NeoPixels

NeoPixels (WS2812B addressable RGB LEDs) are one of CircuitPython's strengths. After copying `neopixel.mpy` to `lib/`:

```python
import board
import neopixel
import time

# 8 NeoPixels on pin D5, auto_write=False for manual updates
pixels = neopixel.NeoPixel(board.D5, 8, brightness=0.3, auto_write=False)

while True:
    for i in range(8):
        pixels.fill((0, 0, 0))       # All off
        pixels[i] = (255, 0, 0)      # Red chase
        pixels.show()
        time.sleep(0.1)
```

Expected result: a red LED chases across the strip in a loop.

## Practical Examples

### Example 1: Button-controlled LED

Wire a tactile button between a GPIO pin and GND. CircuitPython's internal pull-up resistor means no external resistor is needed.

```python
import board
import digitalio

led = digitalio.DigitalInOut(board.LED)
led.direction = digitalio.Direction.OUTPUT

button = digitalio.DigitalInOut(board.D5)
button.direction = digitalio.Direction.INPUT
button.pull = digitalio.Pull.UP  # Internal pull-up; button connects to GND

while True:
    led.value = not button.value  # Button pressed = pin LOW = LED on
```

### Example 2: Analog light sensor

Read a photoresistor (or any analog sensor) connected to an analog-capable pin:

```python
import board
import analogio
import time

light = analogio.AnalogIn(board.A0)

while True:
    raw = light.value            # 0–65535 (16-bit)
    voltage = raw * 3.3 / 65535
    print(f"Raw: {raw}  Voltage: {voltage:.2f} V")
    time.sleep(0.5)
```

Expected output:

```
Raw: 42310  Voltage: 2.13 V
Raw: 38122  Voltage: 1.92 V
Raw: 51200  Voltage: 2.58 V
```

### Example 3: OLED display with SSD1306

After installing `adafruit_ssd1306` and `adafruit_framebuf` libraries:

```python
import board
import busio
import adafruit_ssd1306

i2c = busio.I2C(board.SCL, board.SDA)
oled = adafruit_ssd1306.SSD1306_I2C(128, 64, i2c)

oled.fill(0)
oled.text("Hello, CircuitPython!", 0, 0, 1)
oled.text("RP2350 is fast!", 0, 16, 1)
oled.show()
```

### Example 4: PWM for servo control

```python
import board
import pwmio
import time

servo = pwmio.PWMOut(board.D9, frequency=50, duty_cycle=0)

def set_angle(angle):
    # Map 0-180 degrees to 1ms-2ms pulse (out of 20ms period)
    pulse_ms = 1.0 + (angle / 180.0)
    duty = int((pulse_ms / 20.0) * 65535)
    servo.duty_cycle = duty

while True:
    set_angle(0)
    time.sleep(1)
    set_angle(90)
    time.sleep(1)
    set_angle(180)
    time.sleep(1)
```

## Hands-On Exercises

### Exercise 1: Traffic light

Using three LEDs (red, yellow, green) wired to three GPIO pins, write a program that cycles through a realistic traffic light sequence: green for 5 seconds, yellow for 2 seconds, red for 5 seconds. Add `print()` statements so you can see the state changes in the serial console.

### Exercise 2: Temperature logger

Connect a BME280 or BMP280 sensor over I2C. Write a program that reads the temperature every 10 seconds and appends each reading with a timestamp (use `time.monotonic()`) to a file on the CIRCUITPY drive. Hint: you will need to configure `boot.py` to make the filesystem writable by CircuitPython (by default, CircuitPython code cannot write to CIRCUITPY — only the USB host can).

### Exercise 3: NeoPixel color mixer

Wire three potentiometers to A0, A1, and A2. Map each analog reading (0–65535) to a 0–255 color channel (R, G, B). Display the mixed color on a NeoPixel strip and print the hex color code to the serial console.

### Exercise 4: I2C device scanner with display

Combine the I2C scan code with the SSD1306 OLED example. Write a program that scans the I2C bus every 2 seconds and displays the list of found addresses on the OLED screen. This is a handy bench tool for debugging wiring.

## Troubleshooting

### Board does not appear as CIRCUITPY after flashing

- Make sure you used the correct `.uf2` file for your specific board. A Feather RP2350 `.uf2` will not work on a Pico.
- Try double-pressing the reset button rapidly to force the board back into bootloader mode (`RPI-RP2`).
- Ensure your USB cable supports data transfer — many cables are charge-only.

### ImportError: no module named 'adafruit_xxx'

The library is missing from `CIRCUITPY/lib/`. Download the matching bundle version and copy the required `.mpy` file or folder into `lib/`.

### MemoryError or "not enough memory"

The RP2040 has only 264 KB of RAM. Large libraries and complex programs can exhaust it.
- Use `.mpy` (pre-compiled) files instead of `.py` source files in `lib/`.
- Reduce `neopixel` pixel count or display buffer size.
- On the RP2350, you get 520 KB — nearly double — which helps significantly.

### Code does not auto-reload when saved

- On macOS, some editors (like VS Code) write temporary files before renaming. This can confuse the auto-reload. Try saving twice, or use Mu Editor which handles this correctly.
- Pressing Ctrl-D in the serial console forces a manual reload.

### Serial console shows `safe mode` message

CircuitPython entered safe mode because the previous code crashed hard (e.g., infinite loop consuming all memory). The CIRCUITPY drive still mounts so you can fix the code. After editing, press Ctrl-D or press the reset button.

### CIRCUITPY drive is read-only

By default, when USB is connected, the computer has write access and CircuitPython code cannot write to the filesystem. To let your code write files (for data logging), create a `boot.py`:

```python
import storage
storage.remount("/", readonly=False)
```

**Warning:** This makes the drive read-only to your computer. To edit code again, delete `boot.py` by entering bootloader mode or holding a button during boot to bypass it.

## References

- [CircuitPython Official Site](https://circuitpython.org/) — downloads, board list, library bundles
- [CircuitPython Documentation](https://docs.circuitpython.org/en/latest/) — API reference for all built-in modules
- [Adafruit Learning System](https://learn.adafruit.com/) — hundreds of project guides with CircuitPython code
- [Getting Started with Raspberry Pi Pico and CircuitPython](https://learn.adafruit.com/getting-started-with-raspberry-pi-pico-circuitpython/overview) — Adafruit's official Pico starter guide
- [Adafruit Feather RP2350 Guide](https://learn.adafruit.com/adafruit-feather-rp2350) — setup, pinout, and library info
- [circuitpython-tricks (todbot)](https://github.com/todbot/circuitpython-tricks) — community collection of useful patterns and snippets
- [circup](https://github.com/adafruit/circup) — command-line library manager
- [Mu Editor](https://codewith.mu/) — beginner-friendly editor with built-in serial console

## Related Tutorials

- [[micropython-ttgo-t-display-beginner-guide|MicroPython TTGO T-Display Beginner Guide]] — compare CircuitPython with its parent project MicroPython
- [[micropython-ttgo-t-display-deep-dive|MicroPython TTGO T-Display Deep Dive]] — advanced MicroPython patterns on similar hardware
- [[ttgo-display-beginner-guide|TTGO Display Beginner Guide]] — another microcontroller display project
- [[ttgo-display-deep-dive|TTGO Display Deep Dive]] — deep dive into TTGO display hardware
- [[circuitpython-deep-dive|CircuitPython Deep Dive]] — advanced CircuitPython topics, internals, and performance tuning

## Summary

You now know how to flash CircuitPython onto an RP2040 or RP2350 board, write and auto-reload Python code via the CIRCUITPY USB drive, install libraries from the Adafruit bundle, and work with GPIO, I2C sensors, NeoPixels, and displays. The edit-save-run workflow makes CircuitPython one of the fastest ways to prototype hardware projects.

**Next steps:**

- Work through the hands-on exercises above to solidify the basics.
- Read the [[circuitpython-deep-dive|CircuitPython Deep Dive]] for advanced topics like `displayio`, PIO, power management, and custom board definitions.
- Browse the [Adafruit Learning System](https://learn.adafruit.com/) for project ideas that match your hardware.
- Explore the `settings.toml` file for WiFi-enabled boards (RP2040-W, ESP32-S3) to add network connectivity to your projects.
