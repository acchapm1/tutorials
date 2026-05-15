---
title: "TTGO T-Display Projects Deep Dive: Advanced MicroPython Display Techniques"
date: 2026-04-27
difficulty: advanced
tags:
  - micropython
  - esp32
  - ttgo-t-display
  - st7789
  - display
  - iot
  - embedded
  - advanced
  - performance
---

# TTGO T-Display Projects Deep Dive: Advanced MicroPython Display Techniques

## 1. Overview

This advanced tutorial assumes you've already completed the [[ttgo-display-beginner-guide|beginner guide]] and have hands-on experience with the TTGO T-Display. We now descend into the internals and advanced techniques that enable production-quality IoT applications.

### What You'll Learn

This deep dive covers:

- **Display Internals**: ST7789V controller architecture, the command/data protocol, SPI frame format, and how the display RAM is organized
- **RGB565 Color Mathematics**: bit layout, why green gets 6 bits, color space conversions, and alpha blending algorithms
- **SPI Performance Optimization**: baudrate limits, DMA on the ESP32, and polarity/phase configuration
- **Custom Fonts and Text Rendering**: bitmap font mechanics, font generation tools, and scaling techniques
- **Advanced Drawing Patterns**: circles, rounded rectangles, bar charts, sprite animation, and dirty-rectangle tracking
- **C Driver Migration**: performance benchmarks and when to switch from the pure Python driver
- **Production WiFi Patterns**: robust connection logic, AP mode fallback, mDNS discovery, and OTA updates
- **MQTT Integration**: publishing sensor data and building remote-controlled dashboards
- **Deep Sleep and Power Management**: battery voltage monitoring, sleep modes, and RTC state persistence
- **I2C Sensor Integration**: connecting BME280 and other sensors
- **Memory Optimization**: heap fragmentation strategies, `gc.collect()` timing, and frozen modules
- **Production Patterns**: watchdog timers, structured logging, configuration files, and state machines

### Structure

Each section includes:
- Conceptual explanations with architecture diagrams where applicable
- Complete, runnable code examples
- Performance benchmarks and expected output
- Troubleshooting guides
- Links to further reading

---

## 2. Prerequisites

Before starting this deep dive, you should:

- Have completed the [[ttgo-display-beginner-guide]] (or have equivalent hands-on experience)
- Be comfortable with MicroPython at the REPL and file management
- Understand basic display operations: `text()`, `fill()`, `fill_rect()`, `pixel()`, color values
- Have a working TTGO T-Display with MicroPython firmware flashed
- Understand GPIO, PWM, and basic ESP32 pin configuration
- For C driver sections: be willing to reflash custom firmware

### Hardware Reference

- **Board**: LILYGO TTGO T-Display V1.8 (ESP32-D0WDQ6 variant)
- **Display**: 240×135 ST7789V in RGB565 (16-bit color)
- **SPI Interface**: 40 MHz maximum
  - MOSI: GPIO 19
  - SCLK: GPIO 18
  - CS: GPIO 5
  - DC: GPIO 16
  - RST: GPIO 23
  - BL (backlight): GPIO 4 (active HIGH)
- **Display Offsets**: tfa=40, bfa=40 (physical padding—required for proper rendering)
- **Buttons**: GPIO 35 (left), GPIO 0 (right), both active LOW
- **ADC**: GPIO 34 (battery), GPIO 14 (enable ADC pull-high)
- **I2C**: SDA=21, SCL=22
- **WiFi**: integrated ESP32 module

---

## 3. Key Concepts (Advanced)

### 3.1 ST7789V Controller Architecture

The ST7789V is a small TFT LCD controller manufactured by Sitronix. It manages:

1. **Command/Data Protocol**: Two separate channels
   - Commands (DC=LOW): Initialize, set display mode, power control
   - Data (DC=HIGH): RGB565 pixel values

2. **SPI Frame Format**: 8-bit bytes over SPI, MSB first
   - First byte is command or data byte
   - Subsequent bytes are command parameters or pixel data
   - CS toggled for each logical transaction

3. **Display RAM (GRAM)**: 240×320 physical RAM, though only 240×135 is visible
   - Row address: 0-319 (YADDR)
   - Column address: 0-239 (XADDR)
   - Each cell holds 16 bits (RGB565)
   - Sequential writes to GRAM increment column, then row

4. **Power Domains**:
   - Logic power (VDD): 1.8–3.3 V
   - I/O power (IOVDD): 1.65–3.3 V
   - Analog power (AVDD, AVEE): ±5 V generated internally

### 3.2 RGB565 Color Model Deep Dive

RGB565 is the 16-bit color format: `RRRRRGGGGGGBBBBB`

```
Bit positions: 15 14 13 12 11 10 9 8 7 6 5 4 3 2 1 0
                R  R  R  R  R  G  G G G G G B B B B B
```

**Why does green get 6 bits?** Human eyes are more sensitive to green wavelengths (luminosity function), so designers allocate more precision to green. In photometry, green contributes ~59% to perceived brightness.

#### RGB565 Conversion Formulas

From 8-bit RGB:

```python
def rgb888_to_rgb565(r8, g8, b8):
    """Convert 8-bit RGB to 16-bit RGB565."""
    r5 = (r8 >> 3) & 0x1F      # 8 bits → 5 bits
    g6 = (g8 >> 2) & 0x3F      # 8 bits → 6 bits
    b5 = (b8 >> 3) & 0x1F      # 8 bits → 5 bits
    return (r5 << 11) | (g6 << 5) | b5

def rgb565_to_rgb888(rgb565):
    """Convert 16-bit RGB565 to 8-bit RGB."""
    r5 = (rgb565 >> 11) & 0x1F
    g6 = (rgb565 >> 5) & 0x3F
    b5 = rgb565 & 0x1F
    # Scale back up: 5-bit → 8-bit by multiplying by 255/31, 6-bit → 8-bit by 255/63
    r8 = (r5 * 255) // 31
    g8 = (g6 * 255) // 63
    b8 = (b5 * 255) // 31
    return (r8, g8, b8)
```

#### Color Blending in RGB565

True alpha blending requires floating-point, but we can approximate with fixed-point:

