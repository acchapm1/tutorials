---
title: "Karabiner-Elements Deep Dive"
date: 2026-05-02
difficulty: advanced
tags: [karabiner, keyboard, macOS, automation, remapping, home-row-mods, hyper-key, complex-modifications, shell-command, variables]
---

# Karabiner-Elements Deep Dive

## Overview

Karabiner-Elements is the modern (post-Sierra) keyboard remapping engine for macOS, enabling advanced input automation at the kernel level. Unlike its predecessor, Karabiner-Elements uses native macOS extension architecture to intercept HID events before the OS processes them, making it possible to:

- Remap any key to any key with modifier combinations
- Create modal layers (vim-style navigation, gaming modes, symbol layers)
- Detect simultaneous key presses for chording
- Execute shell commands triggered by key sequences
- Create app-specific rules with regex bundle ID matching
- Build state machines using variables and conditions
- Optimize for latency with millisecond-precision timing controls

This is the ongoing reference document for Karabiner-Elements. You'll find comprehensive coverage of internals, advanced patterns, edge cases, and architectural design rationale throughout.

For foundational concepts and first-time setup, see [[karabiner-elements-beginner-guide]].

**Related automation tools:**
- [[hammerspoon-deep-dive]] for advanced scripting and launcher integration
- [[yabai-deep-dive]] for window management shortcuts
- [[bunch-deep-dive]] for application state automation
- [[dotfiles-deep-dive]] for managing Karabiner configs via version control

---

## Prerequisites

### System Requirements
- **macOS 11 Big Sur or later** (Intel or Apple Silicon)
- **Karabiner-Elements 14.0+** installed and running
- System Preferences → Security & Privacy → Input Monitoring: Karabiner-Elements allowed
- System Preferences → Security & Privacy → Accessibility: Karabiner-Elements allowed (older macOS)
- For macOS Ventura/Sonoma/Sequoia: System Settings → Privacy & Security → System Extension Services approval

### Tools You'll Need
- Text editor (VS Code, Sublime, or macOS built-in)
- Terminal.app or iTerm2 for diagnostics
- EventViewer.app (comes with Karabiner-Elements package)
- Optional: Python, JavaScript, or Goku for config generation

### Knowledge Prerequisites
- Familiarity with JSON syntax
- Understanding of macOS keyboard modifiers (Cmd, Opt, Ctrl, Shift)
- Basic terminal commands for file navigation and logging
- Concept of regular expressions (for bundle ID matching)

---

## Key Concepts

### Karabiner Architecture

Karabiner-Elements operates at the kernel/HID driver level, intercepting keyboard and mouse input *before* the operating system processes it. This gives it unparalleled control over input devices.

#### The Interception Pipeline

```
Physical Keyboard
    ↓
Karabiner Grabber (kernel extension / system extension)
    ↓
HID Event Capture
    ↓
Manipulator Rules Evaluation
    ↓
Conditions Check (app, device, variables, etc.)
    ↓
Transformation / Command Execution
    ↓
Virtual Keyboard Output
    ↓
macOS Receives Modified Event
```

The key insight: Karabiner runs *before* macOS kernel sees the event. This is why it works in locked screens, full-screen apps, and even within game engines that bypass normal input handling.

#### karabiner_grabber vs karabiner_observer

Karabiner consists of two processes:

- **karabiner_grabber**: Runs as a system extension (post-Catalina) or kernel extension (pre-Catalina on Intel). This intercepts HID events and applies manipulator rules. It's the core engine—completely opaque to user code.

- **karabiner_observer**: Monitors system state (frontmost application, input source, device connections). It passes this data to the grabber so conditions can be evaluated.

On **Intel Macs with Big Sur or earlier**, Karabiner used traditional kernel extensions (kexts). On **Apple Silicon and recent Intel Macs**, it uses system extensions—a sandboxed, approved-by-Apple mechanism. The performance characteristics differ slightly; system extensions have marginally higher latency (1-2ms), but it's imperceptible.

#### Latency and Performance

- **HID event latency**: ~1-3ms on Intel kexts, ~3-5ms on system extensions
- **Manipulator evaluation**: <1ms for typical rules
- **Total end-to-end latency**: ~5-8ms from physical key press to screen response (acceptable for typing, gaming, and real-time tasks)

For comparison: typing on a mechanical keyboard vs. a Bluetooth keyboard varies by 10-50ms depending on hardware. Karabiner's latency is negligible.

### The Manipulator Model

A manipulator is Karabiner's atomic unit: a rule that transforms input. Every manipulator has:

1. **From Block**: What triggers the rule (key press, simultaneous keys, variable condition)
2. **To Block**: What happens when triggered (key press, shell command, variable setting)
3. **Conditions**: When the rule applies (app, device, variable state, input source)
4. **Parameters**: Timing controls, flags, and options

#### Anatomy of a From Block

```json
{
  "key_code": "a",
  "modifiers": {
    "mandatory": ["left_control"],
    "optional": ["left_shift", "left_option", "left_command"]
  }
}
```

**key_code**: The primary key. Karabiner recognizes ~200 key codes (letters, numbers, function keys, media keys). See `~/.config/karabiner/assets/key_code_map.json` for the complete list.

**modifiers**:
- **mandatory**: Modifiers that *must* be pressed for the rule to fire. Press Ctrl+A and the rule triggers.
- **optional**: Modifiers that *may* be pressed without preventing the rule. Press Shift+Ctrl+A? Still triggers.

Using `"mandatory": ["left_control"]` means: "only fire if left control is down." Using `"optional": ["any"]` means: "fire regardless of modifier state." If you don't specify modifiers, any modifier combination works.

#### Anatomy of a To Block

To blocks describe the output. A manipulator can have multiple to blocks (fired sequentially):

```json
{
  "key_code": "escape",
  "modifiers": ["left_shift"]
}
```

Or:

```json
{
  "shell_command": "open -a Terminal"
}
```

Or:

```json
{
  "set_variable": {
    "name": "mode",
    "value": 1
  }
}
```

**key_code**: Output a key (with optional modifiers).

**shell_command**: Execute a bash command. Runs with user privileges (important security note below).

**select_input_source**: Switch the input method (useful for language layouts).

**mouse_key**: Simulate mouse movement or clicks.

**set_variable**: Set a variable (for modal layers and state machines).

#### The "Lazy" Flag

```json
{
  "from": { "key_code": "a", "modifiers": { "mandatory": ["left_control"] } },
  "to": [{ "key_code": "x" }],
  "parameters": { "basic.to_if_held_down_threshold_milliseconds": 100 },
  "to_if_held_down": [{ "key_code": "y" }]
}
```

The `lazy` flag (on a to block) delays key-up events. When you press Ctrl+A:

1. Karabiner immediately presses `x`
2. Karabiner *waits* before sending the `x` key-up event
3. If you release Ctrl+A within 100ms, Karabiner sends `y` instead, then releases

This is essential for distinguishing "tap A to send X, but hold A to send Y."

```json
{
  "to": [{ "key_code": "escape", "lazy": true }],
  "to_if_held_down": [{ "key_code": "left_control" }]
}
```

This pattern (Caps Lock → Escape on tap, Control on hold) requires `lazy: true` on the escape output.

#### Event Ordering and Priority

Karabiner evaluates manipulators in the order they appear in the JSON. If two rules could both match the same key press:

```json
{
  "manipulators": [
    {
      "from": { "key_code": "a" },
      "to": [{ "key_code": "x" }]
    },
    {
      "from": { "key_code": "a" },
      "to": [{ "key_code": "y" }]
    }
  ]
}
```

