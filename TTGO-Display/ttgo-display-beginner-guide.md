---
title: "Driving the TTGO T-Display: Beginner's Guide to MicroPython Display Projects"
date: 2026-04-27
difficulty: beginner
tags:
  - micropython
  - esp32
  - ttgo-t-display
  - st7789
  - display
  - iot
  - embedded
  - projects
---

# Driving the TTGO T-Display: Beginner's Guide to MicroPython Display Projects

## Overview

The ST7789 is a powerful display driver that powers the small 240x135 pixel screen on the TTGO T-Display. Unlike LEDs that can only show one color, this full-color display lets you show text, graphics, and complex dashboards on your ESP32 device.

In this tutorial, you'll learn to:
- Initialize the display and control the backlight
- Draw text and typography with proper centering
- Use drawing primitives (lines, rectangles, circles) to create layouts
- Build a WiFi information dashboard
- Create a countdown timer with NTP time synchronization
- Organize a multi-page application with button navigation

This tutorial **builds on** [[micropython-ttgo-t-display-beginner-guide|MicroPython TTGO T-Display Beginner Guide]] where you'll have already flashed MicroPython and learned the basics. If you haven't done that yet, start there first!

Display projects are incredibly rewarding because you get **instant visual feedback**. Every line you draw, every pixel you light up is visible immediately. Whether you're building a home automation controller, a weather station, or a retro game, the display is your window into what your device is doing.

---

## Prerequisites

Before starting this tutorial, you need:

1. **MicroPython installed and REPL accessible** — Follow [[micropython-ttgo-t-display-beginner-guide]] to flash MicroPython and verify you can connect via `mpremote repl`
2. **ST7789 driver installed** — Run this in your local terminal (not the REPL):
   ```bash
   mpremote mip install github:russhughes/st7789py_mpy
   ```
   This downloads the pure Python ST7789 driver to your device.
3. **Basic Python knowledge** — You should be comfortable with variables, functions, and loops
4. **WiFi credentials** (optional, for the WiFi dashboard example) — You'll need your SSID and password

---

## Key Concepts

### RGB565 Color Format

The ST7789 uses **RGB565** color encoding — a 16-bit format that packs colors into just 2 bytes:
- **5 bits for Red** (0-31)
- **6 bits for Green** (0-63) — green gets an extra bit because human eyes are more sensitive to green
- **5 bits for Blue** (0-31)

Instead of writing out the bit-by-bit conversion every time, we define colors as hex constants:

```python
# Some common RGB565 color constants
BLACK = st7789.color565(0, 0, 0)          # 0x0000
WHITE = st7789.color565(255, 255, 255)    # 0xFFFF
RED = st7789.color565(255, 0, 0)          # 0xF800
GREEN = st7789.color565(0, 255, 0)        # 0x07E0
BLUE = st7789.color565(0, 0, 255)         # 0x001F
CYAN = st7789.color565(0, 255, 255)       # 0x07FF
MAGENTA = st7789.color565(255, 0, 255)    # 0xF81F
YELLOW = st7789.color565(255, 255, 0)     # 0xFFE0
ORANGE = st7789.color565(255, 165, 0)     # 0xFD20
GRAY = st7789.color565(128, 128, 128)     # 0x8410
LIGHT_GRAY = st7789.color565(192, 192, 192) # 0xC618
```

The `st7789.color565(r, g, b)` function converts 0-255 RGB values into the proper 16-bit format. You can define your own palette at the top of your script!

### SPI Communication

The display communicates via **SPI (Serial Peripheral Interface)**, which is a fast protocol for talking to external hardware:

- **MOSI (Pin 19)**: "Master Out, Slave In" — the data line *to* the display
- **SCLK (Pin 18)**: "Serial Clock" — synchronizes timing
- **CS (Pin 5)**: "Chip Select" — tells the display "I'm talking to you"
- **DC (Pin 16)**: "Data/Command" — tells the display "this is a command" vs "this is pixel data"

You don't need to understand SPI deeply; the st7789 driver handles all the bit-twiddling for you. Just remember: these pins must be connected correctly or the display won't respond.

### Display Offsets (tfa and bfa)

The ST7789 controller is designed for larger displays. The **TTGO T-Display's physical display has black padding** around the 240x135 pixel area:
- **tfa=40** (Top Fixed Area) — skip the first 40 rows
- **bfa=40** (Bottom Fixed Area) — skip the last 40 rows

**This is critical:** If you forget these offsets, your image will shift vertically by 80 pixels and part of it will be cut off. The spec sheet requires `tfa=40, bfa=40`.

### Rotation