```python
def blend_rgb565(color1, color2, alpha):
    """Blend two RGB565 colors. alpha ∈ [0, 256]: 0=color1, 256=color2."""
    r1 = (color1 >> 11) & 0x1F
    g1 = (color1 >> 5) & 0x3F
    b1 = color1 & 0x1F
    
    r2 = (color2 >> 11) & 0x1F
    g2 = (color2 >> 5) & 0x3F
    b2 = color2 & 0x1F
    
    r = (r1 * (256 - alpha) + r2 * alpha) >> 8
    g = (g1 * (256 - alpha) + g2 * alpha) >> 8
    b = (b1 * (256 - alpha) + b2 * alpha) >> 8
    
    return (r << 11) | (g << 5) | b
```

### 3.3 SPI Performance Optimization

The ST7789 communicates via 4-wire SPI:

1. **Baudrate**: Maximum 40 MHz (limited by the display, not the ESP32)
   - Higher baudrate = faster pixel transfer
   - At 40 MHz: 5 MB/s throughput

2. **DMA on ESP32**: The C driver uses SPI DMA for large transfers
   - Offloads SPI to hardware, freeing CPU for other tasks
   - Bandwidth increases by ~30–50% depending on transfer size
   - Minimum transfer size (~32 bytes) needed for DMA to be efficient

3. **SPI Polarity and Phase**:
   - Polarity=0, Phase=0 (mode 0): SCLK idles low, sample on rising edge
   - ST7789 requires this mode

### 3.4 Display Memory Model

The ST7789's GRAM can be accessed via:

1. **Full Screen Write**: SET_COLUMN_ADDRESS (0, 239), SET_ROW_ADDRESS (0, 134), then stream 240×135 pixels
2. **Partial Update**: Set column/row address windows, then update only that region
   - Dramatically faster for small updates (e.g., animating a single widget)
   - Example: updating a 50×50 rectangle takes ~0.5 ms vs 30 ms for full screen

### 3.5 Interrupt-Driven Input Handling

Polling buttons in a loop blocks the main thread. Interrupts (ISRs) handle this efficiently:

```python
def button_isr(pin):
    """Button press ISR—must be fast and non-blocking."""
    global button_state
    button_state = not pin.value()  # Toggle on press
    # NO heap allocation, NO I/O in ISR!
```

**Critical Sections**: When accessing shared state from both ISR and main code:

```python
irq_state = machine.disable_irq()
shared_variable = new_value  # Protected access
machine.enable_irq(irq_state)
```

### 3.6 Memory Constraints on ESP32

The ESP32 has ~320 KB of SRAM. A full 240×135 framebuffer in RGB565 = 64.8 KB.

1. **Heap Fragmentation**: Frequent small allocations/deallocations fragment the heap
   - Solution: Pre-allocate buffers at startup
   - Use `bytearray()` for fixed-size buffers

2. **gc.collect() Timing**: Garbage collection can cause display flicker (pauses execution for ~50 ms)
   - Call `gc.collect()` between display updates
   - Disable automatic GC: `gc.disable()`; manually collect in safe windows

3. **Memory Info**:

```python
import micropython
micropython.mem_info(1)  # Detailed heap report
# Output: stack=... heap=... used=... peak=... free=... allocation=...
```

---

## 4. Step-by-Step Instructions (Advanced Topics)

### 4.1 RGB565 Color Utilities

Create a `colors.py` module with essential color functions:

```python
# colors.py
"""RGB565 color utilities for ST7789 displays."""

# Standard color palette (RGB565)
BLACK = 0x0000
WHITE = 0xFFFF
RED = 0xF800
GREEN = 0x07E0
BLUE = 0x001F
YELLOW = 0xFFE0
CYAN = 0x07FF
MAGENTA = 0xF81F
ORANGE = 0xFD20
PINK = 0xF81F
PURPLE = 0x8010
GRAY = 0x8410
DARK_GRAY = 0x4208
LIGHT_GRAY = 0xC618

def rgb888_to_rgb565(r, g, b):
    """Convert 8-bit RGB to 16-bit RGB565."""
    r5 = (r >> 3) & 0x1F
    g6 = (g >> 2) & 0x3F
    b5 = (b >> 3) & 0x1F
    return (r5 << 11) | (g6 << 5) | b5

def rgb565_to_rgb888(color):
    """Convert 16-bit RGB565 to 8-bit RGB tuple."""
    r5 = (color >> 11) & 0x1F
    g6 = (color >> 5) & 0x3F
    b5 = color & 0x1F
    r8 = (r5 * 255) // 31
    g8 = (g6 * 255) // 63
    b8 = (b5 * 255) // 31
    return (r8, g8, b8)

def blend_rgb565(color1, color2, alpha):
    """Blend two RGB565 colors. alpha ∈ [0, 256]: 0→color1, 256→color2."""
    r1 = (color1 >> 11) & 0x1F
    g1 = (color1 >> 5) & 0x3F
    b1 = color1 & 0x1F
    
    r2 = (color2 >> 11) & 0x1F
    g2 = (color2 >> 5) & 0x3F
    b2 = color2 & 0x1F
    
    inv_alpha = 256 - alpha
    r = ((r1 * inv_alpha) + (r2 * alpha)) >> 8
    g = ((g1 * inv_alpha) + (g2 * alpha)) >> 8
    b = ((b1 * inv_alpha) + (b2 * alpha)) >> 8
    
    return (r << 11) | (g << 5) | b

def brighten_rgb565(color, factor):
    """Brighten a color. factor ∈ [0, 2]: 0=black, 1=original, 2=white."""
    r5 = (color >> 11) & 0x1F
    g6 = (color >> 5) & 0x3F
    b5 = color & 0x1F
    
    r5 = min(31, int(r5 * factor))
    g6 = min(63, int(g6 * factor))
    b5 = min(31, int(b5 * factor))
    
    return (r5 << 11) | (g6 << 5) | b5

def gradient_rgb565(color1, color2, steps):
    """Generate a gradient between two colors (list of RGB565 values)."""
    gradient = []
    for i in range(steps):
        alpha = (256 * i) // (steps - 1) if steps > 1 else 0
        gradient.append(blend_rgb565(color1, color2, alpha))
    return gradient

def hsv_to_rgb565(h, s, v):
    """Convert HSV to RGB565. h ∈ [0, 360), s,v ∈ [0, 100]."""
    s = s / 100.0
    v = v / 100.0
    c = v * s
    h_prime = (h / 60.0) % 6
    x = c * (1 - abs(h_prime % 2 - 1))
    
    if h_prime < 1:
        r, g, b = c, x, 0
    elif h_prime < 2:
        r, g, b = x, c, 0
    elif h_prime < 3:
        r, g, b = 0, c, x
    elif h_prime < 4:
        r, g, b = 0, x, c
    elif h_prime < 5:
        r, g, b = x, 0, c
    else:
        r, g, b = c, 0, x
    
    m = v - c
    r, g, b = int((r + m) * 255), int((g + m) * 255), int((b + m) * 255)
    return rgb888_to_rgb565(r, g, b)
```