Only the *first* matching rule fires. Order matters. Organize rules from most specific (most conditions, most modifiers) to most general (fewest conditions).

---

## Step-by-Step Instructions

### 1. Install and Enable Karabiner-Elements

```bash
# Install via Homebrew
brew install karabiner-elements

# Launch the app
open /Applications/Karabiner-Elements.app
```

Karabiner will request system extension approval. Approve it in:
- **macOS Ventura/Sonoma/Sequoia**: System Settings → Privacy & Security → System Extensions
- **macOS Monterey/Big Sur**: System Preferences → Security & Privacy → System Extensions (or during first launch)

Check that the green indicator appears in the menu bar. If red/yellow, you'll see a specific error. Refer to [[#Troubleshooting]].

### 2. Access Configuration Files

Karabiner stores configs at:

```
~/.config/karabiner/karabiner.json  # Main config
~/.config/karabiner/assets/         # Profiles, assets, key codes
```

The JSON structure:

```json
{
  "global": {
    "check_for_updates_on_startup": true,
    "show_in_menu_bar": true
  },
  "profiles": [
    {
      "name": "Default",
      "selected": true,
      "simple_modifications": [],
      "complex_modifications": {
        "rules": []
      }
    }
  ]
}
```

### 3. Understanding Simple vs. Complex Modifications

**Simple modifications** remap single keys without conditions:

```json
{
  "from": { "key_code": "caps_lock" },
  "to": [{ "key_code": "escape" }]
}
```

**Complex modifications** support all advanced features:
- Conditions (app-specific, device-specific, variable-based)
- Multiple to blocks
- Timing parameters
- Simultaneous key detection
- Shell commands

Always use complex modifications when you need anything beyond a 1-to-1 key remap.

### 4. Reload Configuration

Karabiner watches `karabiner.json` for changes. Changes reload automatically within 1-2 seconds. If they don't:

```bash
# Force reload
launchctl stop org.pqrs.Karabiner.grabber
launchctl start org.pqrs.Karabiner.grabber
```

Or restart via the menu bar icon: Karabiner-Elements → Restart.

### 5. Verify with EventViewer

Open **EventViewer.app** from the Karabiner-Elements menu:

```
Menu Bar Icon → Open EventViewer
```

EventViewer displays live HID events and Karabiner's transformations:

```
Timestamp: 2026-05-02 14:23:45.123456
Event Type: KEY_DOWN
Key Code: a (code: 0x00)
Modifiers: left_control (0x01000100)

[Karabiner Processing]
Matched Rule: "Ctrl+A → X"
Output: key_down X

Result: X appears on screen
```

Read every field:
- **Timestamp**: Microsecond precision for latency debugging
- **Key Code**: The physical key (useful for identifying correct key names)
- **Modifiers**: Bitmask of all pressed modifiers
- **Matched Rule**: Which manipulator fired (empty if no match)
- **Output**: The transformed key or command

---

## Practical Examples

### Example 1: Home Row Mods (ASDF JKL;)

This is the workhorse pattern for modal editing. Hold A and press another key to access the modifier:

```json
{
  "type": "basic",
  "from": { "key_code": "a" },
  "to": [{ "key_code": "left_control", "lazy": true }],
  "to_if_held_down": [{ "key_code": "left_control" }],
  "parameters": {
    "basic.to_if_held_down_threshold_milliseconds": 100
  },
  "to_if_alone_timeout_milliseconds": 100
}
```

But wait—this fires whenever you press A, even in text input. You need to disable it in apps where you actually type. Better pattern:

```json
{
  "type": "basic",
  "from": { "key_code": "a" },
  "to": [{ "key_code": "a", "lazy": true }],
  "to_if_held_down": [{ "key_code": "left_control" }],
  "conditions": [
    {
      "type": "frontmost_application_unless",
      "bundle_identifiers": [
        "com.apple.Terminal",
        "com.googlecode.iterm2",
        "com.vscode"
      ]
    }
  ],
  "parameters": {
    "basic.to_if_held_down_threshold_milliseconds": 100
  },
  "to_if_alone_timeout_milliseconds": 100
}
```

This outputs `a` on tap (in case you hold it briefly), but sends `left_control` when held past 100ms—but *only* when you're not in Terminal, iTerm, or VS Code.

Complete set for ASDF JKL;:

```json
{
  "type": "basic",
  "description": "A → Control (home row mod)",
  "from": { "key_code": "a" },
  "to": [{ "key_code": "a", "lazy": true }],
  "to_if_held_down": [{ "key_code": "left_control" }],
  "conditions": [
    {
      "type": "frontmost_application_unless",
      "bundle_identifiers": [
        "com.apple.Terminal",
        "com.googlecode.iterm2"
      ]
    }
  ],
  "parameters": {
    "basic.to_if_held_down_threshold_milliseconds": 150
  },
  "to_if_alone_timeout_milliseconds": 200
},
{
  "type": "basic",
  "description": "S → Option (home row mod)",
  "from": { "key_code": "s" },
  "to": [{ "key_code": "s", "lazy": true }],
  "to_if_held_down": [{ "key_code": "left_option" }],
  "conditions": [
    {
      "type": "frontmost_application_unless",
      "bundle_identifiers": ["com.apple.Terminal", "com.googlecode.iterm2"]
    }
  ],
  "parameters": {
    "basic.to_if_held_down_threshold_milliseconds": 150
  },
  "to_if_alone_timeout_milliseconds": 200
},
{
  "type": "basic",
  "description": "D → Shift (home row mod)",
  "from": { "key_code": "d" },
  "to": [{ "key_code": "d", "lazy": true }],
  "to_if_held_down": [{ "key_code": "left_shift" }],
  "conditions": [
    {
      "type": "frontmost_application_unless",
      "bundle_identifiers": ["com.apple.Terminal", "com.googlecode.iterm2"]
    }
  ],
  "parameters": {
    "basic.to_if_held_down_threshold_milliseconds": 150
  },
  "to_if_alone_timeout_milliseconds": 200
},
{
  "type": "basic",
  "description": "F → Command (home row mod)",
  "from": { "key_code": "f" },
  "to": [{ "key_code": "f", "lazy": true }],
  "to_if_held_down": [{ "key_code": "left_command" }],
  "conditions": [
    {
      "type": "frontmost_application_unless",
      "bundle_identifiers": ["com.apple.Terminal", "com.googlecode.iterm2"]
    }
  ],
  "parameters": {
    "basic.to_if_held_down_threshold_milliseconds": 150
  },
  "to_if_alone_timeout_milliseconds": 200
}
```

**Tuning**: Start with `to_if_held_down_threshold_milliseconds: 150` and `to_if_alone_timeout_milliseconds: 200`. If you feel lag, lower both by 50ms at a time. If you get false positives (accidentally triggering modifiers while typing fast), raise them by 50ms.

### Example 2: Caps Lock → Hyper/Escape

Caps Lock is almost universally unused. Remap it to Hyper (Ctrl+Opt+Shift+Cmd) when held, Escape when tapped:

```json
{
  "type": "basic",
  "description": "Caps Lock → Escape / Hyper",
  "from": { "key_code": "caps_lock" },
  "to": [{ "key_code": "escape", "lazy": true }],
  "to_if_held_down": [
    {
      "key_code": "left_control",
      "modifiers": ["left_option", "left_shift", "left_command"]
    }
  ],
  "parameters": {
    "basic.to_if_held_down_threshold_milliseconds": 200
  },
  "to_if_alone_timeout_milliseconds": 200
}
```

Now bind commands to Hyper+letter. For example, Hyper+T opens Terminal:

```json
{
  "type": "basic",
  "description": "Hyper+T → Open Terminal",
  "from": {
    "key_code": "t",
    "modifiers": {
      "mandatory": ["left_control", "left_option", "left_shift", "left_command"]
    }
  },
  "to": [{ "shell_command": "open -a Terminal" }]
}
```

### Example 3: hjkl Arrows with Held Right Command

Create a modal editing layer: hold Right Command, and hjkl become arrow keys:

```json
{
  "type": "basic",
  "description": "RCmd+H → Left Arrow",
  "from": {
    "key_code": "h",
    "modifiers": { "mandatory": ["right_command"] }
  },
  "to": [{ "key_code": "left_arrow" }]
},
{
  "type": "basic",
  "description": "RCmd+J → Down Arrow",
  "from": {
    "key_code": "j",
    "modifiers": { "mandatory": ["right_command"] }
  },
  "to": [{ "key_code": "down_arrow" }]
},
{
  "type": "basic",
  "description": "RCmd+K → Up Arrow",
  "from": {
    "key_code": "k",
    "modifiers": { "mandatory": ["right_command"] }
  },
  "to": [{ "key_code": "up_arrow" }]
},
{
  "type": "basic",
  "description": "RCmd+L → Right Arrow",
  "from": {
    "key_code": "l",
    "modifiers": { "mandatory": ["right_command"] }
  },
  "to": [{ "key_code": "right_arrow" }]
}
```

Extend with other navigation commands:

```json
{
  "type": "basic",
  "description": "RCmd+W → Option+Left (back word)",
  "from": {
    "key_code": "w",
    "modifiers": { "mandatory": ["right_command"] }
  },
  "to": [{ "key_code": "left_arrow", "modifiers": ["left_option"] }]
},
{
  "type": "basic",
  "description": "RCmd+E → Option+Right (forward word)",
  "from": {
    "key_code": "e",
    "modifiers": { "mandatory": ["right_command"] }
  },
  "to": [{ "key_code": "right_arrow", "modifiers": ["left_option"] }]
}
```

### Example 4: App-Specific Override (Disable Home Row Mods in Games)

You have home row mods, but they break gaming in Valorant:

```json
{
  "type": "basic",
  "description": "A → a (no mod in Valorant)",
  "from": { "key_code": "a" },
  "to": [{ "key_code": "a" }],
  "conditions": [
    {
      "type": "frontmost_application_if",
      "bundle_identifiers": ["com.riotgames.valorant"]
    }
  ]
}
```

Place this rule *before* your home row mod rule in the JSON. Karabiner will match this specific rule in Valorant and never reach the general home row mod rule.

### Example 5: Shell Commands - Paste Current Date

```json
{
  "type": "basic",
  "description": "Ctrl+Opt+D → Paste current date",
  "from": {
    "key_code": "d",
    "modifiers": {
      "mandatory": ["left_control", "left_option"]
    }
  },
  "to": [
    {
      "shell_command": "date '+%Y-%m-%d' | pbcopy"
    }
  ]
}
```

The shell command runs, captures the date, copies it to the clipboard. On the next keystroke, you can paste it.

Or, paste immediately:

```json
{
  "shell_command": "echo -n $(date '+%Y-%m-%d') | pbcopy; open -a 'System Events' -e 'keystroke (the clipboard)'"
}
```

(This is fragile. Better to use a dedicated launcher like [[hammerspoon-deep-dive]] or Raycast.)

### Example 6: Variables and Modal Layers

Use variables to build multi-layer systems. Toggle a "navigation mode" with a key, then access different bindings:

```json
{
  "type": "basic",
  "description": "Fn → Toggle navigation mode",
  "from": { "key_code": "fn" },
  "to": [
    {
      "set_variable": {
        "name": "nav_mode",
        "value": 1
      }
    }
  ],
  "to_if_held_down": [],
  "to_if_alone_timeout_milliseconds": 300
},
{
  "type": "basic",
  "description": "Fn (hold) → navigation_mode stays 1",
  "from": { "key_code": "fn" },
  "to": [],
  "parameters": {
    "basic.to_if_held_down_threshold_milliseconds": 150
  }
}
```

Wait, that's incomplete. Better pattern—use a toggle:

```json
{
  "type": "basic",
  "description": "Fn → Toggle nav_mode on/off",
  "from": { "key_code": "fn" },
  "to": [
    {
      "set_variable": {
        "name": "nav_mode",
        "value": 1
      }
    }
  ],
  "to_after_key_up": [
    {
      "set_variable": {
        "name": "nav_mode",
        "value": 0
      }
    }
  ]
}
```

Now bind navigation keys *only* when nav_mode is 1:

```json
{
  "type": "basic",
  "description": "Nav mode: H → Left (when nav_mode active)",
  "from": { "key_code": "h" },
  "to": [{ "key_code": "left_arrow" }],
  "conditions": [
    {
      "type": "variable_if",
      "name": "nav_mode",
      "value": 1
    }
  ]
}
```

This rule *only* fires if the variable `nav_mode` is 1. Outside that state, h is just h.

---

## Hands-On Exercises

### Exercise 1: Create Your First Home Row Mod

**Goal**: Remap the S key to output "s" normally, but "Option" when held.

1. Open `~/.config/karabiner/karabiner.json` in your editor.
2. Locate the `"complex_modifications"` → `"rules"` array in your default profile.
3. Add this manipulator:

```json
{
  "type": "basic",
  "description": "S → Option (home row mod)",
  "from": { "key_code": "s" },
  "to": [{ "key_code": "s", "lazy": true }],
  "to_if_held_down": [{ "key_code": "left_option" }],
  "parameters": {
    "basic.to_if_held_down_threshold_milliseconds": 150
  },
  "to_if_alone_timeout_milliseconds": 200
}
```

4. Save the file. Karabiner reloads automatically (watch the menu bar icon).
5. Open EventViewer and tap S. You should see `key_down s, key_up s`.
6. Hold S for 200ms. You should see `key_down left_option` (without s), then `key_up left_option`.

**Expected Output in EventViewer**:
```
Tap: key_down(a) → key_down(s) key_up(s)
Hold: key_down(a) 200ms → key_down(left_option)
      ... (key remains down)
      key_up(a) → key_up(left_option)
```

### Exercise 2: Add an App-Specific Disable

Your home row mod breaks typing in Terminal. Add a condition:

1. Find your S → Option rule.
2. Add a conditions array:

```json
{
  "type": "basic",
  "description": "S → Option (except Terminal)",
  "from": { "key_code": "s" },
  "to": [{ "key_code": "s", "lazy": true }],
  "to_if_held_down": [{ "key_code": "left_option" }],
  "conditions": [
    {
      "type": "frontmost_application_unless",
      "bundle_identifiers": ["com.apple.Terminal", "com.googlecode.iterm2"]
    }
  ],
  "parameters": {
    "basic.to_if_held_down_threshold_milliseconds": 150
  },
  "to_if_alone_timeout_milliseconds": 200
}
```

3. Save. Now test in Terminal: S should always output s, never trigger Option. Outside Terminal, hold S and it triggers Option.

**Verification**: Open Terminal, hold S for 2 seconds. No Option key appears. Switch to a text editor, hold S for 2 seconds. The screen selection jumps (Option+Left/Right moves by word).

### Exercise 3: Create a Hyper+Letter Shortcut

1. First, ensure you have Caps Lock → Hyper rule (from Example 2).
2. Add a rule for Hyper+T → Open Terminal:

```json
{
  "type": "basic",
  "description": "Hyper+T → Open Terminal",
  "from": {
    "key_code": "t",
    "modifiers": {
      "mandatory": ["left_control", "left_option", "left_shift", "left_command"]
    }
  },
  "to": [{ "shell_command": "open -a Terminal" }]
}
```

3. Save and test: press and release Caps Lock (sending Escape), then press Caps+T. Wait ~1 second. Terminal opens.

**Debugging**: If Terminal doesn't open, open EventViewer and check:
- Did you see `key_down(escape)` and `key_up(escape)` when you tapped Caps?
- Did you see `key_down(left_control, left_option, left_shift, left_command)` and `key_down(t)` when you pressed Caps+T?
- Did the "Matched Rule" show "Hyper+T → Open Terminal"?

### Exercise 4: Build a Navigation Layer with Variables

1. Create a rule that toggles a variable when you press the grave key (`):

```json
{
  "type": "basic",
  "description": "Grave → Toggle navigation mode",
  "from": { "key_code": "grave_accent_and_tilde" },
  "to": [
    {
      "set_variable": {
        "name": "nav_mode",
        "value": 1
      }
    }
  ],
  "to_after_key_up": [
    {
      "set_variable": {
        "name": "nav_mode",
        "value": 0
      }
    }
  ]
}
```

2. Add navigation rules that only work when nav_mode is 1:

```json
{
  "type": "basic",
  "description": "Nav: H → Left",
  "from": { "key_code": "h" },
  "to": [{ "key_code": "left_arrow" }],
  "conditions": [
    {
      "type": "variable_if",
      "name": "nav_mode",
      "value": 1
    }
  ]
},
{
  "type": "basic",
  "description": "Nav: L → Right",
  "from": { "key_code": "l" },
  "to": [{ "key_code": "right_arrow" }],
  "conditions": [
    {
      "type": "variable_if",
      "name": "nav_mode",
      "value": 1
    }
  ]
}
```

3. Test: Press and hold the grave key, then press H. You should see the cursor move left. Release the grave key, press H again. Now H types "h" normally.

**Verification in EventViewer**:
```
Grave press:
  key_down(grave) → set_variable(nav_mode=1)
H press (while holding grave):
  key_down(h) → matches "Nav: H → Left" because nav_mode=1
  key_down(left_arrow)
Grave release:
  key_up(grave) → set_variable(nav_mode=0)
```

---

## Troubleshooting

### Issue: Green indicator turns yellow/red

**Symptom**: The menu bar icon shows yellow "⚠" or red "✗".

**Diagnosis**: Check what Karabiner says:
```
Menu Bar Icon → Show Karabiner-Elements
```

Common issues:

1. **"Waiting for system extension approval"**: You haven't approved Karabiner in System Settings → Privacy & Security. Approve it.

2. **"System extension could not be loaded (Big Sur / Monterey)"**: Your system needs to authorize the kernel extension. Restart your Mac. During boot, you may see a system notification asking you to allow "com.pqrs.Karabiner.DriverKit.VirtualHIDDevice". Allow it.

3. **"Grab device error"**: Karabiner can't access your keyboard. Check System Preferences → Security & Privacy → Accessibility. Karabiner-Elements should be listed and checked. If not, add it:
   - Unlock the padlock (enter password)
   - Click + and navigate to /Applications/Karabiner-Elements.app
   - Restart Karabiner

4. **"Permission denied"**: On newer macOS, restart your Mac and approve the system extension again. Sometimes macOS updates revoke permissions.

### Issue: Rules aren't firing

**Diagnosis Steps**:

1. **Check EventViewer**: Open EventViewer and trigger your rule. Do you see the expected key press?
   - If no: Your key isn't being detected. Check the "Key Code" field. Maybe you named it wrong (e.g., `escape` vs. `escape_code`).
   - If yes: The key is detected but the rule isn't matching. Move to step 2.

2. **Check JSON syntax**: Paste your karabiner.json into a JSON validator (jsonlint.com). Karabiner won't load an invalid JSON file silently; check the menu bar icon for errors.

3. **Check rule order**: Rules are evaluated top-to-bottom. If a more general rule appears before your specific rule, the specific rule never fires. For example:

```json
{
  "from": { "key_code": "a" },
  "to": [{ "key_code": "x" }]
},
{
  "from": { "key_code": "a" },
  "to": [{ "key_code": "y" }],
  "conditions": [...]
}
```

The first rule matches `a` and fires, so the second rule is never reached. Reorder: put conditions-based rules first, generic rules last.

4. **Check modifiers**: If your rule has `"mandatory": ["left_control"]`, the rule *only* fires when left control is held. If you're testing without holding control, the rule won't fire. Verify in EventViewer that the modifier field shows the control key is pressed.

5. **Check conditions**: If your rule has conditions, all of them must be true for the rule to fire. For example:

```json
{
  "conditions": [
    { "type": "frontmost_application_if", "bundle_identifiers": ["com.example.MyApp"] },
    { "type": "variable_if", "name": "mode", "value": 1 }
  ]
}
```

This rule *only* fires in MyApp AND when mode=1. If you're testing outside MyApp, the rule won't fire.

### Issue: Keys are getting stuck (modifier stays pressed)

**Symptom**: You hold S for the home row mod, release it, but Option stays pressed. Subsequent keys are affected by Option.

**Cause**: The rule has `lazy: true` on the output, but the timeout is too short or the key-up event was lost.

**Fix**: Add a `to_after_key_up` block to explicitly reset:

```json
{
  "type": "basic",
  "from": { "key_code": "s" },
  "to": [{ "key_code": "s", "lazy": true }],
  "to_if_held_down": [{ "key_code": "left_option" }],
  "to_after_key_up": [{ "key_code": "left_option" }],  // Reset on release
  "parameters": {
    "basic.to_if_held_down_threshold_milliseconds": 150
  }
}
```

Or, nuclear option—restart Karabiner:

```bash
launchctl stop org.pqrs.Karabiner.grabber
launchctl start org.pqrs.Karabiner.grabber
```

### Issue: Latency or lag

**Symptom**: Key presses feel delayed. You type a few characters and they appear 200-300ms later.

**Diagnosis**:

1. **Is it Karabiner?** Disable Karabiner entirely (menu bar icon → Quit) and type. If latency vanishes, it's Karabiner. If latency persists, it's your keyboard or Mac.

2. **Check timing parameters**: If you have `to_if_held_down_threshold_milliseconds: 500` and `to_if_alone_timeout_milliseconds: 500`, *every* keystroke waits 500ms before confirming it's a tap. Reduce both to 150-200ms:

```json
{
  "parameters": {
    "basic.to_if_held_down_threshold_milliseconds": 150,
    "basic.to_if_alone_timeout_milliseconds": 200
  }
}
```

3. **Check simultaneous_threshold_milliseconds**: If you have a simultaneous rule with threshold > 100, you're adding latency. Reduce to 50ms:

```json
{
  "type": "basic",
  "from": {
    "simultaneous": [
      { "key_code": "a" },
      { "key_code": "s" }
    ],
    "simultaneous_threshold_milliseconds": 50
  },
  "to": [{ "key_code": "escape" }]
}
```

4. **Check shell_command rules**: If you have many shell_command rules, each one runs a subprocess, which takes ~100-200ms. Minimize shell_command usage. Use [[hammerspoon-deep-dive]] or Raycast for complex automation.

### Issue: Rule works in one app, breaks in another

**Symptom**: Your Caps Lock → Escape rule works in Firefox, but in VS Code, pressing Caps Lock opens the command palette instead.

**Cause**: VS Code is intercepting Caps Lock before Karabiner transforms it. This is extremely rare, but some apps (games, especially) handle raw HID input.

**Workaround**: Add a condition to disable the rule in that app:

```json
{
  "type": "basic",
  "from": { "key_code": "caps_lock" },
  "to": [{ "key_code": "escape" }],
  "conditions": [
    {
      "type": "frontmost_application_unless",
      "bundle_identifiers": ["com.microsoft.VSCode"]
    }
  ]
}
```

Or, contact the app developer to disable raw HID input.

### Issue: Finding Bundle Identifiers

Many rules require bundle identifiers for conditions. How do you find them?

**Method 1: mdls (Finder metadata)**
```bash
mdls -name kMDItemCFBundleIdentifier /Applications/Slack.app
# kMDItemCFBundleIdentifier = "com.tinyspeck.slackmacgap"
```

**Method 2: osascript (AppleScript)**
```bash
osascript -e "tell application \"Slack\" to get id of app bundle"
# com.tinyspeck.slackmacgap
```

**Method 3: EventViewer**
Open EventViewer, switch to the app, and look at the "Frontmost Application" field at the top.

**Method 4: Karabiner-Elements GUI**
Open the Karabiner-Elements preferences, find an existing complex modification that has an app condition, and look at its JSON. Copy the bundle identifier.

### Issue: Complex Modifications Not Showing

If you've created complex modifications but they don't appear in the Karabiner-Elements GUI:

1. **Check JSON syntax**: Invalid JSON is silently ignored.

```bash
jq . ~/.config/karabiner/karabiner.json
# If this prints an error, your JSON is broken. Fix it and try again.
```

2. **Check profile name**: Your rules must be in a profile that has `"selected": true`:

```json
{
  "profiles": [
    {
      "name": "Default",
      "selected": true,  // <-- This must be true
      "complex_modifications": { "rules": [ ... ] }
    }
  ]
}
```

3. **Restart Karabiner**:

```bash
launchctl stop org.pqrs.Karabiner.grabber
launchctl start org.pqrs.Karabiner.grabber
```

### Issue: macOS Ventura/Sonoma Permission Prompts

**Symptom**: You get repeated permission prompts when running shell_command rules.

**Cause**: Each shell_command runs as a subprocess, and some operations (opening apps, running scripts) trigger macOS security checks.

**Solution**: Pre-authorize the commands:

```bash
# For opening apps:
# Just run them once manually. macOS will ask for permission.
# Click "Allow" and it's remembered.

# For scripts, make them executable and sign them (complex).
# Simpler: Use AppleScript instead of bash:
```

Change your shell_command to use AppleScript:

```json
{
  "shell_command": "osascript -e 'tell application \"Terminal\" to activate'"
}
```

Or, use [[hammerspoon-deep-dive]] which runs in a long-lived process and doesn't trigger these prompts repeatedly.

---

## Architecture Deep Dive

### Conditions System

Karabiner's conditions determine whether a rule fires. All conditions in a rule must be true (AND logic).

#### frontmost_application_if / frontmost_application_unless

Match based on the active application's bundle identifier. Useful for app-specific rules.

```json
{
  "type": "frontmost_application_if",
  "bundle_identifiers": ["com.apple.Terminal", "com.googlecode.iterm2"]
}
```

This condition is true if the frontmost app is Terminal or iTerm.

**Regex support**: Bundle identifiers support regex:

```json
{
  "type": "frontmost_application_if",
  "bundle_identifiers": ["^com\\.jetbrains\\..*"]  // All JetBrains IDEs
}
```

Matches IntelliJ, PyCharm, WebStorm, etc.

#### device_if / device_unless

Match based on device properties (keyboard model, vendor ID, product ID).

```json
{
  "type": "device_if",
  "identifiers": [
    {
      "vendor_id": 0x0951,
      "product_id": 0x1666
    }
  ]
}
```

This rule fires *only* on a specific external keyboard (Kingston).

**How to find vendor/product IDs**:

```bash
ioreg -p IOUSBDEVICE -l -w 0 | grep -A10 "Keyboard"
# Look for idVendor and idProduct (in hex)
```

Or check Karabiner's devices list in System Report → Hardware → USB.

#### variable_if / variable_unless

Match based on a variable's value. Essential for modal layers.

```json
{
  "type": "variable_if",
  "name": "nav_mode",
  "value": 1
}
```

This rule fires *only* when the variable `nav_mode` equals 1.

#### input_source_if

Match based on the active input method (keyboard layout, IME).

```json
{
  "type": "input_source_if",
  "input_sources": [
    { "language": "en" }
  ]
}
```

Fires only when using English input.

```json
{
  "type": "input_source_if",
  "input_sources": [
    { "language": "ja" }
  ]
}
```

Fires only for Japanese IME.

#### keyboard_type_if

Match based on keyboard type (internal, external, Bluetooth).

```json
{
  "type": "keyboard_type_if",
  "keyboard_types": ["external"]
}
```

Fires only when using an external keyboard (useful for per-keyboard layouts).

#### Condition Evaluation Order

Karabiner evaluates conditions in the order they appear. If any condition is false, the entire rule is skipped (short-circuit evaluation). Organize conditions from most restrictive to least:

```json
{
  "conditions": [
    {
      "type": "device_if",
      "identifiers": [{ "vendor_id": 0x0951 }]
    },
    {
      "type": "frontmost_application_if",
      "bundle_identifiers": ["com.apple.Terminal"]
    },
    {
      "type": "variable_if",
      "name": "mode",
      "value": 1
    }
  ]
}
```

If the device is wrong, Karabiner skips the other conditions (fast). If the device is right but the app is wrong, it skips variable checking.

### Variables and Modal Layers

Variables are the foundation of advanced Karabiner. They're global state that persists across key presses.

#### set_variable in to Blocks

```json
{
  "to": [
    {
      "set_variable": {
        "name": "editing_mode",
        "value": 1
      }
    }
  ]
}
```

This sets `editing_mode` to 1. The variable persists until explicitly changed or the system restarts.

#### Multi-Layer Systems

Build a complex editing environment with multiple layers:

```json
[
  {
    "type": "basic",
    "description": "Fn → layer_1=1, layer_2=0",
    "from": { "key_code": "fn" },
    "to": [
      { "set_variable": { "name": "layer_1", "value": 1 } },
      { "set_variable": { "name": "layer_2", "value": 0 } }
    ],
    "to_after_key_up": [
      { "set_variable": { "name": "layer_1", "value": 0 } }
    ]
  },
  {
    "type": "basic",
    "description": "LCmd → layer_2=1, layer_1=0",
    "from": { "key_code": "left_command" },
    "to": [
      { "set_variable": { "name": "layer_2", "value": 1 } },
      { "set_variable": { "name": "layer_1", "value": 0 } }
    ],
    "to_after_key_up": [
      { "set_variable": { "name": "layer_2", "value": 0 } }
    ]
  },
  {
    "description": "Layer 1: H→Left",
    "from": { "key_code": "h" },
    "to": [{ "key_code": "left_arrow" }],
    "conditions": [
      { "type": "variable_if", "name": "layer_1", "value": 1 }
    ]
  },
  {
    "description": "Layer 2: H→Home",
    "from": { "key_code": "h" },
    "to": [{ "key_code": "home" }],
    "conditions": [
      { "type": "variable_if", "name": "layer_2", "value": 1 }
    ]
  }
]
```

Now:
- Hold Fn: H becomes Left Arrow
- Hold Left Command: H becomes Home
- Release either modifier: H is just H

#### Variables That Get Stuck: Prevention

If a variable is set but never reset, it persists forever (until restart). Use `to_after_key_up` to guarantee cleanup:

```json
{
  "from": { "key_code": "fn" },
  "to": [{ "set_variable": { "name": "mode", "value": 1 } }],
  "to_after_key_up": [{ "set_variable": { "name": "mode", "value": 0 } }]
}
```

This rule sets `mode=1` on key-down and `mode=0` on key-up, guaranteed.

### Simultaneous Key Detection

The `simultaneous` manipulator type fires when multiple keys are pressed within a threshold.

```json
{
  "type": "basic",
  "from": {
    "simultaneous": [
      { "key_code": "a" },
      { "key_code": "s" }
    ],
    "simultaneous_threshold_milliseconds": 50
  },
  "to": [{ "key_code": "escape" }]
}
```

If you press A and S within 50ms of each other, send Escape. Otherwise, both keys register normally.

**Use Cases**:
- A+S → Escape (chording)
- J+K → Mode toggle (modal editing)
- Spacebar+S → Symbol layer

**Timing**: The threshold is 50ms by default. Lower thresholds (< 50ms) require fast fingers and feel snappy. Higher thresholds (> 100ms) feel laggy. Start at 50ms and adjust based on feel.

**With Modifiers**: Combine simultaneous with modifiers:

```json
{
  "from": {
    "simultaneous": [
      { "key_code": "a", "modifiers": { "mandatory": ["left_control"] } },
      { "key_code": "s" }
    ],
    "simultaneous_threshold_milliseconds": 50
  },
  "to": [{ "key_code": "f1" }]
}
```

Ctrl+A and S pressed together → F1.

### Timing Parameters in Depth

Karabiner has multiple timing controls. Understanding each is crucial for comfortable typing.

#### to_if_alone_timeout_milliseconds

Default: 1000ms

After a key press, Karabiner waits this long to determine if it's a "tap" (alone) or a "hold" (with modifiers or followed by other keys).

```json
{
  "from": { "key_code": "s" },
  "to": [{ "key_code": "s" }],
  "to_if_held_down": [{ "key_code": "left_option" }],
  "to_if_alone_timeout_milliseconds": 200
}
```

- Press and release S within 200ms → outputs "s"
- Press and hold S past 200ms → outputs "left_option"

**Tuning**: Start at 200ms for home row mods. If you get false positives (accidentally triggering modifiers), increase to 250ms. If you feel lag, decrease to 150ms.

#### to_if_held_down_threshold_milliseconds

Default: 500ms

How long a key must be held before `to_if_held_down` is considered. Different from `to_if_alone_timeout_milliseconds`.

```json
{
  "parameters": {
    "basic.to_if_held_down_threshold_milliseconds": 150
  }
}
```

If you hold a key for 150ms, Karabiner evaluates the "held down" branch.

**Interaction**: These two work together:
- Hold key < to_if_held_down_threshold → waiting for timeout
- Hold key >= to_if_held_down_threshold → immediately enter "held down" state
- Release before timeout → execute "to" block (tap)
- Release after timeout → execute "to_if_held_down" block (hold)

#### simultaneous_threshold_milliseconds

Default: 50ms

For simultaneous manipulators, how close two keys must be pressed.

```json
{
  "simultaneous_threshold_milliseconds": 50
}
```

Requires tuning based on your speed. Gamers often lower to 30ms.

#### basic.to_delayed_action_delay_milliseconds

Default: 100ms (for delayed_action manipulators)

Rarely used directly. Useful for double-tap detection:

```json
{
  "type": "basic",
  "from": { "key_code": "space" },
  "to": [{ "key_code": "space" }],
  "to_if_held_down": [{ "set_variable": { "name": "layer", "value": 1 } }],
  "to_after_key_up": [{ "set_variable": { "name": "layer", "value": 0 } }],
  "parameters": {
    "basic.to_if_held_down_threshold_milliseconds": 150
  }
}
```

This doesn't use `basic.to_delayed_action_delay_milliseconds` directly, but illustrates the concept.

#### Per-Manipulator Overrides

Default timing applies globally, but you can override per-rule:

```json
{
  "type": "basic",
  "from": { "key_code": "a" },
  "to": [{ "key_code": "a", "lazy": true }],
  "to_if_held_down": [{ "key_code": "left_control" }],
  "parameters": {
    "basic.to_if_held_down_threshold_milliseconds": 100,
    "basic.to_if_alone_timeout_milliseconds": 150
  }
}
```

This rule has custom timings; global settings don't apply.

#### How to Tune: The Iterative Approach

1. Start with defaults.
2. Type for 5 minutes. Note any discomfort.
3. If false positives (modifiers triggering accidentally): increase `to_if_held_down_threshold_milliseconds` by 50ms.
4. If lag: decrease both parameters by 50ms.
5. Repeat until comfortable (usually 1-3 iterations).

---

## Profiles and Configuration Management

### Profile System

A profile is a complete set of key mappings, conditions, and parameters. Switch profiles to change your entire keyboard behavior.

```json
{
  "profiles": [
    {
      "name": "Typing",
      "selected": true,
      "complex_modifications": { "rules": [ ... ] }
    },
    {
      "name": "Gaming",
      "selected": false,
      "complex_modifications": { "rules": [ ... ] }
    }
  ]
}
```

Only one profile has `"selected": true` at a time.

### Profile-Switching

Bind a key to switch profiles:

```bash
# Shell command to switch profiles
defaults write org.pqrs.Karabiner.plist selectedProfile "Gaming"

# Karabiner recognizes this and switches
```

Karabiner rule:

```json
{
  "type": "basic",
  "description": "Hyper+P → Switch Gaming profile",
  "from": {
    "key_code": "p",
    "modifiers": { "mandatory": ["left_control", "left_option", "left_shift", "left_command"] }
  },
  "to": [
    {
      "shell_command": "defaults write org.pqrs.Karabiner.plist selectedProfile 'Gaming'"
    }
  ]
}
```

After the command runs, restart Karabiner to load the new profile (or Karabiner reloads automatically, depending on version).

### Organizing Large Configurations

For complex setups, organize rules across multiple files using Goku or Python.

#### Goku (Recommended)

[Goku](https://github.com/yqrashawn/GokuRakutenushi) is a Clojure-based Karabiner configuration language.

```clojure
{
  :main [
    {:des "Home row mods"
     :rules [
       [:a [:left_control nil] {:held "left_control" :alone "a"}]
       [:s [:left_option nil] {:held "left_option" :alone "s"}]
     ]}
    {:des "Navigation layer"
     :rules [
       [:<grave> {:set ["nav" 1]} {:afterup {:set ["nav" 0]}}]
       [[:h :!nav] :left_arrow]
     ]}
  ]
}
```

Goku compiles to JSON automatically. This is far more readable than raw JSON.

Install: `brew install yqrashawn/goku/goku`

#### Python

```python
import json

def generate_home_row_mod(key, output):
    return {
        "type": "basic",
        "from": {"key_code": key},
        "to": [{"key_code": key, "lazy": True}],
        "to_if_held_down": [{"key_code": output}],
        "parameters": {
            "basic.to_if_held_down_threshold_milliseconds": 150
        }
    }

rules = [
    generate_home_row_mod("a", "left_control"),
    generate_home_row_mod("s", "left_option"),
]

config = {
    "global": {},
    "profiles": [{
        "name": "Default",
        "selected": True,
        "complex_modifications": {"rules": rules}
    }]
}

with open(os.path.expanduser("~/.config/karabiner/karabiner.json"), "w") as f:
    json.dump(config, f, indent=2)
```

### assets/complex_modifications/*.json Discovery

Karabiner auto-discovers JSON files in `~/.config/karabiner/assets/complex_modifications/`. You can organize rules there:

```bash
~/.config/karabiner/assets/complex_modifications/
  ├── home-row-mods.json
  ├── navigation-layer.json
  ├── gaming-profile.json
  └── shell-commands.json
```

But Karabiner doesn't automatically include them in karabiner.json. You must manually reference them or merge them programmatically.

---

## Advanced Patterns

### Double-Tap Detection

Detect if a key is pressed twice in quick succession:

```json
{
  "type": "basic",
  "description": "Space (double-tap) → period",
  "from": { "key_code": "space" },
  "to": [{ "key_code": "space" }],
  "to_if_held_down": [{ "set_variable": { "name": "space_count", "value": 1 } }],
  "to_after_key_up": [
    { "set_variable": { "name": "space_count", "value": 0 } }
  ],
  "parameters": {
    "basic.to_if_held_down_threshold_milliseconds": 50
  }
}
```

Actually, detecting double-taps is complex in Karabiner without external tools. Better approach: use a different key or combination. Alternatively, use [[hammerspoon-deep-dive]] which has a built-in double-tap library.

### Sticky Modifiers

A modifier that stays active until you press a key:

```json
{
  "type": "basic",
  "description": "Fn (tap) → sticky shift",
  "from": { "key_code": "fn" },
  "to": [{ "set_variable": { "name": "sticky_shift", "value": 1 } }],
  "to_if_held_down": [{ "set_variable": { "name": "sticky_shift", "value": 0 } }],
  "to_after_key_up": [{ "set_variable": { "name": "sticky_shift", "value": 0 } }],
  "parameters": {
    "basic.to_if_held_down_threshold_milliseconds": 200
  }
},
{
  "type": "basic",
  "description": "Any key (with sticky_shift) → shifted",
  "from": { "key_code": "a" },  // Apply to all keys (pattern: iterate)
  "to": [{ "key_code": "a", "modifiers": ["left_shift"] }],
  "conditions": [
    { "type": "variable_if", "name": "sticky_shift", "value": 1 }
  ]
}
```

Press Fn (tap) once. Shift stays active. Press any key (e.g., A), and it outputs Shift+A. Now Shift is released.

**Caveat**: You'd need to repeat this for *every* key. Karabiner doesn't support wildcards in from blocks. Use [[hammerspoon-deep-dive]] for cleaner sticky modifier support.

### Leader Key Sequences

A vim-style leader key that starts a chord:

```json
{
  "type": "basic",
  "description": "Space (leader key)",
  "from": { "key_code": "space" },
  "to": [{ "set_variable": { "name": "leader", "value": 1 } }],
  "to_after_key_up": [{ "set_variable": { "name": "leader", "value": 0 } }]
},
{
  "type": "basic",
  "description": "Leader + W → close window",
  "from": { "key_code": "w" },
  "to": [{ "key_code": "w", "modifiers": ["left_command"] }],
  "conditions": [
    { "type": "variable_if", "name": "leader", "value": 1 }
  ]
},
{
  "type": "basic",
  "description": "Leader + Q → quit app",
  "from": { "key_code": "q" },
  "to": [{ "key_code": "q", "modifiers": ["left_command"] }],
  "conditions": [
    { "type": "variable_if", "name": "leader", "value": 1 }
  ]
}
```

Press Space (sets leader=1), then immediately press W. Karabiner sees leader=1 and outputs Cmd+W (close window).

### Per-Device Layouts

Different key mappings for your built-in keyboard vs. external keyboard:

```json
{
  "type": "basic",
  "description": "Built-in: A → left_control",
  "from": { "key_code": "a" },
  "to": [{ "key_code": "left_control" }],
  "conditions": [
    { "type": "keyboard_type_if", "keyboard_types": ["internal"] }
  ]
},
{
  "type": "basic",
  "description": "External: A → left_option",
  "from": { "key_code": "a" },
  "to": [{ "key_code": "left_option" }],
  "conditions": [
    { "type": "keyboard_type_if", "keyboard_types": ["external"] }
  ]
}
```

Now your built-in keyboard has A→Ctrl, but your external keyboard has A→Option.

### Mouse Button Remapping

```json
{
  "type": "basic",
  "from": { "pointing_button": "button1" },
  "to": [{ "pointing_button": "button2" }]
}
```

Left mouse button → right mouse button. Less useful than keyboard remapping (Karabiner supports basic mouse rebinding, but complex rules are limited).

### Consumer Key Codes (Media Keys)

```json
{
  "type": "basic",
  "description": "Ctrl+Opt+1 → Volume down",
  "from": {
    "key_code": "1",
    "modifiers": { "mandatory": ["left_control", "left_option"] }
  },
  "to": [{ "consumer_key_code": "volume_decrement" }]
},
{
  "type": "basic",
  "description": "Ctrl+Opt+2 → Volume up",
  "from": {
    "key_code": "2",
    "modifiers": { "mandatory": ["left_control", "left_option"] }
  },
  "to": [{ "consumer_key_code": "volume_increment" }]
}
```

Consumer key codes: `volume_decrement`, `volume_increment`, `rewind`, `play_pause`, etc.

---

## Worked Examples Appendix

### 1. Complete Home Row Mods File

Full, pasteable JSON with all eight home row mods (ASDF JKL;) plus proper tuning:

```json
{
  "global": {
    "check_for_updates_on_startup": true,
    "show_in_menu_bar": true
  },
  "profiles": [
    {
      "name": "Default",
      "selected": true,
      "simple_modifications": [],
      "complex_modifications": {
        "rules": [
          {
            "type": "basic",
            "description": "A → Control",
            "from": { "key_code": "a" },
            "to": [{ "key_code": "a", "lazy": true }],
            "to_if_held_down": [{ "key_code": "left_control" }],
            "conditions": [
              {
                "type": "frontmost_application_unless",
                "bundle_identifiers": ["com.apple.Terminal", "com.googlecode.iterm2"]
              }
            ],
            "parameters": {
              "basic.to_if_held_down_threshold_milliseconds": 150
            },
            "to_if_alone_timeout_milliseconds": 200
          },
          {
            "type": "basic",
            "description": "S → Option",
            "from": { "key_code": "s" },
            "to": [{ "key_code": "s", "lazy": true }],
            "to_if_held_down": [{ "key_code": "left_option" }],
            "conditions": [
              {
                "type": "frontmost_application_unless",
                "bundle_identifiers": ["com.apple.Terminal", "com.googlecode.iterm2"]
              }
            ],
            "parameters": {
              "basic.to_if_held_down_threshold_milliseconds": 150
            },
            "to_if_alone_timeout_milliseconds": 200
          },
          {
            "type": "basic",
            "description": "D → Shift",
            "from": { "key_code": "d" },
            "to": [{ "key_code": "d", "lazy": true }],
            "to_if_held_down": [{ "key_code": "left_shift" }],
            "conditions": [
              {
                "type": "frontmost_application_unless",
                "bundle_identifiers": ["com.apple.Terminal", "com.googlecode.iterm2"]
              }
            ],
            "parameters": {
              "basic.to_if_held_down_threshold_milliseconds": 150
            },
            "to_if_alone_timeout_milliseconds": 200
          },
          {
            "type": "basic",
            "description": "F → Command",
            "from": { "key_code": "f" },
            "to": [{ "key_code": "f", "lazy": true }],
            "to_if_held_down": [{ "key_code": "left_command" }],
            "conditions": [
              {
                "type": "frontmost_application_unless",
                "bundle_identifiers": ["com.apple.Terminal", "com.googlecode.iterm2"]
              }
            ],
            "parameters": {
              "basic.to_if_held_down_threshold_milliseconds": 150
            },
            "to_if_alone_timeout_milliseconds": 200
          },
          {
            "type": "basic",
            "description": "J → Control",
            "from": { "key_code": "j" },
            "to": [{ "key_code": "j", "lazy": true }],
            "to_if_held_down": [{ "key_code": "left_control" }],
            "conditions": [
              {
                "type": "frontmost_application_unless",
                "bundle_identifiers": ["com.apple.Terminal", "com.googlecode.iterm2"]
              }
            ],
            "parameters": {
              "basic.to_if_held_down_threshold_milliseconds": 150
            },
            "to_if_alone_timeout_milliseconds": 200
          },
          {
            "type": "basic",
            "description": "K → Option",
            "from": { "key_code": "k" },
            "to": [{ "key_code": "k", "lazy": true }],
            "to_if_held_down": [{ "key_code": "left_option" }],
            "conditions": [
              {
                "type": "frontmost_application_unless",
                "bundle_identifiers": ["com.apple.Terminal", "com.googlecode.iterm2"]
              }
            ],
            "parameters": {
              "basic.to_if_held_down_threshold_milliseconds": 150
            },
            "to_if_alone_timeout_milliseconds": 200
          },
          {
            "type": "basic",
            "description": "L → Shift",
            "from": { "key_code": "l" },
            "to": [{ "key_code": "l", "lazy": true }],
            "to_if_held_down": [{ "key_code": "left_shift" }],
            "conditions": [
              {
                "type": "frontmost_application_unless",
                "bundle_identifiers": ["com.apple.Terminal", "com.googlecode.iterm2"]
              }
            ],
            "parameters": {
              "basic.to_if_held_down_threshold_milliseconds": 150
            },
            "to_if_alone_timeout_milliseconds": 200
          },
          {
            "type": "basic",
            "description": "; → Command",
            "from": { "key_code": "semicolon" },
            "to": [{ "key_code": "semicolon", "lazy": true }],
            "to_if_held_down": [{ "key_code": "left_command" }],
            "conditions": [
              {
                "type": "frontmost_application_unless",
                "bundle_identifiers": ["com.apple.Terminal", "com.googlecode.iterm2"]
              }
            ],
            "parameters": {
              "basic.to_if_held_down_threshold_milliseconds": 150
            },
            "to_if_alone_timeout_milliseconds": 200
          }
        ]
      }
    }
  ]
}
```

### 2. Caps Lock → Hyper/Escape

```json
{
  "type": "basic",
  "description": "Caps Lock → Escape / Hyper",
  "from": { "key_code": "caps_lock" },
  "to": [{ "key_code": "escape", "lazy": true }],
  "to_if_held_down": [
    {
      "key_code": "left_control",
      "modifiers": ["left_option", "left_shift", "left_command"]
    }
  ],
  "parameters": {
    "basic.to_if_held_down_threshold_milliseconds": 200
  },
  "to_if_alone_timeout_milliseconds": 200
}
```

### 3. Multi-Layer Navigation System

```json
[
  {
    "type": "basic",
    "description": "Grave (leader key) → Navigation mode",
    "from": { "key_code": "grave_accent_and_tilde" },
    "to": [{ "set_variable": { "name": "nav_mode", "value": 1 } }],
    "to_after_key_up": [{ "set_variable": { "name": "nav_mode", "value": 0 } }]
  },
  {
    "type": "basic",
    "description": "Nav: H → Left",
    "from": { "key_code": "h" },
    "to": [{ "key_code": "left_arrow" }],
    "conditions": [
      { "type": "variable_if", "name": "nav_mode", "value": 1 }
    ]
  },
  {
    "type": "basic",
    "description": "Nav: J → Down",
    "from": { "key_code": "j" },
    "to": [{ "key_code": "down_arrow" }],
    "conditions": [
      { "type": "variable_if", "name": "nav_mode", "value": 1 }
    ]
  },
  {
    "type": "basic",
    "description": "Nav: K → Up",
    "from": { "key_code": "k" },
    "to": [{ "key_code": "up_arrow" }],
    "conditions": [
      { "type": "variable_if", "name": "nav_mode", "value": 1 }
    ]
  },
  {
    "type": "basic",
    "description": "Nav: L → Right",
    "from": { "key_code": "l" },
    "to": [{ "key_code": "right_arrow" }],
    "conditions": [
      { "type": "variable_if", "name": "nav_mode", "value": 1 }
    ]
  }
]
```

---

## Related Tutorials

This deep-dive pairs with companion resources:

- [[karabiner-elements-beginner-guide]] — Start here for first-time setup and simple remaps
- [[hammerspoon-deep-dive]] — Advanced scripting, app launcher integration, window management
- [[yabai-deep-dive]] — Tiling window manager that pairs perfectly with Karabiner shortcuts
- [[bunch-deep-dive]] — Application automation that complements Karabiner's input triggering
- [[sketchybar-deep-dive]] — Status bar customization via shell commands from Karabiner
- [[dotfiles-deep-dive]] — Version control strategy for managing karabiner.json
- [[chezmoi-deep-dive]] — Automated dotfile management including Karabiner configs
- [[hammerspoon-beginner-guide]] — Foundation for Hammerspoon integration
- [[yabai-beginner-guide]] — Foundation for window management
- [[macos-app-layout-deep-dive]] — Layout systems that work with Karabiner shortcuts
- [[moom-deep-dive]] — Alternative window management tool
- [[sesh-deep-dive]] — Terminal session management for keyboard-driven workflows

---

## References

- **Karabiner-Elements Official**: https://karabiner-elements.pqrs.org/
- **GitHub Repository**: https://github.com/pqrs-org/Karabiner-Elements
- **EventViewer Documentation**: Built-in to Karabiner; open via menu bar
- **Goku Configuration Language**: https://github.com/yqrashawn/GokuRakutenushi
- **Karabiner.ts**: TypeScript config generator (community)
- **macOS Bundle Identifier Discovery**: `mdls -name kMDItemCFBundleIdentifier /Applications/<App>.app`

---

## Summary

Karabiner-Elements is the definitive keyboard automation engine for macOS. This deep-dive covered:

1. **Architecture**: How Karabiner intercepts HID events at the kernel level before macOS sees them
2. **The Manipulator Model**: From/to blocks, modifiers, lazy flags, and event ordering
3. **Conditions System**: App-specific, device-specific, variable-based, and input-source conditions
4. **Variables and Modal Layers**: Building complex editing modes and state machines
5. **Timing Parameters**: Tuning to_if_alone_timeout, to_if_held_down_threshold, and simultaneous_threshold for comfortable typing
6. **Advanced Patterns**: Home row mods, Hyper key, navigation layers, shell commands, double-tap detection
7. **Configuration Management**: Organizing large setups with Goku, Python, or profiles
8. **Practical Examples**: Copy-paste JSON for common use cases (home row mods, Caps→Hyper, hjkl arrows, multi-layer systems)
9. **Comprehensive Troubleshooting**: Permission issues, stuck keys, latency diagnosis, bundle ID discovery

Start simple with home row mods or a Caps Lock remap. Once comfortable, layer in app-specific conditions, variables for modal editing, and shell command shortcuts. The key insight: Karabiner operates *before* the OS, making it the lowest-level, most powerful input automation tool available.

For foundational concepts, see [[karabiner-elements-beginner-guide]]. For scripting and system integration, see [[hammerspoon-deep-dive]].