The display can be rotated:
- **rotation=1** → 240x135 horizontal (landscape, the comfortable way to hold it)
- **rotation=0** → 135x240 vertical (portrait)

All examples in this tutorial use `rotation=1` (landscape).

### Backlight Control

The backlight (Pin 4) is **active HIGH**, meaning:
- `Pin(4, Pin.OUT).value(1)` → backlight **ON** (bright)
- `Pin(4, Pin.OUT).value(0)` → backlight **OFF** (dark)

You can also use PWM to dim the backlight for power saving or fancy effects.

### Partial Redraws vs Full Clears

**Important performance tip:** Every time you call `display.fill()` or `display.fill_rect()` with a color, the entire region is redrawn. This causes **flicker** if you're updating the screen rapidly.

For smooth updates, redraw only the parts that changed. For example, if you're updating a timer every second, only redraw the timer area, not the whole screen.

---

## Step-by-Step Instructions

### Section 1: Display Setup and Initialization

Every display project starts with the same boilerplate: initialize SPI, create the ST7789 object, and set the backlight.

Create a new file `main.py` on your device:

```python
from machine import Pin, SPI
import st7789

# SPI setup
spi = SPI(2, baudrate=40000000, polarity=0, phase=0, 
          sck=Pin(18), mosi=Pin(19), miso=Pin(16))

# ST7789 display setup
display = st7789.ST7789(
    spi,
    240,           # width
    135,           # height
    reset=Pin(23, Pin.OUT),
    cs=Pin(5, Pin.OUT),
    dc=Pin(16, Pin.OUT),
    backlight=Pin(4, Pin.OUT),
    rotation=1,    # landscape (240x135)
    color_order=st7789.BGR,  # color byte order
    tfa=40,        # top fixed area (offset)
    bfa=40,        # bottom fixed area (offset)
)

# Turn on backlight
display.backlight(True)
```

**What's happening:**
1. SPI(2) uses the ESP32's **HSPI (SPI2)** bus, separate from the VSPI bus
2. `baudrate=40000000` = 40 MHz, the maximum for this display
3. `rotation=1` makes it landscape (240 wide, 135 tall)
4. `tfa=40, bfa=40` are the critical offsets!
5. `backlight(True)` turns on the LED backlight

**Test it:**
```python
# Clear to solid color
display.fill(st7789.color565(0, 0, 0))  # black

# Draw "Hello TTGO" centered
display.text("Hello TTGO", 100, 60, color=st7789.color565(255, 255, 255))
```

Expected output: Black screen with "Hello TTGO" in white text near the center.

**Complete Initialization Example:**

```python
from machine import Pin, SPI
import st7789

# Color palette
BLACK = 0x0000
WHITE = 0xFFFF
RED = st7789.color565(255, 0, 0)
GREEN = st7789.color565(0, 255, 0)
BLUE = st7789.color565(0, 0, 255)

# SPI setup
spi = SPI(2, baudrate=40000000, polarity=0, phase=0, 
          sck=Pin(18), mosi=Pin(19), miso=Pin(16))

# ST7789 display
display = st7789.ST7789(
    spi, 240, 135,
    reset=Pin(23, Pin.OUT),
    cs=Pin(5, Pin.OUT),
    dc=Pin(16, Pin.OUT),
    backlight=Pin(4, Pin.OUT),
    rotation=1,
    color_order=st7789.BGR,
    tfa=40, bfa=40,
)

# Backlight control
display.backlight(True)

# Clear to black and draw welcome message
display.fill(BLACK)
display.text("TTGO Display Ready!", 10, 60, color=WHITE)

print("Display initialized!")
```

Copy this into `main.py` and run `mpremote cp main.py :` then `mpremote repl` and `import main`. You should see the message on screen.

---

### Section 2: Text and Typography

The `display.text()` function draws text, but it has some quirks worth understanding.

**Basic text drawing:**
```python
display.text("Hello", x=10, y=20, color=WHITE)
```

Arguments:
- **x, y** — pixel coordinates of the **top-left corner** of the text
- **color** — RGB565 color value

**Centering text horizontally:**

Text has a width (roughly 6 pixels per character). To center text:

```python
text = "Centered Text"
char_width = 6  # approximate width in pixels
x = (240 - len(text) * char_width) // 2
display.text(text, x, 30, color=WHITE)
```

**Multi-line text with spacing:**

```python
lines = ["Line 1", "Line 2", "Line 3"]
line_height = 12  # pixels between lines
y = 20

for i, line in enumerate(lines):
    display.text(line, 10, y + i * line_height, color=WHITE)
```