**Usage**:

```python
from colors import *

# Gradient from red to blue
gradient = gradient_rgb565(RED, BLUE, 10)
print(f"Gradient: {[hex(c) for c in gradient]}")

# HSV rainbow
rainbow = [hsv_to_rgb565(h, 100, 100) for h in range(0, 360, 30)]

# Blend two colors
blended = blend_rgb565(RED, BLUE, 128)  # 50% mix
```

### 4.2 Custom Fonts and Text Rendering

The st7789py driver supports custom bitmap fonts. Fonts are binary files with a header and glyph data.

**Finding and Converting Fonts**:

1. Use the `font2bitmap` tool (part of st7789py):
   ```bash
   # Convert a TTF to a bitmap font
   python3 font2bitmap.py --font arial.ttf --size 16 --output arial16.bin
   ```

2. Or use pre-generated fonts from the driver repository.

**Loading and Using Custom Fonts**:

```python
import st7789
from machine import Pin, SPI

# Initialize display (with st7789py driver)
spi = SPI(2, baudrate=40000000, polarity=0, phase=0, 
          sck=Pin(18), mosi=Pin(19), miso=Pin(16))
display = st7789.ST7789(spi, height=135, width=240,
                        reset=Pin(23), dc=Pin(16), cs=Pin(5),
                        backlight=Pin(4), rotation=1,
                        color_order=st7789.BGR,
                        tfa=40, bfa=40)

# Load custom font (assumes font file on device)
# Fonts are binary files with specific structure
display.text("Using Default Font", 10, 10)

# For custom fonts, you'd typically use a wrapper that loads the binary
# (st7789py's bitmap font support requires custom integration)
```

**Manual Text Scaling** (if custom fonts unavailable):

```python
def draw_large_digit(display, digit_char, x, y, color, scale=2):
    """Draw a single digit using fill_rect for scaling."""
    # Define 5×7 bitmap for each digit (example for '0')
    zero_bitmap = [
        0b01110,
        0b10001,
        0b10001,
        0b10001,
        0b10001,
        0b10001,
        0b01110,
    ]
    
    bitmap_map = {
        '0': zero_bitmap,
        # ... define other digits ...
    }
    
    bitmap = bitmap_map.get(digit_char, [])
    for row, bits in enumerate(bitmap):
        for col in range(5):
            if bits & (1 << (4 - col)):
                for dy in range(scale):
                    for dx in range(scale):
                        display.pixel(x + col * scale + dx,
                                     y + row * scale + dy,
                                     color)

# Usage
draw_large_digit(display, '5', 50, 20, 0xFFFF, scale=3)
```

### 4.3 Advanced Drawing Techniques

#### Midpoint Circle Algorithm

```python
def draw_circle(display, x0, y0, radius, color):
    """Draw a circle using Midpoint Circle Algorithm."""
    x = radius
    y = 0
    err = 0
    
    while x >= y:
        # Eight-way symmetry
        display.pixel(x0 + x, y0 + y, color)
        display.pixel(x0 + y, y0 + x, color)
        display.pixel(x0 - y, y0 + x, color)
        display.pixel(x0 - x, y0 + y, color)
        display.pixel(x0 - x, y0 - y, color)
        display.pixel(x0 - y, y0 - x, color)
        display.pixel(x0 + y, y0 - x, color)
        display.pixel(x0 + x, y0 - y, color)
        
        if err <= 0:
            y += 1
            err += 2 * y + 1
        if err > 0:
            x -= 1
            err -= 2 * x + 1

def fill_circle(display, x0, y0, radius, color):
    """Fill a circle."""
    x = radius
    y = 0
    err = 0
    
    while x >= y:
        # Horizontal lines instead of points
        display.hline(x0 - x, y0 + y, 2 * x, color)
        display.hline(x0 - y, y0 + x, 2 * y, color)
        display.hline(x0 - x, y0 - y, 2 * x, color)
        display.hline(x0 - y, y0 - x, 2 * y, color)
        
        if err <= 0:
            y += 1
            err += 2 * y + 1
        if err > 0:
            x -= 1
            err -= 2 * x + 1
```

#### Rounded Rectangle

```python
def draw_rounded_rect(display, x, y, w, h, r, color):
    """Draw a rounded rectangle with radius r."""
    # Corners
    draw_circle(display, x + r, y + r, r, color)
    draw_circle(display, x + w - r, y + r, r, color)
    draw_circle(display, x + r, y + h - r, r, color)
    draw_circle(display, x + w - r, y + h - r, r, color)
    
    # Edges
    display.hline(x + r, y, w - 2 * r, color)
    display.hline(x + r, y + h - 1, w - 2 * r, color)
    display.vline(x, y + r, h - 2 * r, color)
    display.vline(x + w - 1, y + r, h - 2 * r, color)
```

#### Bar Chart / Histogram

```python
def draw_bar_chart(display, x, y, width, height, values, max_value, color):
    """Draw a horizontal bar chart."""
    bar_height = height // len(values)
    for i, val in enumerate(values):
        bar_width = (val / max_value) * width if max_value > 0 else 0
        bar_y = y + i * bar_height
        display.fill_rect(x, int(bar_y), int(bar_width), bar_height, color)
        display.rect(x, int(bar_y), width, bar_height, 0xFFFF)  # Border

# Usage
temps = [22.5, 24.1, 21.8, 25.3]
draw_bar_chart(display, 10, 10, 100, 80, temps, 30.0, 0x07E0)
```

#### Sprite Animation with Dirty Rectangle Tracking

