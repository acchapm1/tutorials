---
title: "Karabiner-Elements Beginner Guide"
date: 2026-05-02
difficulty: beginner
tags: [karabiner, keyboard, macOS, automation, remapping, home-row-mods, hyper-key]
---

# Karabiner-Elements Beginner Guide

## Overview

Karabiner-Elements is a powerful keyboard remapping tool for macOS that intercepts what your keyboard sends to your computer and transforms it before anything else sees it. Unlike macOS's built-in keyboard remapping (which only works in some apps), Karabiner works *everywhere*—web browsers, terminals, PDFs, everywhere.

If you've wanted to:
- Make Caps Lock useful (it's one of the least-used keys on your keyboard)
- Create custom modifier keys with dual purposes (tap for one thing, hold for another)
- Build "home row mods" so ASDF become modifiers when held down
- Construct a Hyper key (⌃⌥⇧⌘) for launching applications
- Fix an annoying keyboard layout when traveling

...then Karabiner is your tool.

This guide takes you from "I just installed it" to "I have a working config with home row mods and a Hyper key," with clear explanations of *why* each piece matters and where things can go wrong.

**What you'll learn:**
1. How Karabiner actually works under the hood
2. The fundamental building block: the manipulator
3. The tap-vs-hold pattern that makes dual-purpose keys possible
4. Home row modifiers that turn ASDF and JKL; into efficient modifier keys
5. Layer keys like Caps Lock and Fn for powerful shortcuts
6. How to debug when things don't work as expected

**Estimated time:** 45 minutes to a working config; 2 hours if you're exploring as you go.

---

## Prerequisites

Before you start, make sure you have:

### Required
- **macOS 11 (Big Sur) or newer**. Karabiner uses system extensions, and earlier versions don't support them.
- **Karabiner-Elements installed**. Download from [karabiner-elements.pqrs.org](https://karabiner-elements.pqrs.org/), not from the Mac App Store.
- **Comfort with JSON**. You'll be editing JSON config files. If `{"key": "value"}` makes sense to you, you're fine.
- **Terminal basics**. You'll run a few commands, but nothing complex.
- **A standard macOS keyboard or external keyboard**. Karabiner works with any HID keyboard.

### Recommended
- **A text editor** like VS Code or vim that can open JSON files cleanly
- **5 minutes to read** about your Mac's security model (System Integrity Protection, Input Monitoring) if you haven't before
- **Patience with the first week**. This will misfire for the first week. That's normal. We'll debug it.

### Not needed
- C++ or C skills (Karabiner does the heavy lifting)
- A custom keyboard (external keyboards work great, but the built-in keyboard is fine too)
- Knowledge of complex macOS automation

---

## Key Concepts

Before we build anything, let's understand what Karabiner *is* and what it isn't.

### What Karabiner Does (The Kernel Extension Model)

When you press a key, here's the journey:
1. **Keyboard → USB/Bluetooth → macOS kernel**
2. **Karabiner's kernel extension (grabber)** intercepts this *before* the OS processes it
3. Karabiner transforms it according to your rules
4. **macOS sees the transformed key press**
5. Applications see only the final result

This is why Karabiner works everywhere—it lives at the kernel level, below all applications.

```
Your Keyboard
     ↓
[HID Event]
     ↓
Karabiner Grabber (kernel extension intercepts)
     ↓
Rules Engine (apply your config)
     ↓
Transform event
     ↓
macOS Kernel sees [modified event]
     ↓
Applications
```

This is *also* why you need special macOS permissions for Karabiner to work—the OS doesn't let arbitrary programs intercept keyboard input.

### The Four Pieces of Karabiner

Karabiner-Elements has four main components:

1. **karabiner_grabber** — The kernel extension that intercepts keyboard events. When you press a key, this is what sees it first.

2. **karabiner_observer** — A background daemon that watches for keyboard and mouse changes, and tells Karabiner when devices are plugged in or unplugged.

3. **Karabiner-Elements.app** — The GUI application. This is what you see in your Applications folder. It's purely for convenience; you could manage everything via config files if you wanted to.

4. **~/.config/karabiner/karabiner.json** — Your config file. This is where your actual rules live. The app is just a UI wrapper around this file.

For this guide, we'll focus on pieces 3 and 4: the app (for enabling/disabling rules) and the config file (for writing rules).

### macOS Permissions

Karabiner needs three permissions to work:

1. **System Extensions / Kernel Extension** — Without this, karabiner_grabber can't intercept keyboard input. When you first launch Karabiner, macOS will prompt you, and you may need to:
   - Go to System Preferences → Security & Privacy → General
   - Find "System Extension Blocked" or similar
   - Click "Allow"
   - Possibly restart your Mac

2. **Input Monitoring** — Without this, Karabiner can't see what you're typing in secure contexts (Terminal, password fields, etc.). Grant this in:
   - System Preferences → Security & Privacy → Input Monitoring
   - Add Karabiner-Elements.app and karabiner_grabber

3. **Accessibility** — Karabiner needs this to modify keyboard input. Grant this in:
   - System Preferences → Security & Privacy → Accessibility
   - Add Karabiner-Elements.app

If any of these are missing, Karabiner will silently stop working in certain contexts.

### Simple Modifications vs. Complex Modifications

Karabiner has two types of rules:

**Simple Modifications** — One key maps to one other key. Example: "Caps Lock → Control"
```json
{
  "from": {"key_code": "caps_lock"},
  "to": [{"key_code": "left_control"}]
}
```

**Complex Modifications** — Multiple conditions, timing logic, tap-vs-hold, etc. Example: "Caps Lock → Control when held, Escape when tapped"
```json
{
  "from": {"key_code": "caps_lock"},
  "to": [{"key_code": "left_control"}],
  "to_if_alone": [{"key_code": "escape"}],
  "parameters": {"basic.to_if_alone_timeout_milliseconds": 200}
}
```

For this guide, we'll focus on Complex Modifications because they're much more powerful and only slightly harder to understand.

### Checkpoint #1: Remap Right Option to Right Command

Let's make sure Karabiner is working before we do anything advanced.

**Step 1:** Install and launch Karabiner-Elements.
```bash
# Or download from karabiner-elements.pqrs.org and launch manually
open /Applications/Karabiner-Elements.app
```

**Step 2:** Grant permissions when prompted. Go through System Preferences and approve:
- System Extensions
- Input Monitoring
- Accessibility

You may need to restart your Mac.

**Step 3:** Open the Karabiner preferences and navigate to the "Simple Modifications" tab.

**Step 4:** Click the "+" button and create:
- From: right_option
- To: right_command

**Step 5:** Enable the device (toggle the switch to the right).

**Step 6:** Test: Hold right Option and press a key. In most apps, it should behave like right Command.

**What to expect:**
- In Terminal: `⌘+n` should open a new window (right Option should behave like Command)
- In browsers: It might not work immediately—wait 10 seconds and try again
- In VS Code: It should trigger command palette with `⌘+p`

**When it doesn't work:**
If nothing happens, check:
1. Is the device toggle enabled? (You should see a blue toggle for your keyboard)
2. Did you grant Input Monitoring? (System Preferences → Security & Privacy → Input Monitoring)
3. Did macOS prompt you about system extensions? (System Preferences → Security & Privacy → General)
4. Is Karabiner-Elements.app in Accessibility? (System Preferences → Security & Privacy → Accessibility)

If still stuck, see the **Troubleshooting** section below.

---

## Step-by-Step Instructions

### Part 1: Orientation — Understanding Your Config File

Now that Karabiner is installed, let's look at your config file.

**Step 1:** Open your config file:
```bash
open ~/.config/karabiner/karabiner.json
```

This file was created automatically when you first launched Karabiner. It's in JSON format.

**Step 2:** Look for these top-level keys:
```json
{
  "profiles": [
    {
      "name": "Default profile",
      "parameters": {...},
      "complex_modifications": {...}
    }
  ]
}
```

A "profile" is a collection of rules. You can have multiple profiles (e.g., "Coding", "Writing", "Gaming") and switch between them via the app.

**Step 3:** Inside the profile, look for `complex_modifications`:
```json
"complex_modifications": {
  "rules": [
    // Your rules go here
  ]
}
```

This array is empty if you haven't added any complex modifications yet.

**Step 4:** (Optional) Read the comments in your karabiner.json file. Karabiner includes sensible defaults and comments explaining the structure.

**Key paths to remember:**
- Config file: `~/.config/karabiner/karabiner.json`
- Logs: `~/.local/share/karabiner/log/console_user_server.log` (for debugging)
- Devices toggle UI: Karabiner-Elements app → Devices

---

### Part 2: The Manipulator Model — The Anatomy of a Rule

Every rule in Karabiner is a "manipulator." Here's the structure:

```json
{
  "type": "basic",
  "from": {
    "key_code": "a",
    "modifiers": {
      "mandatory": ["left_control"],
      "optional": ["any"]
    }
  },
  "to": [
    {"key_code": "b"}
  ],
  "to_if_alone": [
    {"key_code": "escape"}
  ],
  "to_if_held_down": [
    {"key_code": "left_control"}
  ],
  "parameters": {
    "basic.to_if_alone_timeout_milliseconds": 200
  },
  "conditions": [
    {"type": "device_if", "identifiers": ["vendor_id", "product_id"]}
  ]
}
```

Let's break each part down:

#### The `from` Block: What You're Pressing

```json
"from": {
  "key_code": "a",
  "modifiers": {
    "mandatory": ["left_control"],
    "optional": ["any"]
  }
}
```

- **`key_code`** — The physical key you're pressing. Examples: `"a"`, `"spacebar"`, `"caps_lock"`, `"left_option"`. Full list in Appendix.

- **`modifiers.mandatory`** — Modifiers that *must* be held for this rule to fire. If you want the rule to only apply when you press `Ctrl+A`, set `mandatory: ["left_control"]`. Leave empty if you don't care about modifiers.

- **`modifiers.optional`** — Modifiers that *can* be held, and the rule still fires. Almost always use `["any"]`. This means "I don't care if Shift, Option, or Command are held; apply this rule anyway."

**Why `optional: ["any"]`?** Consider a rule like "A → B":
- Without `optional: ["any"]`, pressing Shift+A would *not* trigger the rule (because Shift is a modifier you didn't account for)
- With `optional: ["any"]`, Shift+A triggers the rule, and Karabiner sends Shift+B (the mapped result)

This is usually what you want.

#### The `to` Array: What Happens

```json
"to": [
  {"key_code": "left_control"},
  {"key_code": "a"}
]
```

- `to` is an *array* because you can send multiple key presses in sequence
- Karabiner processes them in order
- Example: `[{"key_code": "left_command"}, {"key_code": "c"}]` = Cmd+C

**Important:** The order matters. `[Cmd, C]` sends Cmd held down, then C pressed, then both released. It does *not* send simultaneous Cmd+C in one atomic event—but it's fast enough that apps see them together.

#### The `to_if_alone` Clause: The Dual-Purpose Key

This is the magic sauce for tap-vs-hold:

```json
"to": [
  {"key_code": "left_control"}
],
"to_if_alone": [
  {"key_code": "escape"}
]
```

This means:
- **Hold the key** → send Control
- **Tap the key quickly** (and don't press any other keys while holding) → send Escape

`to_if_alone` fires if you release the key before the timeout expires *and* you didn't press any other keys while it was held down.

#### The `to_if_held_down` Clause: Repeating Keys

```json
"to_if_held_down": [
  {"key_code": "left_control"}
]
```

This sends a key repeatedly if you hold it down. Less common, but useful for:
- Holding a key to send multiple events (e.g., holding a key to scroll)
- Implementing key repeat behavior

For most use cases, you'll skip this and just use `to` and `to_if_alone`.

#### The `parameters` Block: Timing

```json
"parameters": {
  "basic.to_if_alone_timeout_milliseconds": 200
}
```

This controls how long Karabiner waits to decide "is this a tap or a hold?" Default is 1000ms (1 second), which feels slow. Common values:

- **100-150ms** — Very snappy, but you might accidentally tap when you meant to hold
- **200-300ms** — Good balance; gives you time to hold down a modifier while still feeling responsive
- **500ms+** — Feels sluggish, but very safe if you often chord modifiers quickly

We'll tune this later based on how your fingers work.

#### The `conditions` Block: When to Apply This Rule

```json
"conditions": [
  {
    "type": "device_if",
    "identifiers": {
      "vendor_id": 1234,
      "product_id": 5678
    }
  }
]
```

Conditions let you apply rules only in certain contexts:
- **`device_if`** — Only when a specific keyboard is connected
- **`device_if_not`** — Never when a specific keyboard is connected
- **`frontmost_application_if`** — Only when a specific app is in focus
- **`frontmost_application_if_not`** — Never when an app is in focus
- **`input_source_if`** — Only when a specific input source (language layout) is active

We'll skip conditions for now—they're advanced.

---

### Part 3: Tap-vs-Hold and Home Row Modifiers

This is where Karabiner gets really powerful.

#### The Tap-vs-Hold Pattern

The pattern is simple:
```json
{
  "from": {"key_code": "a"},
  "to": [{"key_code": "left_control"}],
  "to_if_alone": [{"key_code": "escape"}]
}
```

**Behavior:**
- Hold A for longer than timeout → Control is held down
- Tap A quickly → Escape is sent
- Press A, hold it, press B, release A → Control+B (because you pressed another key while holding A, so `to_if_alone` doesn't fire)

This is the foundation of home row modifiers.

#### Why `lazy: true` Matters for Modifiers

When you use `"lazy": true`, the key is not activated until you press another key. This matters for modifiers:

```json
{
  "from": {"key_code": "a"},
  "to": [{"key_key": "left_control", "lazy": true}],
  "to_if_alone": [{"key_code": "escape"}]
}
```

Without `lazy: true`:
- Press A → Control is immediately "active" but hidden
- Type some text → Everything is modified by Control (weird)

With `lazy: true`:
- Press A → Karabiner waits (Control is not active yet)
- If you release A quickly → Send Escape
- If you press B while A is held → Now send Control+B

This is *almost always* what you want for dual-purpose keys. The only exception is when you need a modifier to be "stickied" (held down for the next key even after you release it).

#### Building Home Row Mods: ASDF and JKL;

Let's build a practical example. We'll map:
- A → Control (or Escape if tapped)
- S → Option (or key if tapped)
- D → Command (or key if tapped)
- F → Shift (or key if tapped)
- J → Shift (or key if tapped)
- K → Command (or key if tapped)
- L → Option (or key if tapped)
- ; → Control (or key if tapped)

This gives you a "home row" of modifiers that your fingers naturally rest on.

**Step 1:** Open your karabiner.json file:
```bash
open ~/.config/karabiner/karabiner.json
```

**Step 2:** Find the `complex_modifications.rules` array inside your profile.

**Step 3:** Add this rule for the A key:
```json
{
  "description": "A → left_control, tap → a",
  "type": "basic",
  "from": {"key_code": "a"},
  "to": [
    {
      "key_code": "left_control",
      "lazy": true
    }
  ],
  "to_if_alone": [
    {"key_code": "a"}
  ],
  "parameters": {
    "basic.to_if_alone_timeout_milliseconds": 200
  }
}
```

**Step 4:** Add similar rules for S, D, F (left half), and J, K, L, ; (right half). Here's the full array:

```json
"complex_modifications": {
  "rules": [
    {
      "description": "home_row_mods: a → left_control, tap → a",
      "type": "basic",
      "from": {"key_code": "a"},
      "to": [{"key_code": "left_control", "lazy": true}],
      "to_if_alone": [{"key_code": "a"}],
      "parameters": {"basic.to_if_alone_timeout_milliseconds": 200}
    },
    {
      "description": "home_row_mods: s → left_option, tap → s",
      "type": "basic",
      "from": {"key_code": "s"},
      "to": [{"key_code": "left_option", "lazy": true}],
      "to_if_alone": [{"key_code": "s"}],
      "parameters": {"basic.to_if_alone_timeout_milliseconds": 200}
    },
    {
      "description": "home_row_mods: d → left_command, tap → d",
      "type": "basic",
      "from": {"key_code": "d"},
      "to": [{"key_code": "left_command", "lazy": true}],
      "to_if_alone": [{"key_code": "d"}],
      "parameters": {"basic.to_if_alone_timeout_milliseconds": 200}
    },
    {
      "description": "home_row_mods: f → left_shift, tap → f",
      "type": "basic",
      "from": {"key_code": "f"},
      "to": [{"key_code": "left_shift", "lazy": true}],
      "to_if_alone": [{"key_code": "f"}],
      "parameters": {"basic.to_if_alone_timeout_milliseconds": 200}
    },
    {
      "description": "home_row_mods: j → left_shift, tap → j",
      "type": "basic",
      "from": {"key_code": "j"},
      "to": [{"key_code": "left_shift", "lazy": true}],
      "to_if_alone": [{"key_code": "j"}],
      "parameters": {"basic.to_if_alone_timeout_milliseconds": 200}
    },
    {
      "description": "home_row_mods: k → left_command, tap → k",
      "type": "basic",
      "from": {"key_code": "k"},
      "to": [{"key_code": "left_command", "lazy": true}],
      "to_if_alone": [{"key_code": "k"}],
      "parameters": {"basic.to_if_alone_timeout_milliseconds": 200}
    },
    {
      "description": "home_row_mods: l → left_option, tap → l",
      "type": "basic",
      "from": {"key_code": "l"},
      "to": [{"key_code": "left_option", "lazy": true}],
      "to_if_alone": [{"key_code": "l"}],
      "parameters": {"basic.to_if_alone_timeout_milliseconds": 200}
    },
    {
      "description": "home_row_mods: semicolon → left_control, tap → semicolon",
      "type": "basic",
      "from": {"key_code": "semicolon"},
      "to": [{"key_code": "left_control", "lazy": true}],
      "to_if_alone": [{"key_code": "semicolon"}],
      "parameters": {"basic.to_if_alone_timeout_milliseconds": 200}
    }
  ]
}
```

**Step 5:** Save the file.

**Step 6:** Test. Don't relaunch Karabiner—it watches for file changes. Try:
- Tapping A, S, D, F, J, K, L, ; — They should type normally
- Holding A and pressing another key (e.g., C) — Should be Control+C
- Holding D and clicking a link — Should Command+click (open in new tab)

**When it doesn't work:**
- Did you save the file? Try manually reloading: Karabiner-Elements → Preferences → Devices
- Does the JSON parse? Use `jq .` to validate:
  ```bash
  jq . ~/.config/karabiner/karabiner.json
  ```
  If you see an error, you have a syntax error. Check for missing commas or mismatched brackets.
- Try the Event Viewer (see Troubleshooting below) to see what keys Karabiner is seeing

#### Tuning the Timeout

The `basic.to_if_alone_timeout_milliseconds` value is critical. If it's too short:
- You'll accidentally tap when you meant to hold
- Fast typists will trigger `to_if_alone` even when holding modifiers

If it's too long:
- Modifiers feel sluggish
- You have to wait 500ms to get a single letter

**How to tune:**
1. Start with 200ms
2. Type normally for 5 minutes. Does it feel responsive?
3. If you're accidentally getting taps when you meant to hold (e.g., Ctrl+C sends C instead of Control), increase it to 250ms
4. If taps feel sluggish, decrease to 150ms
5. Iterate until it feels natural

Common values:
- **150-180ms** — For fast, confident typists
- **200-250ms** — For most people (good balance)
- **300-500ms** — For people who often hold multiple modifiers in sequence

---

### Part 4: Layer Keys — Caps Lock and Fn Key

Now we'll build the really powerful stuff: a Hyper key and Meh key.

#### What is Hyper? What is Meh?

**Hyper** is all four modifiers at once: Control + Option + Shift + Command (⌃⌥⇧⌘)

**Meh** is three: Control + Option + Shift (⌃⌥⇧)

These key combinations are *almost never* used by default macOS apps or browsers (they conflict with too many shortcuts). That makes them perfect for your own custom shortcuts.

When you bind Hyper to Caps Lock:
- Hold Caps Lock → Hyper is active (you can now press Hyper+A, Hyper+B, etc. for custom shortcuts)
- Tap Caps Lock → Send Escape (useful when you actually need to escape, like in vim)

#### Step 1: Remap Caps Lock to Hyper+Escape

Add this to your `complex_modifications.rules` array:

```json
{
  "description": "Caps Lock → Hyper, tap → Escape",
  "type": "basic",
  "from": {"key_code": "caps_lock"},
  "to": [
    {
      "key_code": "left_shift",
      "modifiers": [
        "left_control",
        "left_option",
        "left_command"
      ],
      "lazy": true
    }
  ],
  "to_if_alone": [
    {"key_code": "escape"}
  ],
  "parameters": {
    "basic.to_if_alone_timeout_milliseconds": 200
  }
}
```

Wait, this looks weird. Let me explain:

In Karabiner, you can't directly send "Hyper" as a key code. Instead, you send Shift while also activating Control, Option, and Command via the `modifiers` array.

```json
{
  "key_code": "left_shift",
  "modifiers": ["left_control", "left_option", "left_command"],
  "lazy": true
}
```

This sends: "Key = Shift, and while this is pressed, also activate Control, Option, and Command"

The result to apps is: Shift+Control+Option+Command is held down. This is Hyper.

**Why Shift?** Technically, Hyper is usually represented as Control+Option+Shift+Command. The actual key doesn't matter (we're using Shift as a placeholder), but Shift is conventional because it's the least likely to cause issues.

#### Step 2: Remap Fn to Meh

On most Macs, the Fn key (globe icon) is hard to remap via the OS. But Karabiner can do it. Add this rule:

```json
{
  "description": "Fn → Meh (Control+Option+Shift), tap → F1",
  "type": "basic",
  "from": {"key_code": "fn"},
  "to": [
    {
      "key_code": "left_shift",
      "modifiers": ["left_control", "left_option"],
      "lazy": true
    }
  ],
  "to_if_alone": [
    {"key_code": "f1"}
  ],
  "parameters": {
    "basic.to_if_alone_timeout_milliseconds": 200
  }
}
```

This is identical to Hyper, but without the Command key (that's the Meh definition: Control+Option+Shift).

#### Step 3: Test Hyper and Meh

**Test Hyper (Caps Lock):**
1. Hold Caps Lock (don't release)
2. Press A
3. You should see "Caps Lock + A" appear in your terminal's key logger (or in an app like Key Codes)
4. Let go

**Test Meh (Fn):**
1. Hold Fn
2. Press B
3. You should see "Fn + B" in your key logger

If you see "Hyper+A" in your key logger, Karabiner is working correctly.

#### Step 4: Bind Hyper to App Launchers

Now that you have a Hyper key, you can bind it to launch applications. This is where [[hammerspoon-beginner-guide]] comes in handy.

For now, a simple example: **Hyper+E → Open Finder**

Add this rule:

```json
{
  "description": "Hyper+E → Open Finder",
  "type": "basic",
  "from": {
    "key_code": "e",
    "modifiers": {
      "mandatory": ["left_shift", "left_control", "left_option", "left_command"],
      "optional": ["any"]
    }
  },
  "to": [
    {
      "shell_command": "open /Applications/Finder.app"
    }
  ]
}
```

Wait—`shell_command` in Karabiner? Yes, Karabiner can run shell commands as the output. This is powerful but also dangerous (don't copy-paste `shell_command` from random websites).

When you press Hyper+E, Karabiner runs:
```bash
open /Applications/Finder.app
```

This opens Finder.

**Three Hyper Shortcuts to Try:**
```json
{
  "description": "Hyper+E → Open Finder",
  "type": "basic",
  "from": {
    "key_code": "e",
    "modifiers": {"mandatory": ["left_shift", "left_control", "left_option", "left_command"], "optional": ["any"]}
  },
  "to": [{"shell_command": "open /Applications/Finder.app"}]
},
{
  "description": "Hyper+P → Open Preview",
  "type": "basic",
  "from": {
    "key_code": "p",
    "modifiers": {"mandatory": ["left_shift", "left_control", "left_option", "left_command"], "optional": ["any"]}
  },
  "to": [{"shell_command": "open /Applications/Preview.app"}]
},
{
  "description": "Hyper+T → Open Terminal",
  "type": "basic",
  "from": {
    "key_code": "t",
    "modifiers": {"mandatory": ["left_shift", "left_control", "left_option", "left_command"], "optional": ["any"]}
  },
  "to": [{"shell_command": "open /Applications/Utilities/Terminal.app"}]
}
```

#### macOS Settings to Disable

Before you use Fn heavily, disable a few macOS defaults:

1. **System Preferences → Keyboard → Press Fn key to:** Change from "Show F1, F2 keys" to "Do Nothing"
2. **System Preferences → Keyboard → Use F1, F2, etc. as standard function keys:** Enable this if you use function keys with apps like Terminal

These prevent macOS from eating your Fn key presses.

---

## Practical Examples

Let's build three real-world configs you can use immediately.

### Example 1: The Minimal Config

For someone who wants just a few smart changes:

```json
{
  "profiles": [
    {
      "name": "Minimal",
      "complex_modifications": {
        "rules": [
          {
            "description": "Caps Lock → Escape (no hold)",
            "type": "basic",
            "from": {"key_code": "caps_lock"},
            "to": [{"key_code": "escape"}]
          },
          {
            "description": "Right Option → Right Command",
            "type": "basic",
            "from": {"key_code": "right_option"},
            "to": [{"key_code": "right_command"}]
          }
        ]
      }
    }
  ]
}
```

This is enough to:
- Make Caps Lock useful (Escape)
- Fix Option on the right side (many external keyboards have this problem)

Deploy time: 2 minutes.

### Example 2: Home Row Mods Only

For someone who wants efficient modifiers without the Hyper complexity:

```json
{
  "profiles": [
    {
      "name": "Home Row Mods",
      "complex_modifications": {
        "rules": [
          {
            "description": "a → left_control",
            "type": "basic",
            "from": {"key_code": "a"},
            "to": [{"key_code": "left_control", "lazy": true}],
            "to_if_alone": [{"key_code": "a"}],
            "parameters": {"basic.to_if_alone_timeout_milliseconds": 200}
          },
          {
            "description": "s → left_option",
            "type": "basic",
            "from": {"key_code": "s"},
            "to": [{"key_code": "left_option", "lazy": true}],
            "to_if_alone": [{"key_code": "s"}],
            "parameters": {"basic.to_if_alone_timeout_milliseconds": 200}
          },
          {
            "description": "d → left_command",
            "type": "basic",
            "from": {"key_code": "d"},
            "to": [{"key_code": "left_command", "lazy": true}],
            "to_if_alone": [{"key_code": "d"}],
            "parameters": {"basic.to_if_alone_timeout_milliseconds": 200}
          },
          {
            "description": "f → left_shift",
            "type": "basic",
            "from": {"key_code": "f"},
            "to": [{"key_code": "left_shift", "lazy": true}],
            "to_if_alone": [{"key_code": "f"}],
            "parameters": {"basic.to_if_alone_timeout_milliseconds": 200}
          },
          {
            "description": "j → left_shift",
            "type": "basic",
            "from": {"key_code": "j"},
            "to": [{"key_code": "left_shift", "lazy": true}],
            "to_if_alone": [{"key_code": "j"}],
            "parameters": {"basic.to_if_alone_timeout_milliseconds": 200}
          },
          {
            "description": "k → left_command",
            "type": "basic",
            "from": {"key_code": "k"},
            "to": [{"key_code": "left_command", "lazy": true}],
            "to_if_alone": [{"key_code": "k"}],
            "parameters": {"basic.to_if_alone_timeout_milliseconds": 200}
          },
          {
            "description": "l → left_option",
            "type": "basic",
            "from": {"key_code": "l"},
            "to": [{"key_code": "left_option", "lazy": true}],
            "to_if_alone": [{"key_code": "l"}],
            "parameters": {"basic.to_if_alone_timeout_milliseconds": 200}
          },
          {
            "description": "semicolon → left_control",
            "type": "basic",
            "from": {"key_code": "semicolon"},
            "to": [{"key_code": "left_control", "lazy": true}],
            "to_if_alone": [{"key_code": "semicolon"}],
            "parameters": {"basic.to_if_alone_timeout_milliseconds": 200}
          }
        ]
      }
    }
  ]
}
```

This takes 30 minutes to get comfortable with, and you'll use it 500 times a day.

### Example 3: Full Power Config (Home Row Mods + Hyper + Shortcuts)

See the beginning of Step-by-Step Instructions for the full config. You'll want:
1. Home row mods (ASDF JKL;)
2. Caps Lock → Hyper+Escape
3. Fn → Meh+F1
4. 5-10 Hyper-based shortcuts

This takes 1-2 hours to dial in perfectly, but gives you a keyboard that feels custom-made for you.

---

## Hands-On Exercises

Work through these in order. They'll build intuition for the manipulator model.

### Exercise 1: Escape from Caps Lock (Easy, 5 min)

**Goal:** Remap Caps Lock to Escape.

**Why:** Caps Lock is useless. Escape is used constantly in vim, tmux, and modal editors.

**Steps:**
1. Open karabiner.json
2. Add a simple rule:
   ```json
   {
     "description": "Caps Lock → Escape",
     "type": "basic",
     "from": {"key_code": "caps_lock"},
     "to": [{"key_code": "escape"}]
   }
   ```
3. Save and test: Press Caps Lock. You should get Escape.

**Challenge:** What if you want Caps Lock + A to still work for some reason? Modify the rule so that Caps Lock → Escape, but Caps Lock + Shift → Caps Lock behavior. (Hint: use `conditions` to exclude when Shift is held.)

### Exercise 2: Dual-Purpose Space (Medium, 15 min)

**Goal:** Make Space behave as Space when tapped, but as Control when held.

**Why:** Many keyboards have a huge Space key. You could use half of it for Control.

**Steps:**
1. Create a rule:
   ```json
   {
     "description": "Space → Control, tap → Space",
     "type": "basic",
     "from": {"key_code": "spacebar"},
     "to": [{"key_code": "left_control", "lazy": true}],
     "to_if_alone": [{"key_code": "spacebar"}],
     "parameters": {"basic.to_if_alone_timeout_milliseconds": 200}
   }
   ```
2. Save and test:
   - Tap Space → Space is inserted
   - Hold Space and press C → Control+C
3. **Adjust the timeout:** Does it feel right? Try 150ms and 300ms. Which feels best?

### Exercise 3: Vim Arrows on Home Row (Hard, 30 min)

**Goal:** Create a rule where holding Caps Lock and pressing HJKL sends arrow keys.

**Why:** Vim users need arrow keys without leaving home row. This is a common pattern.

**Steps:**
1. Create a rule for Caps Lock + H → Left arrow:
   ```json
   {
     "description": "Caps Lock + H → Left arrow",
     "type": "basic",
     "from": {
       "key_code": "h",
       "modifiers": {
         "mandatory": ["caps_lock"],
         "optional": ["any"]
       }
     },
     "to": [{"key_code": "left_arrow"}]
   }
   ```
2. Add similar rules for J (down), K (up), L (right)
3. Test: Hold Caps Lock and press H. You should see an arrow.

**Challenge:** What happens if Caps Lock is mapped to Hyper? The `modifiers.mandatory` won't match anymore. How would you work around this?

(Hint: You'd need to detect the actual modifier keys being held, not the `caps_lock` key itself. This requires understanding Karabiner's event model more deeply—see [[karabiner-elements-deep-dive]] for advanced conditions.)

---

## Troubleshooting

### When Nothing Happens

**Checklist:**
1. **Is Karabiner running?** Open Activity Monitor and search for "karabiner". You should see:
   - karabiner_grabber (kernel extension)
   - karabiner_observer (background daemon)
   - Karabiner-Elements (the app)
   
   If you only see the app, relaunch it.

2. **Did you grant all three permissions?** Go to System Preferences → Security & Privacy and check:
   - **System Extensions:** You should see Karabiner listed
   - **Input Monitoring:** You should see Karabiner-Elements and karabiner_grabber
   - **Accessibility:** You should see Karabiner-Elements
   
   If any are missing, add them and relaunch Karabiner.

3. **Did the JSON parse?** Validate your config:
   ```bash
   jq . ~/.config/karabiner/karabiner.json
   ```
   If you see an error, copy the error message and fix the JSON. Common mistakes:
   - Missing comma after a property
   - Mismatched brackets `{}` or `[]`
   - Typo in key name (e.g., `"key_code"` vs `"keycode"`)

4. **Did you save the file?** After editing, explicitly save (Cmd+S in most editors). Karabiner watches for changes, but slow editors sometimes don't notify it immediately.

5. **Try toggling the device:** In Karabiner-Elements → Devices, toggle the keyboard off and on. This forces a reload.

**When it doesn't work:** Check the log file:
```bash
tail -100 ~/.local/share/karabiner/log/console_user_server.log
```

Look for error messages. Common ones:
- `"Invalid key_code"` — You misspelled a key code
- `"Profile not found"` — The profile name in your config doesn't match
- `"Modifier not recognized"` — You misspelled a modifier (e.g., `"left_shift"` not `"left Shift"`)

### Event Viewer: Seeing What Karabiner Sees

Karabiner has a built-in tool called **Event Viewer** that shows you exactly what keys your keyboard is sending and what Karabiner is transforming them to.

**To open Event Viewer:**
1. Launch Karabiner-Elements
2. Go to Preferences → Misc
3. Click "Launch EventViewer"
4. A new window opens showing real-time key events

**What you'll see:**
```
key_code: a, type: key_down
key_code: a, type: key_up
```

When you press a key, EventViewer shows the key_down event first, then key_up.

**How to use it for debugging:**
1. Enable EventViewer
2. Press the key you're trying to remap (e.g., Caps Lock)
3. Look at the key_code shown (e.g., `"caps_lock"`)
4. Compare it to what you wrote in your rule's `"from"` block
5. If they don't match exactly, that's your problem

**Example:** I'm trying to remap the Fn key, but nothing happens.
1. Open EventViewer
2. Press Fn
3. EventViewer shows: `key_code: fn`
4. My rule says: `"from": {"key_code": "globe"}`
5. Mismatch! Change the rule to use `"fn"` instead.

### When Keys Misfire (Typing Becomes Chaos)

This usually happens when your `basic.to_if_alone_timeout_milliseconds` is too short, or when you're trying to use home row mods and type very fast.

**Symptom:** You intended to press Ctrl+C, but got C and C (a tapped C twice).

**Diagnosis:** Your timeout is too short. Increase it from 200ms to 250ms or 300ms.

**Symptom:** You intended to type "fast" quickly, but got "f ast" (a space between f and ast).

**Diagnosis:** The F key is being held too long, triggering the shift modifier. Either:
- Increase the timeout
- Decrease the timeout (sounds backwards, but sometimes fast typers need faster response)
- Re-examine your typing rhythm

**The nuclear option:** Temporarily disable home row mods and type normally for a day. Then re-enable them. This often resets your muscle memory and solves misfires.

**Check the log for clues:**
```bash
tail -50 ~/.local/share/karabiner/log/console_user_server.log | grep -i error
```

### When a Rule Only Works Sometimes

**Symptom:** Hyper+E opens Finder sometimes, but not always.

This usually means:
1. You're holding Hyper but not pressing E hard enough (key repeat lag)
2. Another rule is interfering
3. A specific app is consuming the event before Karabiner sees it (rare)

**Diagnosis:**
1. Try the Event Viewer again. Press Hyper+E slowly and deliberately. Watch for the events.
2. Check if the rule matches what you see in EventViewer
3. In Karabiner-Elements → Devices, toggle "Modify events" off and on for your keyboard

### Input Monitoring Permission Keeps Getting Revoked

macOS sometimes revokes Input Monitoring permissions when you update the OS or restart. You'll notice keys stop working in secure contexts (Terminal, password fields).

**Fix:**
1. Open System Preferences → Security & Privacy → Input Monitoring
2. Remove karabiner_grabber and Karabiner-Elements.app
3. Relaunch Karabiner-Elements
4. macOS will prompt you again. Grant the permission.

### My Config Works on My Mac But Not on an External Keyboard

This is usually a device-specific issue. External keyboards often have different vendor_id and product_id values.

**Solution:** Use `conditions` to apply rules only to specific devices:

```json
{
  "description": "Home row mods (external keyboard only)",
  "type": "basic",
  "from": {"key_code": "a"},
  "to": [{"key_code": "left_control", "lazy": true}],
  "to_if_alone": [{"key_code": "a"}],
  "conditions": [
    {
      "type": "device_if",
      "identifiers": {
        "vendor_id": 4617,
        "product_id": 8706
      }
    }
  ]
}
```

To find your keyboard's vendor_id and product_id:
1. Open Karabiner-Elements → Preferences → Devices
2. Your keyboard is listed with its IDs shown

---

## Related Tutorials

As you advance with Karabiner, these related guides will help you build a complete custom macOS environment:

- [[hammerspoon-beginner-guide]] and [[hammerspoon-deep-dive]] — Pair with Karabiner to launch apps and run macOS automation scripts triggered by your Hyper and Meh keys
- [[yabai-beginner-guide]] and [[yabai-deep-dive]] — Window manager that works beautifully with Hyper+HJKL arrow keys for navigation
- [[sketchybar-beginner-guide]] — Custom menu bar to show Karabiner profile status
- [[bunch-beginner-guide]] — Automation tool to enable/disable Karabiner profiles when switching contexts
- [[moom-beginner-guide]] — Window management app that integrates well with Hyper key shortcuts
- [[macos-app-layout-beginner-guide]] — Layout strategies for apps you launch via Hyper shortcuts
- [[dotfiles-beginner-guide]] and [[dotfiles-deep-dive]] — Store your karabiner.json in version control
- [[chezmoi-beginner-guide]] — Sync your Karabiner config across multiple Macs
- [[sesh-beginner-guide]] — Terminal session manager that can be launched with a Hyper shortcut
- [[karabiner-elements-deep-dive]] — Advanced topics: complex conditions, cross-device sync, and custom event transformations

---

## References

### Official Resources
- **Karabiner-Elements Homepage:** https://karabiner-elements.pqrs.org/
- **GitHub Repository:** https://github.com/pqrs-org/Karabiner-Elements
- **Documentation:** https://karabiner-elements.pqrs.org/docs/
- **Key Codes Reference:** https://karabiner-elements.pqrs.org/docs/manual/misc/key-codes/

### Community
- **GitHub Issues:** Common problems and solutions
- **Reddit r/macOS:** Plenty of Karabiner threads with real-world configs
- **config.pqrs.org:** Pre-built configurations you can learn from or import

### Key Codes (Quick Reference)

**Letter Keys:**
```
a, b, c, ... z
```

**Number Keys:**
```
1, 2, 3, ... 9, 0
```

**Modifier Keys:**
```
left_control, right_control
left_option, right_option
left_command, right_command
left_shift, right_shift
fn
caps_lock
```

**Arrow Keys:**
```
up_arrow, down_arrow, left_arrow, right_arrow
```

**Special Keys:**
```
spacebar
return_or_enter
delete_or_backspace
escape
tab
semicolon, comma, period, slash, backslash, quote, grave_accent_and_tilde, bracket_left, bracket_right
```

**Function Keys:**
```
f1, f2, ... f12
```

**Other Common Keys:**
```
page_up, page_down
home, end
help
print_screen
scroll_lock
pause
insert
clear
```

For a complete list, see: https://karabiner-elements.pqrs.org/docs/manual/misc/key-codes/

### Timing Parameters (Cheat Sheet)

```json
"parameters": {
  "basic.to_if_alone_timeout_milliseconds": 200  // How long to wait before treating a key as "held"
}
```

Recommended values:
- **Fast typist, confident timing:** 150ms
- **Average typist:** 200ms
- **Slower typist, or frequently chords modifiers:** 250-300ms

### Common Mistakes (Checklist)

- [ ] Forgot `"lazy": true` on a modifier (makes it overly aggressive)
- [ ] Used `"key_code"` instead of `"keycode"` (doesn't exist)
- [ ] Forgot comma after a JSON property
- [ ] Used wrong modifier name (e.g., `left_shift` not `leftShift`)
- [ ] Didn't grant Input Monitoring permission
- [ ] Didn't save the karabiner.json file before testing
- [ ] Set timeout to 0 (it needs to be at least 100ms)

---

## Summary

You now have everything you need to start remapping your keyboard like a pro:

**You learned:**
1. How Karabiner works at the kernel level to intercept keys
2. The manipulator model: `from`, `to`, `to_if_alone`, and timing parameters
3. How to build tap-vs-hold dual-purpose keys
4. How to create home row modifiers (ASDF and JKL;)
5. How to set up a Hyper key (Caps Lock) and Meh key (Fn)
6. How to bind Hyper to application shortcuts
7. How to debug when things don't work

**Next steps:**
1. Create your first config with home row mods (45 minutes)
2. Add a Hyper key and 3-5 Hyper-based shortcuts (30 minutes)
3. Fine-tune your timeout values based on your typing speed (1 week of daily use)
4. Explore [[karabiner-elements-deep-dive]] for advanced patterns

**Remember:** Your Karabiner config should be in your [[dotfiles-beginner-guide|dotfiles]] so you can sync it across Macs. Store it in version control and don't be afraid to experiment.

---

## Appendix: Full Keyboard Example Config

Here's a complete, ready-to-use karabiner.json with all the concepts from this guide:

```json
{
  "global": {
    "check_for_updates_on_startup": true,
    "show_in_menu_bar": true,
    "show_profile_name_in_menu_bar": false,
    "unsafe_paste_privileged_items_alert": true
  },
  "profiles": [
    {
      "name": "Default",
      "selected": true,
      "parameters": {
        "delay_milliseconds_before_open_device": 1000
      },
      "complex_modifications": {
        "rules": [
          {
            "description": "Caps Lock → Hyper, tap → Escape",
            "type": "basic",
            "from": {"key_code": "caps_lock"},
            "to": [
              {
                "key_code": "left_shift",
                "modifiers": ["left_control", "left_option", "left_command"],
                "lazy": true
              }
            ],
            "to_if_alone": [{"key_code": "escape"}],
            "parameters": {"basic.to_if_alone_timeout_milliseconds": 200}
          },
          {
            "description": "Fn → Meh, tap → F1",
            "type": "basic",
            "from": {"key_code": "fn"},
            "to": [
              {
                "key_code": "left_shift",
                "modifiers": ["left_control", "left_option"],
                "lazy": true
              }
            ],
            "to_if_alone": [{"key_code": "f1"}],
            "parameters": {"basic.to_if_alone_timeout_milliseconds": 200}
          },
          {
            "description": "home_row_mods: a → left_control, tap → a",
            "type": "basic",
            "from": {"key_code": "a"},
            "to": [{"key_code": "left_control", "lazy": true}],
            "to_if_alone": [{"key_code": "a"}],
            "parameters": {"basic.to_if_alone_timeout_milliseconds": 200}
          },
          {
            "description": "home_row_mods: s → left_option, tap → s",
            "type": "basic",
            "from": {"key_code": "s"},
            "to": [{"key_code": "left_option", "lazy": true}],
            "to_if_alone": [{"key_code": "s"}],
            "parameters": {"basic.to_if_alone_timeout_milliseconds": 200}
          },
          {
            "description": "home_row_mods: d → left_command, tap → d",
            "type": "basic",
            "from": {"key_code": "d"},
            "to": [{"key_code": "left_command", "lazy": true}],
            "to_if_alone": [{"key_code": "d"}],
            "parameters": {"basic.to_if_alone_timeout_milliseconds": 200}
          },
          {
            "description": "home_row_mods: f → left_shift, tap → f",
            "type": "basic",
            "from": {"key_code": "f"},
            "to": [{"key_code": "left_shift", "lazy": true}],
            "to_if_alone": [{"key_code": "f"}],
            "parameters": {"basic.to_if_alone_timeout_milliseconds": 200}
          },
          {
            "description": "home_row_mods: j → left_shift, tap → j",
            "type": "basic",
            "from": {"key_code": "j"},
            "to": [{"key_code": "left_shift", "lazy": true}],
            "to_if_alone": [{"key_code": "j"}],
            "parameters": {"basic.to_if_alone_timeout_milliseconds": 200}
          },
          {
            "description": "home_row_mods: k → left_command, tap → k",
            "type": "basic",
            "from": {"key_code": "k"},
            "to": [{"key_code": "left_command", "lazy": true}],
            "to_if_alone": [{"key_code": "k"}],
            "parameters": {"basic.to_if_alone_timeout_milliseconds": 200}
          },
          {
            "description": "home_row_mods: l → left_option, tap → l",
            "type": "basic",
            "from": {"key_code": "l"},
            "to": [{"key_code": "left_option", "lazy": true}],
            "to_if_alone": [{"key_code": "l"}],
            "parameters": {"basic.to_if_alone_timeout_milliseconds": 200}
          },
          {
            "description": "home_row_mods: semicolon → left_control, tap → semicolon",
            "type": "basic",
            "from": {"key_code": "semicolon"},
            "to": [{"key_code": "left_control", "lazy": true}],
            "to_if_alone": [{"key_code": "semicolon"}],
            "parameters": {"basic.to_if_alone_timeout_milliseconds": 200}
          },
          {
            "description": "Hyper+E → Open Finder",
            "type": "basic",
            "from": {
              "key_code": "e",
              "modifiers": {"mandatory": ["left_shift", "left_control", "left_option", "left_command"], "optional": ["any"]}
            },
            "to": [{"shell_command": "open /Applications/Finder.app"}]
          },
          {
            "description": "Hyper+T → Open Terminal",
            "type": "basic",
            "from": {
              "key_code": "t",
              "modifiers": {"mandatory": ["left_shift", "left_control", "left_option", "left_command"], "optional": ["any"]}
            },
            "to": [{"shell_command": "open /Applications/Utilities/Terminal.app"}]
          }
        ]
      },
      "devices": [
        {
          "identifiers": {
            "is_keyboard": true,
            "is_pointing_device": false
          },
          "ignore": false,
          "manipulate_caps_lock_led": true
        }
      ]
    }
  ]
}
```

Copy this into `~/.config/karabiner/karabiner.json`, save, and test. You now have a working Karabiner setup with home row mods and a Hyper key.

---

**End of Tutorial**

Last Updated: 2026-05-02