**Complete Example: Dashboard Header**

```python
from machine import Pin, SPI
import st7789

# Colors
BLACK = 0x0000
WHITE = 0xFFFF
CYAN = st7789.color565(0, 255, 255)

# Initialize display
spi = SPI(2, baudrate=40000000, polarity=0, phase=0, 
          sck=Pin(18), mosi=Pin(19), miso=Pin(16))
display = st7789.ST7789(
    spi, 240, 135,
    reset=Pin(23, Pin.OUT), cs=Pin(5, Pin.OUT), dc=Pin(16, Pin.OUT),
    backlight=Pin(4, Pin.OUT), rotation=1, color_order=st7789.BGR,
    tfa=40, bfa=40,
)
display.backlight(True)

# Clear background
display.fill(BLACK)

# Draw centered title
title = "WiFi Monitor"
title_x = (240 - len(title) * 6) // 2
display.text(title, title_x, 10, color=CYAN)

# Draw horizontal divider line
display.hline(0, 25, 240, WHITE)

# Draw three data lines with labels
data = [
    ("SSID: MyNetwork", 40),
    ("IP: 192.168.1.100", 55),
    ("Signal: -50 dBm", 70),
]

for label, y in data:
    display.text(label, 10, y, color=WHITE)

print("Dashboard displayed!")
```

Expected output: A dashboard-style layout with a centered title, dividing line, and three lines of data.

---

### Section 3: Drawing Primitives

Beyond text, the ST7789 driver supports basic shapes. These are perfect for creating visual elements like bars, boxes, and layouts.

**Available functions:**
- `display.pixel(x, y, color)` — single pixel
- `display.hline(x, y, width, color)` — horizontal line
- `display.vline(x, y, height, color)` — vertical line
- `display.line(x0, y0, x1, y1, color)` — diagonal line
- `display.rect(x, y, width, height, color)` — hollow rectangle
- `display.fill_rect(x, y, width, height, color)` — filled rectangle
- `display.circle(x, y, radius, color)` — hollow circle (slow!)
- `display.fill_circle(x, y, radius, color)` — filled circle (slow!)
- `display.fill(color)` — fill entire screen

**Example: Simple Dashboard Layout**

```python
from machine import Pin, SPI
import st7789

BLACK = 0x0000
WHITE = 0xFFFF
GRAY = st7789.color565(64, 64, 64)
GREEN = st7789.color565(0, 255, 0)

spi = SPI(2, baudrate=40000000, polarity=0, phase=0, 
          sck=Pin(18), mosi=Pin(19), miso=Pin(16))
display = st7789.ST7789(
    spi, 240, 135,
    reset=Pin(23, Pin.OUT), cs=Pin(5, Pin.OUT), dc=Pin(16, Pin.OUT),
    backlight=Pin(4, Pin.OUT), rotation=1, color_order=st7789.BGR,
    tfa=40, bfa=40,
)
display.backlight(True)

# Clear screen
display.fill(BLACK)

# Header bar
display.fill_rect(0, 0, 240, 25, GRAY)
display.text("System Status", 80, 8, color=WHITE)

# Two data boxes side by side
# Left box
display.rect(5, 35, 110, 60, WHITE)
display.text("Temp", 10, 40, color=GREEN)
display.text("23.5 C", 15, 55, color=WHITE)

# Right box
display.rect(125, 35, 110, 60, WHITE)
display.text("Humidity", 130, 40, color=GREEN)
display.text("45%", 145, 55, color=WHITE)

# Divider line
display.vline(120, 35, 60, GRAY)

# Bottom progress bar
bar_width = int(150 * 0.65)  # 65% full
display.fill_rect(45, 110, bar_width, 8, GREEN)
display.rect(45, 110, 150, 8, WHITE)

print("Layout created!")
```

Expected output: A dashboard with header, two side-by-side boxes, and a progress bar at the bottom.

---

### Section 4: WiFi Info Display Project

Now let's build a real project! This displays your WiFi connection status with signal strength.

**Create `wifi_display.py`:**