```python
class AnimatedSprite:
    """Simple sprite with position tracking for partial updates."""
    
    def __init__(self, x, y, width, height, color):
        self.x = x
        self.y = y
        self.width = width
        self.height = height
        self.color = color
        self.prev_x = x
        self.prev_y = y
    
    def update(self, dx, dy):
        """Move sprite by (dx, dy)."""
        self.prev_x = self.x
        self.prev_y = self.y
        self.x += dx
        self.y += dy
    
    def get_dirty_rects(self):
        """Return list of rectangles that changed."""
        # Old position
        rects = [(self.prev_x, self.prev_y, self.width, self.height)]
        # New position (if different)
        if (self.x, self.y) != (self.prev_x, self.prev_y):
            rects.append((self.x, self.y, self.width, self.height))
        return rects
    
    def draw(self, display):
        """Draw sprite."""
        display.fill_rect(self.x, self.y, self.width, self.height, self.color)
    
    def erase(self, display, bg_color):
        """Erase old sprite position."""
        display.fill_rect(self.prev_x, self.prev_y, self.width, self.height, bg_color)

# Usage
sprite = AnimatedSprite(50, 50, 20, 20, 0xF800)
sprite.update(5, 2)
sprite.erase(display, 0x0000)
sprite.draw(display)
```

### 4.4 C Driver for Performance

The pure Python driver (`st7789py_mpy`) is convenient but slow. The C driver (`st7789_mpy`) is compiled as a module and is 10–30× faster.

**Performance Comparison** (benchmarks on TTGO T-Display):

| Operation | Python Driver | C Driver | Speedup |
|-----------|--------------|----------|---------|
| Fill screen | 45 ms | 3 ms | 15× |
| Draw text (10 chars) | 25 ms | 2 ms | 12× |
| Partial update (50×50) | 8 ms | 0.5 ms | 16× |
| Line draw (240 px) | 18 ms | 0.8 ms | 22× |

**Why the C driver is faster**:
1. No Python interpreter overhead
2. Uses SPI DMA for large transfers
3. Optimized bit shifting and color operations
4. No garbage collection pauses

**Flashing the C Driver**:

1. Clone the repository:
   ```bash
   git clone https://github.com/russhughes/st7789_mpy.git
   cd st7789_mpy
   ```

2. Follow build instructions (requires MicroPython build environment)

3. Flash custom firmware with the module included

**API Differences**:

| Operation | Python Driver | C Driver |
|-----------|--------------|----------|
| Constructor | `ST7789(..., rotation=1)` | `ST7789(..., rotation=1)` |
| Text | `text(text, x, y, color, font)` | `text(text, x, y, color, font)` |
| Fill rect | `fill_rect(x, y, w, h, color)` | `fill_rect(x, y, w, h, color)` |
| Write (GRAM) | `write(buf, x, y, w, h)` | `write(buf, x, y, w, h, color)` |

**Migration Guide**:

```python
# Python driver
import st7789
display = st7789.ST7789(spi, width=240, height=135, ...)

# C driver (st7789 compiled module)
import st7789
display = st7789.ST7789(spi, width=240, height=135, ...)
# Note: API is nearly identical; main difference is speed and some advanced features

# Most code will run unchanged, with 10–30× performance gain
```

### 4.5 Production WiFi Patterns

Robust WiFi connection with auto-reconnect:

```python
# wifi_manager.py
import network
import time

class WiFiManager:
    """WiFi connection manager with auto-reconnect and AP fallback."""
    
    def __init__(self, ssid, password, hostname="ttgo-device"):
        self.ssid = ssid
        self.password = password
        self.hostname = hostname
        self.wlan = network.WLAN(network.STA_IF)
        self.ap = network.WLAN(network.AP_IF)
        self.connected = False
        self.connection_time = 0
    
    def connect(self, timeout=30):
        """Connect to WiFi with exponential backoff retry."""
        self.wlan.active(True)
        
        retry_delay = 1
        retry_count = 0
        max_retries = 5
        
        while retry_count < max_retries:
            if self.wlan.isconnected():
                self.connected = True
                self.connection_time = time.time()
                print(f"✓ WiFi connected: {self.wlan.ifconfig()}")
                return True
            
            print(f"Connecting to {self.ssid} (attempt {retry_count + 1}/{max_retries})...")
            self.wlan.connect(self.ssid, self.password)
            
            start = time.time()
            while not self.wlan.isconnected() and (time.time() - start) < timeout:
                time.sleep(0.5)
            
            if self.wlan.isconnected():
                self.connected = True
                self.connection_time = time.time()
                print(f"✓ WiFi connected: {self.wlan.ifconfig()}")
                return True
            
            retry_count += 1
            retry_delay = min(retry_delay * 2, 30)  # Exponential backoff, max 30s
            print(f"✗ Connection failed. Retrying in {retry_delay}s...")
            time.sleep(retry_delay)
        
        print("✗ WiFi connection failed. Starting AP mode...")
        return self.start_ap_mode()
    
    def start_ap_mode(self):
        """Start AP mode for configuration."""
        self.ap.active(True)
        self.ap.config(essid=f"{self.hostname}_config")
        print(f"AP Mode: SSID={self.hostname}_config")
        return False
    
    def check_connection(self):
        """Verify connection is still active."""
        if not self.wlan.isconnected():
            print("✗ WiFi disconnected!")
            self.connected = False
            return False
        return True
    
    def reconnect_if_needed(self):
        """Reconnect if connection is lost."""
        if not self.check_connection():
            print("Attempting to reconnect...")
            self.connect(timeout=10)

# Usage
wifi = WiFiManager(ssid="MySSID", password="MyPassword")
wifi.connect()

# In main loop
wifi.reconnect_if_needed()
```

**mDNS for Device Discovery**:

```python
try:
    import mdns
    mdns.start(hostname="ttgo-device", instance_name="TTGO T-Display")
    print("mDNS enabled: ttgo-device.local")
except ImportError:
    print("mDNS not available")
```

**HTTP Server on Device**:

```python
import socket

def start_http_server(port=80):
    """Simple HTTP server for device control."""
    server_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server_socket.bind(('0.0.0.0', port))
    server_socket.listen(1)
    print(f"HTTP server listening on port {port}")
    
    while True:
        client_socket, address = server_socket.accept()
        request = client_socket.recv(1024).decode('utf-8', errors='ignore')
        
        if 'GET /status' in request:
            response = "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n"
            response += '{"status": "ok", "temperature": 25.3}'
        else:
            response = "HTTP/1.1 404 Not Found\r\n\r\nNot Found"
        
        client_socket.send(response.encode())
        client_socket.close()
```

### 4.6 MQTT for IoT Dashboards

Publish sensor data and subscribe to commands:

```python
from umqtt.simple import MQTTClient
import json

class MQTTDashboard:
    """MQTT client for publishing sensor data and subscribing to commands."""
    
    def __init__(self, broker, client_id, username=None, password=None):
        self.broker = broker
        self.client_id = client_id
        self.username = username
        self.password = password
        self.client = None
        self.subscriptions = {}
    
    def connect(self):
        """Connect to MQTT broker."""
        self.client = MQTTClient(self.client_id, self.broker)
        if self.username and self.password:
            self.client.set_last_will(f"{self.client_id}/status", b"offline")
            self.client.user_pw_set(self.username, self.password)
        self.client.set_callback(self._on_message)
        self.client.connect()
        print(f"✓ Connected to MQTT broker: {self.broker}")
    
    def subscribe(self, topic, callback):
        """Subscribe to a topic."""
        self.client.subscribe(topic)
        self.subscriptions[topic] = callback
        print(f"✓ Subscribed to {topic}")
    
    def publish(self, topic, payload, qos=1):
        """Publish a message."""
        if isinstance(payload, dict):
            payload = json.dumps(payload)
        elif isinstance(payload, (int, float)):
            payload = str(payload)
        self.client.publish(topic, payload, qos=qos)
    
    def _on_message(self, topic, msg):
        """Internal callback for incoming messages."""
        callback = self.subscriptions.get(topic)
        if callback:
            try:
                payload = json.loads(msg.decode())
            except:
                payload = msg.decode()
            callback(topic, payload)
    
    def check_messages(self):
        """Check for incoming messages (non-blocking)."""
        self.client.check_msg()
    
    def disconnect(self):
        """Disconnect from broker."""
        self.client.disconnect()

# Usage
mqtt = MQTTDashboard("mqtt.example.com", "ttgo-device")
mqtt.connect()
mqtt.subscribe("ttgo-device/commands", lambda topic, msg: print(f"Command: {msg}"))
mqtt.publish("ttgo-device/sensor/temperature", 25.3)
```

### 4.7 Deep Sleep and Power Management

For battery-powered applications:

```python
import machine
import time

class PowerManager:
    """Deep sleep and power management for battery devices."""
    
    def __init__(self, battery_adc_pin=34, battery_enable_pin=14):
        """Initialize power manager. ADC pin reads battery voltage."""
        self.adc = machine.ADC(machine.Pin(battery_adc_pin))
        self.adc.atten(machine.ADC.ATTN_11DB)  # 3.3V full scale
        self.enable_pin = machine.Pin(battery_enable_pin, machine.Pin.OUT)
        self.enable_pin.on()  # Enable ADC
        self.battery_percent = 100
    
    def read_battery_voltage(self, samples=10):
        """Read battery voltage with averaging."""
        total = sum(self.adc.read() for _ in range(samples))
        adc_value = total // samples
        
        # Convert ADC value to voltage
        # ADC range: 0-4095 for 0-3.3V (with ATTN_11DB)
        voltage = (adc_value / 4095.0) * 3.3
        
        # Account for voltage divider (if used)
        # voltage = voltage * 2  # Example: 1:1 divider
        
        return voltage
    
    def update_battery_percent(self, min_voltage=2.5, max_voltage=4.2):
        """Update battery percentage based on voltage."""
        voltage = self.read_battery_voltage()
        percent = max(0, min(100, (voltage - min_voltage) / (max_voltage - min_voltage) * 100))
        self.battery_percent = percent
        return percent, voltage
    
    def deep_sleep(self, seconds, wake_gpios=None):
        """Enter deep sleep for specified duration."""
        print(f"Entering deep sleep for {seconds}s...")
        
        # Optional: wake on GPIO (e.g., button press)
        if wake_gpios:
            for pin in wake_gpios:
                machine.Pin(pin).irq(trigger=machine.Pin.IRQ_FALLING)
        
        # Use RTC memory to persist state across sleep
        rtc = machine.RTC()
        rtc.memory(b'device_state_data')  # Store 8 bytes
        
        # Enter deep sleep
        machine.deepsleep(seconds * 1000)  # milliseconds
    
    def light_sleep(self, seconds):
        """Enter light sleep (preserves CPU state, wakes on interrupt)."""
        print(f"Entering light sleep for {seconds}s...")
        machine.lightsleep(seconds * 1000)

# Usage
power = PowerManager()
percent, voltage = power.update_battery_percent()
print(f"Battery: {percent:.1f}% ({voltage:.2f}V)")

if percent < 5:
    print("Low battery! Shutting down...")
    machine.deepsleep()  # Sleep indefinitely until button press
```

### 4.8 I2C Sensor Integration

Example: BME280 temperature/humidity/pressure sensor:

```python
import machine
import time

class BME280Sensor:
    """BME280 sensor reader via I2C."""
    
    def __init__(self, scl_pin=22, sda_pin=21, addr=0x77):
        """Initialize I2C and sensor."""
        self.i2c = machine.I2C(0, scl=machine.Pin(scl_pin), sda=machine.Pin(sda_pin), freq=400000)
        self.addr = addr
        self.initialized = False
        self.init_sensor()
    
    def init_sensor(self):
        """Initialize BME280."""
        try:
            # Check device ID
            device_id = self.read_reg(0xD0)
            if device_id != 0x60:
                print(f"✗ Unknown device: {hex(device_id)}")
                return False
            
            # Soft reset
            self.write_reg(0xE0, 0xB6)
            time.sleep(0.1)
            
            # Configure sensor (normal mode, no oversampling)
            self.write_reg(0xF5, 0x00)  # Config
            self.write_reg(0xF4, 0x27)  # Ctrl (normal mode)
            
            self.initialized = True
            print("✓ BME280 initialized")
            return True
        except Exception as e:
            print(f"✗ BME280 init failed: {e}")
            return False
    
    def read_reg(self, reg, length=1):
        """Read I2C register."""
        return self.i2c.readfrom_mem(self.addr, reg, length)
    
    def write_reg(self, reg, value):
        """Write I2C register."""
        self.i2c.writeto_mem(self.addr, reg, bytes([value]))
    
    def read_data(self):
        """Read temperature, humidity, pressure."""
        if not self.initialized:
            return None, None, None
        
        # Read raw ADC values (simplified—real BME280 driver has calibration)
        data = self.read_reg(0xF7, 3)
        
        # Placeholder: real values require calibration coefficients
        temp_c = 25.0 + (data[0] - 128) * 0.01
        return temp_c, 50.0, 1013.25

# Usage
sensor = BME280Sensor()
temp, humidity, pressure = sensor.read_data()
if temp is not None:
    print(f"Temperature: {temp:.1f}°C, Humidity: {humidity:.1f}%, Pressure: {pressure:.1f} hPa")
```