```python
from machine import Pin, SPI
import st7789
import network
import utime

# Colors
BLACK = 0x0000
WHITE = 0xFFFF
GRAY = st7789.color565(64, 64, 64)
GREEN = st7789.color565(0, 255, 0)
ORANGE = st7789.color565(255, 165, 0)
RED = st7789.color565(255, 0, 0)

# WiFi credentials (change these!)
SSID = "YourSSID"
PASSWORD = "YourPassword"

# Initialize display
spi = SPI(2, baudrate=40000000, polarity=0, phase=0, 
          sck=Pin(18), mosi=Pin(19), miso=Pin(16))
display = st7789.ST7789(
    spi, 240, 135,
    reset=Pin(23, Pin.OUT), cs=Pin(5, Pin.OUT), dc=Pin(16, Pin.OUT),
    backlight=Pin(4, Pin.OUT), rotation=1, color_order=st7789.BGR,
    tfa=40, bfa=40,
)
display.backlight(True)

# Button setup (left button = refresh)
button_left = Pin(35, Pin.IN, Pin.PULL_UP)

def draw_signal_bars(x, y, rssi, color):
    """Draw WiFi signal strength as bars (0-4)"""
    # Map RSSI to bars: -100 dBm = 0 bars, -30 dBm = 4 bars
    bars = max(0, min(4, (rssi + 100) // 17))
    
    for i in range(4):
        bar_height = 4 + i * 3  # increasing height
        if i < bars:
            display.fill_rect(x + i * 6, y + 12 - bar_height, 4, bar_height, color)
        else:
            display.rect(x + i * 6, y + 12 - bar_height, 4, bar_height, color)

def connect_wifi():
    """Connect to WiFi with visual feedback"""
    display.fill(BLACK)
    display.text("Connecting...", 60, 60, color=WHITE)
    
    wlan = network.WLAN(network.STA_IF)
    wlan.active(True)
    wlan.connect(SSID, PASSWORD)
    
    # Wait up to 10 seconds
    for i in range(10):
        if wlan.isconnected():
            return wlan
        display.text(".", 140 + i * 5, 60, color=WHITE)
        utime.sleep(1)
    
    display.fill(BLACK)
    display.text("WiFi Failed!", 70, 60, color=RED)
    return None

def update_display(wlan):
    """Redraw WiFi info"""
    display.fill(BLACK)
    
    # Header
    display.fill_rect(0, 0, 240, 25, GRAY)
    display.text("WiFi Status", 80, 8, color=WHITE)
    
    # Connected status
    if wlan.isconnected():
        status = "Connected"
        status_color = GREEN
    else:
        status = "Disconnected"
        status_color = RED
    
    display.text(status, 10, 35, color=status_color)
    
    # SSID
    display.text("SSID: " + SSID, 10, 50, color=WHITE)
    
    # IP address
    if wlan.isconnected():
        ip = wlan.ifconfig()[0]
        display.text("IP: " + ip, 10, 65, color=WHITE)
    
    # Signal strength
    if wlan.isconnected():
        rssi = wlan.status('rssi')
        display.text("Signal:", 10, 80, color=WHITE)
        draw_signal_bars(80, 80, rssi, GREEN)
        display.text(str(rssi) + " dBm", 140, 80, color=WHITE)
    
    # Instructions
    display.text("Press button to refresh", 10, 110, color=GRAY)

# Main loop
wlan = connect_wifi()
if wlan:
    update_display(wlan)
    
    # Button handler
    button_pressed = False
    while True:
        if not button_left.value() and not button_pressed:  # button pressed (active LOW)
            button_pressed = True
            update_display(wlan)
            utime.sleep(0.3)  # debounce
        elif button_left.value():
            button_pressed = False
        
        utime.sleep(0.1)
```

**To use this:**
1. Edit `SSID` and `PASSWORD` with your WiFi details
2. Copy to device: `mpremote cp wifi_display.py :`
3. Run: `mpremote run wifi_display.py`

**Expected output:** WiFi connection status, signal bars, IP address displayed on screen. Pressing the left button refreshes the display.

---

### Section 5: Countdown Timer Project

A practical project: countdown to an event with NTP time synchronization.

**Create `countdown_timer.py`:**