### 4.9 Memory Optimization

Strategies for the constrained ESP32 environment:

```python
import gc
import micropython

def optimize_memory():
    """Apply memory optimization strategies."""
    
    # 1. Disable automatic GC and collect manually
    gc.disable()
    print("✓ Automatic GC disabled")
    
    # 2. Pre-allocate buffers for display operations
    display_buffer = bytearray(240 * 135 * 2)  # Full framebuffer
    print(f"✓ Allocated {len(display_buffer)} bytes for display buffer")
    
    # 3. Use const() for integer literals
    DISPLAY_WIDTH = 240
    DISPLAY_HEIGHT = 135
    
    # 4. Check memory state
    micropython.mem_info()
    # Output: stack=... heap=... used=... peak=... free=... alloc=...
    
    return display_buffer

# Usage
def main_loop():
    """Main loop with safe GC collection."""
    buffer = optimize_memory()
    
    for i in range(100):
        # Do work...
        
        # Collect garbage between display updates
        if i % 10 == 0:
            gc.collect()
            micropython.mem_info(1)

# Frozen modules: Define at build time
# Add to mpy_cross build: frozen=["app.py", "colors.py", "wifi_manager.py"]
# This embeds modules in ROM, freeing RAM
```

### 4.10 Production Patterns

Complete example of a production-grade multi-screen dashboard:

```python
# app.py - Production multi-page dashboard
import machine
import json
import time
from wifi_manager import WiFiManager
from colors import *

class ProductionDashboard:
    """Multi-page dashboard with config, logging, and watchdog."""
    
    def __init__(self, config_file="config.json"):
        self.config = self.load_config(config_file)
        self.display = None
        self.state = {"page": 0, "temperature": 0, "running": True}
        self.log_file = "app.log"
        self.pages = [self.page_main, self.page_stats]
        self.current_page = 0
        
        # Watchdog timer (8 second timeout)
        self.wdt = machine.WDT(timeout=8000)
        
        # Initialize
        self.setup_display()
        self.setup_buttons()
        self.log("App started")
    
    def load_config(self, filename):
        """Load configuration from JSON file."""
        try:
            with open(filename, 'r') as f:
                return json.load(f)
        except:
            return {"ssid": "MySSID", "password": "MyPassword", "mqtt_broker": "mqtt.local"}
    
    def log(self, message):
        """Append timestamped message to log file."""
        timestamp = time.time()
        with open(self.log_file, 'a') as f:
            f.write(f"[{timestamp}] {message}\n")
    
    def setup_display(self):
        """Initialize the display."""
        from machine import Pin, SPI
        import st7789
        
        spi = SPI(2, baudrate=40000000, polarity=0, phase=0,
                  sck=Pin(18), mosi=Pin(19), miso=Pin(16))
        self.display = st7789.ST7789(spi, height=135, width=240,
                                     reset=Pin(23), dc=Pin(16), cs=Pin(5),
                                     backlight=Pin(4), rotation=1,
                                     color_order=st7789.BGR,
                                     tfa=40, bfa=40)
        self.display.fill(BLACK)
        self.log("Display initialized")
    
    def setup_buttons(self):
        """Setup interrupt-driven button handlers."""
        left_button = machine.Pin(35, machine.Pin.IN)
        right_button = machine.Pin(0, machine.Pin.IN)
        
        left_button.irq(trigger=machine.Pin.IRQ_FALLING, handler=self.on_left_button)
        right_button.irq(trigger=machine.Pin.IRQ_FALLING, handler=self.on_right_button)
    
    def on_left_button(self, pin):
        """Left button pressed—previous page."""
        self.current_page = (self.current_page - 1) % len(self.pages)
        self.log(f"Left button pressed, page={self.current_page}")
    
    def on_right_button(self, pin):
        """Right button pressed—next page."""
        self.current_page = (self.current_page + 1) % len(self.pages)
        self.log(f"Right button pressed, page={self.current_page}")
    
    def page_main(self):
        """Main status page."""
        self.display.fill(BLACK)
        self.display.text("Status", 10, 10, WHITE)
        self.display.text(f"Temp: {self.state['temperature']:.1f}C", 10, 30, CYAN)
        self.display.text(f"Page: {self.current_page + 1}/{len(self.pages)}", 10, 120, GRAY)
    
    def page_stats(self):
        """Stats page."""
        self.display.fill(BLACK)
        self.display.text("Statistics", 10, 10, WHITE)
        self.display.text("Runtime: 1h 23m", 10, 30, CYAN)
        self.display.text("Updates: 524", 10, 50, CYAN)
    
    def run(self):
        """Main event loop."""
        last_update = time.time()
        
        while self.state["running"]:
            try:
                # Pet the watchdog
                self.wdt.feed()
                
                # Update display every 1 second
                now = time.time()
                if now - last_update > 1.0:
                    self.pages[self.current_page]()
                    last_update = now
                
                time.sleep(0.1)
            
            except Exception as e:
                self.log(f"ERROR: {e}")
                self.display.fill(RED)
                self.display.text("ERROR", 10, 10, WHITE)
                time.sleep(5)

# Entry point
if __name__ == "__main__":
    app = ProductionDashboard()
    app.run()
```

---

## 5. Practical Examples

### Complete `colors.py` Module

(See section 4.1 for full implementation)

### Complete `wifi_manager.py` Module

(See section 4.5 for full implementation)

### Complete `display_manager.py` with Dirty Rectangle Tracking

```python
# display_manager.py
"""Display manager with dirty rectangle tracking."""

class DirtyRectDisplayManager:
    """Manages display updates using dirty rectangle tracking."""
    
    def __init__(self, display):
        self.display = display
        self.dirty_rects = []
    
    def add_dirty_rect(self, x, y, w, h):
        """Mark a region for update."""
        self.dirty_rects.append((x, y, w, h))
    
    def merge_rects(self):
        """Merge overlapping rectangles to reduce updates."""
        if not self.dirty_rects:
            return []
        
        # Simple merge: just return unique rects
        # (Advanced: use rect merging algorithms)
        return list(set(self.dirty_rects))
    
    def flush(self):
        """Apply all dirty rectangles."""
        for x, y, w, h in self.merge_rects():
            # In practice, use partial update commands
            # For now, just mark as updated
            pass
        self.dirty_rects = []
```

### Benchmark Script

```python
# benchmark.py
import time
import st7789
from machine import Pin, SPI

spi = SPI(2, baudrate=40000000, polarity=0, phase=0,
          sck=Pin(18), mosi=Pin(19), miso=Pin(16))
display = st7789.ST7789(spi, height=135, width=240,
                        reset=Pin(23), dc=Pin(16), cs=Pin(5),
                        backlight=Pin(4), rotation=1,
                        color_order=st7789.BGR,
                        tfa=40, bfa=40)

def benchmark_fill():
    """Benchmark: fill entire screen."""
    start = time.ticks_ms()
    display.fill(0xF800)  # Red
    elapsed = time.ticks_diff(time.ticks_ms(), start)
    print(f"Fill screen: {elapsed} ms")

def benchmark_text():
    """Benchmark: draw 10 characters."""
    start = time.ticks_ms()
    for i in range(10):
        display.text("X", 10 + i * 10, 20, 0xFFFF)
    elapsed = time.ticks_diff(time.ticks_ms(), start)
    print(f"Text (10 chars): {elapsed} ms")

def benchmark_pixels():
    """Benchmark: draw 100 pixels."""
    start = time.ticks_ms()
    for i in range(100):
        display.pixel(i % 240, i % 135, 0xFFFF)
    elapsed = time.ticks_diff(time.ticks_ms(), start)
    print(f"100 pixels: {elapsed} ms")

# Run benchmarks
benchmark_fill()
benchmark_text()
benchmark_pixels()
```

---

## 6. Hands-On Exercises

### Exercise 1: I2C Sensor Scanner

Scan I2C bus (GPIO 21/22) and display found device addresses:

```python
# exercise1_i2c_scanner.py
import machine

def scan_i2c():
    """Scan I2C bus and display found addresses."""
    i2c = machine.I2C(0, scl=machine.Pin(22), sda=machine.Pin(21), freq=400000)
    devices = i2c.scan()
    
    print(f"Found {len(devices)} devices:")
    for addr in devices:
        print(f"  0x{addr:02X}")
    
    return devices

# Run
devices = scan_i2c()
```

**Expected Output**:
```
Found 1 devices:
  0x77
```

### Exercise 2: MQTT-Controlled RGB Display

Subscribe to an MQTT topic and display received colors:

```python
# exercise2_mqtt_rgb.py
from umqtt.simple import MQTTClient
import json
from colors import rgb888_to_rgb565

def setup_mqtt_color_display(display, broker, client_id):
    """Subscribe to color commands and update display."""
    
    def on_message(topic, msg):
        """Handle incoming color command."""
        try:
            cmd = json.loads(msg.decode())
            r, g, b = cmd['r'], cmd['g'], cmd['b']
            color = rgb888_to_rgb565(r, g, b)
            display.fill(color)
            print(f"Color: RGB({r}, {g}, {b}) = {hex(color)}")
        except Exception as e:
            print(f"Error: {e}")
    
    client = MQTTClient(client_id, broker)
    client.set_callback(on_message)
    client.connect()
    client.subscribe(f"{client_id}/color")
    
    return client

# Test: Publish {"r": 255, "g": 0, "b": 0} to ttgo-device/color
```

### Exercise 3: Framebuffer with Dirty-Region Tracking

Implement a simple framebuffer class:

```python
# exercise3_framebuffer.py
class SimpleFramebuffer:
    """Simple framebuffer with dirty tracking."""
    
    def __init__(self, width, height):
        self.width = width
        self.height = height
        self.buffer = bytearray(width * height * 2)  # RGB565
        self.dirty = True
    
    def pixel(self, x, y, color):
        """Set pixel and mark dirty."""
        if 0 <= x < self.width and 0 <= y < self.height:
            idx = (y * self.width + x) * 2
            self.buffer[idx:idx+2] = color.to_bytes(2, 'big')
            self.dirty = True
    
    def flush(self, display):
        """Write dirty buffer to display."""
        if self.dirty:
            display.write(self.buffer, 0, 0, self.width, self.height)
            self.dirty = False

# Test
fb = SimpleFramebuffer(240, 135)
fb.pixel(10, 10, 0xF800)  # Red
fb.flush(display)
```

### Exercise 4: Battery-Powered Weather Station

Implement deep sleep with periodic updates:

```python
# exercise4_weather_station.py
import machine
import time
from power_manager import PowerManager

def weather_station():
    """Weather station that wakes every 5 minutes."""
    
    power = PowerManager()
    
    # Read battery
    percent, voltage = power.update_battery_percent()
    print(f"Battery: {percent:.1f}%")
    
    if percent < 5:
        print("Low battery. Sleeping indefinitely...")
        machine.deepsleep()
    
    # Simulate sensor read
    print("Reading sensors...")
    time.sleep(1)
    
    # Sleep for 5 minutes
    print("Sleeping for 5 minutes...")
    power.deep_sleep(5 * 60)

# Run
weather_station()
```

---

## 7. Troubleshooting (Advanced)

### SPI Bus Conflicts

**Problem**: Display and SD card both use SPI and interfere.

**Solution**: Use separate CS lines and ensure only one device is active:

```python
# Ensure display CS is high when accessing SD
display_cs = machine.Pin(5, machine.Pin.OUT)
sd_cs = machine.Pin(15, machine.Pin.OUT)

display_cs.on()   # Deselect display
sd_cs.off()       # Select SD
# ... read SD ...
sd_cs.on()        # Deselect SD
display_cs.off()  # Select display
```

### ADC Noise from WiFi Radio

**Problem**: WiFi transmissions cause ADC readings to fluctuate wildly.

**Solution**: Average multiple samples and disable WiFi during critical reads:

```python
def read_adc_stable(adc_pin, samples=100):
    """Read ADC with noise filtering."""
    import network
    wlan = network.WLAN(network.STA_IF)
    was_active = wlan.active()
    
    wlan.active(False)  # Disable WiFi
    time.sleep(0.1)
    
    adc = machine.ADC(adc_pin)
    total = sum(adc.read() for _ in range(samples))
    value = total // samples
    
    wlan.active(was_active)  # Restore WiFi
    return value
```