```python
from machine import Pin, SPI, PWM
import st7789
import network
import utime
import ntptime

# Colors
BLACK = 0x0000
WHITE = 0xFFFF
GRAY = st7789.color565(64, 64, 64)
GREEN = st7789.color565(0, 255, 0)
BLUE = st7789.color565(0, 0, 255)

# WiFi credentials
SSID = "YourSSID"
PASSWORD = "YourPassword"

# Event details
EVENT_NAME = "Summer Vacation"
EVENT_TIMESTAMP = 1753689600  # Example: Jan 1, 2026 @ 00:00 UTC (replace with your date!)
TIMEZONE_OFFSET = 0  # hours from UTC (e.g., -5 for EST, 1 for CET)

# Initialize display
spi = SPI(2, baudrate=40000000, polarity=0, phase=0, 
          sck=Pin(18), mosi=Pin(19), miso=Pin(16))
display = st7789.ST7789(
    spi, 240, 135,
    reset=Pin(23, Pin.OUT), cs=Pin(5, Pin.OUT), dc=Pin(16, Pin.OUT),
    backlight=Pin(4, Pin.OUT), rotation=1, color_order=st7789.BGR,
    tfa=40, bfa=40,
)
display.backlight(True)

# Backlight brightness control (PWM)
backlight_pwm = PWM(Pin(4), freq=1000, duty=1023)

# Buttons
button_left = Pin(35, Pin.IN, Pin.PULL_UP)    # brightness
button_right = Pin(0, Pin.IN, Pin.PULL_UP)    # progress bar toggle

# State
brightness = 1023
show_progress = True

def connect_wifi():
    """Connect and sync NTP time"""
    wlan = network.WLAN(network.STA_IF)
    wlan.active(True)
    wlan.connect(SSID, PASSWORD)
    
    for _ in range(10):
        if wlan.isconnected():
            ntptime.settime()
            return True
        utime.sleep(1)
    
    return False

def format_countdown(seconds):
    """Format seconds as 'X days, HH:MM:SS'"""
    days = seconds // 86400
    hours = (seconds % 86400) // 3600
    minutes = (seconds % 3600) // 60
    secs = seconds % 60
    
    return f"{days}d {hours:02d}:{minutes:02d}:{secs:02d}"

def draw_progress_bar(x, y, width, height, percent):
    """Draw progress bar"""
    bar_width = int(width * percent / 100)
    display.fill_rect(x, y, bar_width, height, GREEN)
    display.rect(x, y, width, height, WHITE)

def update_display(current_time, brightness_val, show_bar):
    """Redraw timer"""
    display.fill(BLACK)
    
    # Header
    display.fill_rect(0, 0, 240, 25, GRAY)
    display.text("Countdown", 85, 8, color=WHITE)
    
    # Event name
    display.text(EVENT_NAME, 10, 35, color=BLUE)
    
    # Calculate time until event
    seconds_left = EVENT_TIMESTAMP - current_time
    
    if seconds_left > 0:
        countdown_str = format_countdown(seconds_left)
        
        # Large countdown text (centered)
        # Note: This is a simple approach; for prettier large text you'd use a font library
        x = (240 - len(countdown_str) * 6) // 2
        display.text(countdown_str, x, 60, color=GREEN)
        
        # Progress bar (if enabled)
        if show_bar:
            # Total time from now until event (for demo, assume 100 days)
            total_seconds = 100 * 86400
            progress = max(0, min(100, (1 - seconds_left / total_seconds) * 100))
            draw_progress_bar(20, 110, 200, 8, progress)
    else:
        display.text("Event is here!", 60, 60, color=GREEN)
    
    # Instructions
    display.text("L=bright  R=bar", 10, 125, color=GRAY)

# Connect and sync time
display.text("Syncing time...", 60, 60, color=WHITE)
if not connect_wifi():
    display.fill(BLACK)
    display.text("WiFi failed", 70, 60, color=WHITE)
    utime.sleep(3)

# Main loop
button_left_pressed = False
button_right_pressed = False

while True:
    current_time = utime.time() + TIMEZONE_OFFSET * 3600
    
    # Update brightness
    backlight_pwm.duty(brightness)
    
    # Redraw every second
    update_display(current_time, brightness, show_progress)
    
    # Left button: brightness up
    if not button_left.value() and not button_left_pressed:
        button_left_pressed = True
        brightness = min(1023, brightness + 100)
    elif button_left.value():
        button_left_pressed = False
    
    # Right button: toggle progress bar
    if not button_right.value() and not button_right_pressed:
        button_right_pressed = True
        show_progress = not show_progress
    elif button_right.value():
        button_right_pressed = False
    
    utime.sleep(1)
```

**To use:**
1. Update `SSID`, `PASSWORD`, `EVENT_NAME`, `EVENT_TIMESTAMP`
2. To find your event's Unix timestamp, use an online converter (search "Unix timestamp converter")
3. Copy: `mpremote cp countdown_timer.py :`
4. Run: `mpremote run countdown_timer.py`

**Expected output:** Large countdown display with event name, progress bar at bottom, buttons for brightness and progress bar toggle.

---

### Section 6: Two-Page Dashboard

Combine everything into a multi-page app with button navigation!

**Create `multi_page_dashboard.py`:**

```python
from machine import Pin, SPI
import st7789
import network
import utime
import ntptime

# Colors
BLACK = 0x0000
WHITE = 0xFFFF
GRAY = st7789.color565(64, 64, 64)
GREEN = st7789.color565(0, 255, 0)
BLUE = st7789.color565(0, 0, 255)
RED = st7789.color565(255, 0, 0)

# WiFi
SSID = "YourSSID"
PASSWORD = "YourPassword"

# Event
EVENT_NAME = "New Year 2027"
EVENT_TIMESTAMP = 1799990400  # Jan 1, 2027
TIMEZONE_OFFSET = 0

# Initialize display
spi = SPI(2, baudrate=40000000, polarity=0, phase=0, 
          sck=Pin(18), mosi=Pin(19), miso=Pin(16))
display = st7789.ST7789(
    spi, 240, 135,
    reset=Pin(23, Pin.OUT), cs=Pin(5, Pin.OUT), dc=Pin(16, Pin.OUT),
    backlight=Pin(4, Pin.OUT), rotation=1, color_order=st7789.BGR,
    tfa=40, bfa=40,
)
display.backlight(True)

# Buttons
button_left = Pin(35, Pin.IN, Pin.PULL_UP)    # page nav
button_right = Pin(0, Pin.IN, Pin.PULL_UP)    # context action

# State
current_page = 0
wlan = None
button_left_pressed = False
button_right_pressed = False

def draw_signal_bars(x, y, rssi):
    """Draw WiFi signal strength bars"""
    bars = max(0, min(4, (rssi + 100) // 17))
    for i in range(4):
        bar_height = 4 + i * 3
        if i < bars:
            display.fill_rect(x + i * 6, y + 12 - bar_height, 4, bar_height, GREEN)
        else:
            display.rect(x + i * 6, y + 12 - bar_height, 4, bar_height, GREEN)

def page_0_wifi():
    """Page 0: WiFi Status"""
    display.fill(BLACK)
    
    # Header
    display.fill_rect(0, 0, 240, 25, GRAY)
    display.text("WiFi Status [1/2]", 70, 8, color=WHITE)
    
    if wlan and wlan.isconnected():
        display.text("Connected", 10, 35, color=GREEN)
        ssid = wlan.config('ssid')
        ip = wlan.ifconfig()[0]
        rssi = wlan.status('rssi')
        
        display.text("SSID:", 10, 50, color=WHITE)
        display.text(ssid[:20], 60, 50, color=WHITE)
        
        display.text("IP:", 10, 65, color=WHITE)
        display.text(ip, 60, 65, color=WHITE)
        
        display.text("Signal:", 10, 80, color=WHITE)
        draw_signal_bars(80, 80, rssi)
        display.text(f"{rssi} dBm", 140, 80, color=WHITE)
    else:
        display.text("Disconnected", 10, 50, color=RED)
        display.text("Press R button to", 10, 70, color=WHITE)
        display.text("connect WiFi", 10, 85, color=WHITE)
    
    display.text("L=switch  R=action", 10, 125, color=GRAY)

def page_1_countdown():
    """Page 1: Countdown Timer"""
    display.fill(BLACK)
    
    # Header
    display.fill_rect(0, 0, 240, 25, GRAY)
    display.text("Countdown [2/2]", 75, 8, color=WHITE)
    
    current_time = utime.time() + TIMEZONE_OFFSET * 3600
    seconds_left = EVENT_TIMESTAMP - current_time
    
    display.text(EVENT_NAME, 10, 35, color=BLUE)
    
    if seconds_left > 0:
        days = seconds_left // 86400
        hours = (seconds_left % 86400) // 3600
        minutes = (seconds_left % 3600) // 60
        secs = seconds_left % 60
        
        countdown = f"{days}d {hours:02d}:{minutes:02d}:{secs:02d}"
        x = (240 - len(countdown) * 6) // 2
        display.text(countdown, x, 60, color=GREEN)
    else:
        display.text("Event is here!", 60, 60, color=GREEN)
    
    display.text("L=switch  R=action", 10, 125, color=GRAY)

def action_page_0():
    """Right button action on page 0 (WiFi refresh)"""
    if wlan and not wlan.isconnected():
        display.text("Connecting...", 70, 60, color=WHITE)
        wlan.connect(SSID, PASSWORD)
        for _ in range(5):
            if wlan.isconnected():
                return
            utime.sleep(1)

def action_page_1():
    """Right button action on page 1 (toggle progress bar - just re-display)"""
    pass

# Main setup
display.text("Initializing...", 60, 60, color=WHITE)

# Connect WiFi
try:
    wlan = network.WLAN(network.STA_IF)
    wlan.active(True)
    wlan.connect(SSID, PASSWORD)
    for _ in range(10):
        if wlan.isconnected():
            ntptime.settime()
            break
        utime.sleep(1)
except:
    pass

# Render first page
page_0_wifi()

# Main loop
while True:
    current_time = utime.time()
    
    # Left button: navigate pages
    if not button_left.value() and not button_left_pressed:
        button_left_pressed = True
        current_page = (current_page + 1) % 2
        if current_page == 0:
            page_0_wifi()
        else:
            page_1_countdown()
        utime.sleep(0.3)
    elif button_left.value():
        button_left_pressed = False
    
    # Right button: context action
    if not button_right.value() and not button_right_pressed:
        button_right_pressed = True
        if current_page == 0:
            action_page_0()
        else:
            action_page_1()
        utime.sleep(0.3)
    elif button_right.value():
        button_right_pressed = False
    
    # Refresh countdown every second
    if current_page == 1 and current_time % 1 == 0:
        page_1_countdown()
    
    utime.sleep(0.1)
```