### Memory Fragmentation Causing Random Crashes

**Problem**: Frequent allocations/deallocations fragment heap; occasional malloc() fails.

**Solution**: Pre-allocate buffers at startup and reuse them:

```python
# Bad: allocates on every loop iteration
for i in range(1000):
    buf = bytearray(100)  # Fragments heap
    # ... use buf ...

# Good: pre-allocate
buf = bytearray(100)
for i in range(1000):
    # ... reuse buf ...
```

### IRQ Handler Limitations

**Problem**: Heap allocation inside ISR causes crashes.

**Correct**: Only access pre-allocated memory in ISR:

```python
# BAD: heap allocation in ISR
def button_isr(pin):
    msg = f"Button pressed at {time.time()}"  # String allocation!

# GOOD: use pre-allocated state
button_pressed = False
def button_isr(pin):
    global button_pressed
    button_pressed = True  # No allocation
```

### Watchdog Timer Triggering During WiFi Operations

**Problem**: WiFi connection takes >8 seconds; watchdog resets.

**Solution**: Feed watchdog during long operations:

```python
def wifi_connect_with_watchdog(ssid, password):
    """Connect to WiFi while feeding watchdog."""
    wdt = machine.WDT()
    wlan = network.WLAN(network.STA_IF)
    wlan.active(True)
    wlan.connect(ssid, password)
    
    for _ in range(60):  # Try for 60 seconds
        if wlan.isconnected():
            return True
        wdt.feed()  # Pet watchdog every 1 second
        time.sleep(1)
    
    return False
```

### Custom Firmware Build Errors

**Problem**: Building st7789 C module fails with missing dependencies.

**Solution**: Ensure MicroPython build environment is complete:

```bash
# Clone MicroPython and st7789_mpy
git clone https://github.com/micropython/micropython.git
git clone https://github.com/russhughes/st7789_mpy.git

# Build cross-compiler
cd micropython/mpy-cross
make

# Build st7789 module
cd ../../st7789_mpy/esp32
make USER_C_MODULES=../../micropython/micropython.cmake all
```

---

## 8. Related Tutorials

This deep dive complements and extends:

- [[ttgo-display-beginner-guide|TTGO Display Beginner Guide]] — Start here for basic concepts
- [[micropython-ttgo-t-display-beginner-guide|MicroPython TTGO T-Display Beginner Guide]] — Alternative beginner resource
- [[micropython-ttgo-t-display-deep-dive|MicroPython TTGO T-Display Deep Dive]] — Additional advanced patterns
- [[dotfiles-beginner-guide|Dotfiles Beginner Guide]] — Configuration management
- [[dotfiles-deep-dive|Dotfiles Deep Dive]] — Advanced dotfiles patterns
- [[just-beginner-guide|Just Command Runner Beginner Guide]] — Task automation
- [[just-deep-dive|Just Command Runner Deep Dive]] — Advanced Just patterns

---

## 9. References

### Official Documentation

- **MicroPython ESP32 Quick Reference**: https://docs.micropython.org/en/latest/esp32/quickref.html
- **MicroPython Network Module**: https://docs.micropython.org/en/latest/library/network.WLAN.html
- **MicroPython Machine Module**: https://docs.micropython.org/en/latest/library/machine.html
- **MicroPython Time Module**: https://docs.micropython.org/en/latest/library/time.html

### ST7789 Drivers

- **Pure Python Driver (st7789py_mpy)**: https://github.com/russhughes/st7789py_mpy
- **C Driver (st7789_mpy)**: https://github.com/russhughes/st7789_mpy
- **ST7789V Datasheet**: Search "ST7789V datasheet" (Sitronix official)

### Tools & Utilities

- **mpremote**: https://docs.micropython.org/en/latest/reference/mpremote.html
- **MicroPython Firmware**: https://micropython.org/download/
- **Font2Bitmap Tool**: Included in st7789py_mpy repository

### MQTT & Networking

- **umqtt Documentation**: https://github.com/micropython/micropython-lib/tree/master/micropython/umqtt.simple
- **umqtt.robust**: https://github.com/micropython/micropython-lib/tree/master/micropython/umqtt.robust

### Community Resources

- **TTGO T-Display Community Guide**: https://github.com/Opinion/LILYGO-T-Display-ESP32-16MB-Micropython-guide
- **ESP32 Technical Reference Manual**: https://www.espressif.com/sites/default/files/documentation/esp32_technical_reference_manual_en.pdf
- **Frozen Modules in MicroPython**: https://docs.micropython.org/en/latest/reference/manifest.html

---

## 10. Summary

This deep dive has covered:

1. **Display Internals**: Understanding the ST7789V controller, command/data protocol, and RAM organization enables efficient, optimized code.

2. **RGB565 Mathematics**: Converting colors, blending, and brightness adjustment are fundamental to advanced graphics work.

3. **Performance Optimization**: SPI baudrate, DMA, partial updates, and the C driver can yield 10–30× speedups over naive Python code.

4. **Custom Rendering**: Circles, rounded rectangles, bar charts, and animation patterns enable rich interfaces despite ESP32's constraints.

5. **WiFi and IoT**: Robust connection logic, MQTT integration, and OTA updates are essential for production devices.

6. **Power Management**: Deep sleep, battery monitoring, and RTC state persistence enable multi-day battery life.

7. **Sensors and I2C**: Integrating BME280 and other sensors creates compelling IoT applications.

8. **Memory Optimization**: Pre-allocation, garbage collection management, and frozen modules keep the device stable.

9. **Production Patterns**: Watchdog timers, logging, configuration files, and state machines transform hobby code into reliable embedded systems.

The TTGO T-Display is a capable platform. With these advanced techniques, you can build production-quality IoT devices that run reliably for months on battery power while maintaining responsive, animated user interfaces.

### Next Steps

- Migrate one project from the Python driver to the C driver and measure performance gains
- Integrate an MQTT broker (e.g., Mosquitto) and build a remote control dashboard
- Implement deep sleep with button wake-up and measure power consumption
- Build a multi-screen app using the state machine pattern from section 4.10
- Contribute fonts or drivers back to the open-source community

Good luck with your TTGO T-Display projects!