**Expected behavior:**
- Left button cycles between WiFi page and Countdown page
- Right button refreshes WiFi or performs page-specific actions
- Countdown updates every second
- Clean, organized state machine architecture

---

## Practical Examples

### RGB565 Color Converter Function

Convert hex color codes to RGB565:

```python
def hex_to_rgb565(hex_color):
    """Convert #RRGGBB hex string to RGB565"""
    hex_color = hex_color.lstrip('#')
    r = int(hex_color[0:2], 16) >> 3  # 5 bits
    g = int(hex_color[2:4], 16) >> 2  # 6 bits
    b = int(hex_color[4:6], 16) >> 3  # 5 bits
    return (r << 11) | (g << 5) | b

# Usage
color = hex_to_rgb565("#FF5733")
display.text("Colored Text", 10, 10, color=color)
```

### Signal Strength Bar Drawing Helper

Reusable signal bar function:

```python
def draw_bars(display, x, y, bars_count, bar_color):
    """
    Draw signal strength bars
    bars_count: 0-4 number of bars to fill
    """
    for i in range(4):
        bar_height = 4 + i * 3
        x_pos = x + i * 6
        if i < bars_count:
            display.fill_rect(x_pos, y + 12 - bar_height, 4, bar_height, bar_color)
        else:
            display.rect(x_pos, y + 12 - bar_height, 4, bar_height, bar_color)
```

### Screen Region Clear Helper

Clear only part of the screen (for efficiency):

```python
def clear_region(display, x, y, width, height, bg_color=0x0000):
    """Clear a rectangular region"""
    display.fill_rect(x, y, width, height, bg_color)
```

---

## Hands-On Exercises

### Exercise 1: Add a Battery Voltage Monitor Page

Create a third page that displays battery voltage. The ADC pin is GPIO 34.

**Hint:**
```python
from machine import ADC, Pin

# Enable ADC (requires GPIO 14 pulled HIGH)
Pin(14, Pin.OUT).value(1)
adc = ADC(Pin(34))

# Read voltage (adjust scaling for your battery)
raw = adc.read()
voltage = (raw / 4095) * 3.3 * 2  # assuming 2:1 voltage divider
```

Add this as `page_2_battery()` to the multi-page dashboard.

### Exercise 2: Create a Boot Splash Screen Animation

Show an animated splash when the device starts:

```python
def splash_animation():
    """Animated boot splash"""
    display.fill(BLACK)
    
    for i in range(1, 50):
        # Draw expanding circles
        display.circle(120, 67, i, st7789.color565(0, 255, 0))
        if i > 10:
            display.circle(120, 67, i - 10, BLACK)  # clear inner area
        utime.sleep(0.02)
    
    # Fade in text
    display.text("TTGO Device Ready", 60, 60, color=WHITE)
    utime.sleep(1)
```

### Exercise 3: Build a Simple Menu System

Create navigable menu with button-based selection:

```python
menu_items = ["WiFi", "Timer", "Settings", "About"]
selected = 0

def draw_menu():
    display.fill(BLACK)
    for i, item in enumerate(menu_items):
        color = GREEN if i == selected else WHITE
        display.text(item, 20, 30 + i * 20, color=color)
```

Use buttons to move selection up/down and confirm with right button.

---

## Troubleshooting

### Display stays completely blank

**Check these in order:**
1. **Backlight:** Run `display.backlight(True)` in REPL. If still dark, the LED is damaged or pin 4 isn't connected.
2. **Rotation and offset:** Verify `rotation=1`, `tfa=40`, `bfa=40` in your init code. Missing offsets cause the image to shift off-screen.
3. **SPI connection:** Verify pins 18 (SCLK), 19 (MOSI), 5 (CS), 16 (DC), 23 (RST) are correct.

### Text renders off-screen or shifted

**Cause:** Missing or incorrect display offsets.

**Fix:** Ensure `tfa=40, bfa=40` in ST7789 constructor.

### Screen flickers when updating

**Cause:** Redrawing the entire screen every frame.

**Fix:** Use partial redraws. Only redraw regions that changed:
```python
# Bad: flickers
display.fill(BLACK)
display.text(timer, 100, 60, color=WHITE)

# Good: no flicker
display.fill_rect(80, 55, 80, 20, BLACK)  # clear just the timer area
display.text(timer, 100, 60, color=WHITE)
```

### WiFi won't connect

1. **Wrong credentials:** Double-check SSID and password (case-sensitive)
2. **No timeout:** Add a timeout loop:
   ```python
   for _ in range(10):
       if wlan.isconnected():
           break
       utime.sleep(1)
   ```
3. **No antenna:** The TTGO has a built-in antenna. If it's broken, WiFi won't work.

### `main.py` causes crash loop

The device resets when `main.py` crashes. To debug:
1. Hold the **BOOT button** (GPIO 0) while powering on to enter bootloader
2. Release the button
3. Connect with `mpremote repl` to access the REPL safely
4. Run your code line-by-line to find the error

### Memory errors (`MemoryError`)

**Causes:** Loading large images, very long strings, too many objects.

**Solutions:**
```python
import gc
gc.collect()  # free garbage immediately

# Use smaller buffers
data = bytearray(100)  # instead of 1000

# Delete unused variables
del large_list
```

---

## Related Tutorials

This tutorial builds on foundational knowledge. For deeper dives:

- [[micropython-ttgo-t-display-beginner-guide|MicroPython TTGO T-Display Beginner Guide]] — Setting up MicroPython on your device
- [[micropython-ttgo-t-display-deep-dive|MicroPython TTGO T-Display Deep Dive]] — Advanced hardware features and internals
- [[ttgo-display-deep-dive|TTGO Display Projects Deep Dive]] — Complex display projects and optimizations

For your broader development workflow:

- [[dotfiles-beginner-guide|Dotfiles Beginner Guide]] — Managing your development configuration
- [[dotfiles-deep-dive|Dotfiles Deep Dive]] — Advanced dotfiles techniques
- [[just-beginner-guide|Just Command Runner Beginner Guide]] — Automating build and deployment tasks
- [[just-deep-dive|Just Command Runner Deep Dive]] — Advanced task automation

---

## References

### Official Documentation
- **ST7789 Pure Python Driver:** https://github.com/russhughes/st7789py_mpy
- **ST7789 C Driver (faster):** https://github.com/russhughes/st7789_mpy
- **MicroPython ESP32 Quick Reference:** https://docs.micropython.org/en/latest/esp32/quickref.html
- **MicroPython network module:** https://docs.micropython.org/en/latest/library/network.WLAN.html
- **MicroPython utime (time) docs:** https://docs.micropython.org/en/latest/library/time.html
- **mpremote documentation:** https://docs.micropython.org/en/latest/reference/mpremote.html

### Community Resources
- **TTGO T-Display Community Guide:** https://github.com/Opinion/LILYGO-T-Display-ESP32-16MB-Micropython-guide
- **MicroPython Display Examples:** https://github.com/russhughes/st7789py_mpy/tree/master/examples

### Technical Specifications
- **ST7789 Datasheet:** Search online for "ST7789 datasheet" — covers color modes, timing, command set
- **ESP32 Pinout:** https://www.espressif.com/sites/default/files/documentation/esp32_datasheet_en.pdf

---

## Summary

You now know how to:

1. **Initialize the ST7789 display** with correct SPI settings and critical offsets
2. **Control the backlight** and brightness
3. **Draw text** with proper centering and multi-line layouts
4. **Use drawing primitives** to create dashboards and visual elements
5. **Build interactive applications** with button input and state machines
6. **Integrate WiFi** to display live data like signal strength
7. **Sync time with NTP** for accurate countdowns
8. **Optimize performance** with partial redraws and efficient memory usage

### Next Steps

- **Explore the Deep Dive:** [[ttgo-display-deep-dive|TTGO Display Projects Deep Dive]] for advanced projects like image rendering, fonts, and real-time animation
- **Try font rendering:** The `st7789py_mpy` driver supports bitmap fonts for prettier text
- **Build custom dashboards:** Use your knowledge to create displays for your specific projects
- **Combine with sensors:** Add temperature, humidity, light sensors and display real-time readings

The display is your feedback loop. Every project becomes more engaging when users see what's happening. Keep building!

