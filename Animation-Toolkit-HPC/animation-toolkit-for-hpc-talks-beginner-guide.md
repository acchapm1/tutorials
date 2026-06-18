---
title: "Animation Toolkit for HPC Talks — Beginner's Guide"
date: 2026-05-21
difficulty: beginner
tags: [animation, manim, motion-canvas, matplotlib, hpc, presentations, python, typescript, mp4, powerpoint]
---

# Animation Toolkit for HPC Talks — Beginner's Guide

## Overview

Conference talks about HPC infrastructure — Slurm scheduling, cluster utilization, MPI communication patterns — are hard to explain with static slides. A well-placed 10-second animation showing jobs flowing through a scheduler queue or nodes lighting up under load communicates what three bullet points cannot.

**What's the problem?** GUI animation tools (After Effects, Keynote Magic Move) are not scriptable, not reproducible, and not version-controllable. When your talk data changes or you need to regenerate 12 animations for a new cluster config, clicking through a GUI is not viable.

**What's the solution?** Three code-based animation tools let you write scripts that render to MP4:

| Tool | Language | Best For |
|------|----------|----------|
| **Manim Community Edition** | Python | Geometric animations, state machines, DAG reveals, anything with precise vector graphics |
| **Motion Canvas** | TypeScript | Polished motion design, UI-style animations, pipeline flows with easing and spring physics |
| **matplotlib** | Python | Data-driven animations directly from CSV/sacct output, animated charts and heatmaps |

**What you'll learn:** By the end of this guide you will have installed all three tools, rendered one animation from each, and embedded an MP4 into PowerPoint. Every example uses HPC/Slurm domain concepts so you can adapt them immediately for your next talk.

**Why code-based?** Because you can `git diff` an animation, regenerate it from new data with one command, and run renders in a [[docker-test-container-beginner-guide|Docker container]] or [[isaaclab-metagrasp-apptainer-hpc-beginner-guide|Apptainer image]] on your cluster's build nodes.

---

## Prerequisites

Before you start, verify the following:

### Python and mamba

You need a working mamba (or conda) installation. If you use [[pixi-beginner-guide|Pixi]], that works too — the environment files below are compatible.

```bash
# Verify mamba is available
mamba --version
# Expected: mamba 1.x or 2.x

# Verify Python 3.10+
python3 --version
```

If you don't have mamba, install Miniforge from https://github.com/conda-forge/miniforge.

### Node.js (for Motion Canvas only)

```bash
node --version
# Expected: v18.x or newer (v20+ recommended)

npm --version
# Expected: 9.x or newer
```

Install from https://nodejs.org if missing.

### FFmpeg

FFmpeg is the universal backend that converts frames into MP4 files. Every tool in this guide requires it.

```bash
ffmpeg -version
# Look for: ffmpeg version 6.x or 7.x
# Look for: --enable-libx264 in the configuration line
```

Install via mamba if missing:

```bash
mamba install -c conda-forge ffmpeg
```

### PowerPoint Embedding Basics

Your target output for all animations is:

- **Resolution:** 1920x1080 (Full HD)
- **Frame rate:** 30 fps
- **Codec:** H.264 (libx264)
- **Pixel format:** yuv420p (this is critical — without it, PowerPoint will refuse to play the file)
- **Container:** .mp4

The yuv420p pixel format uses 4:2:0 chroma subsampling, which is the only format that PowerPoint on both Windows and macOS will reliably play. If your MP4 renders with yuv444p (common default for Manim), you must re-encode:

```bash
ffmpeg -i input.mp4 -c:v libx264 -pix_fmt yuv420p -crf 18 -preset slow output_ppt.mp4
```

---

## Key Concepts

### The Render Pipeline

All three tools follow the same conceptual pipeline:

```
Animation Script → Render Engine → Frame Images → FFmpeg → MP4 File
   (your code)     (tool-specific)   (PNG sequence)  (encoder)  (embed in PPT)
```

You write code that describes what moves, when, and how. The tool renders individual frames. FFmpeg stitches them into a video. You embed the video in PowerPoint via Insert > Video > This Device.

### Decision Matrix: Which Tool When?

| Criterion | Manim CE | Motion Canvas | matplotlib |
|-----------|----------|---------------|------------|
| **Language** | Python | TypeScript | Python |
| **Best for** | Geometric diagrams, state machines, DAG reveals | Polished UI animations, pipeline flows | Data-driven charts from real metrics |
| **Worst for** | Real-time data plots | Quick one-off charts | Complex geometric scenes |
| **Setup complexity** | Medium (needs Cairo, Pango) | Low (npm install) | Low (already in most HPC stacks) |
| **Render speed** | ~2-10s for simple scenes | ~5-15s for simple scenes | ~1-5s for simple plots |
| **Fits HPC Python stack?** | Yes (mamba) | No (Node.js) | Yes (already installed) |
| **Live preview?** | Jupyter integration | Built-in web editor | Jupyter integration |

**Rule of thumb:** If your animation is about *data* (throughput numbers, utilization percentages, queue depths from sacct), use matplotlib. If it is about *structure* (how components connect, how states transition), use Manim. If you want *polish* (spring physics, smooth easing, UI-quality motion), use Motion Canvas.

---

## Step-by-Step Instructions

### Tool 1: Manim Community Edition

Manim is a Python framework originally built for math education videos, but it excels at any animation involving geometric shapes, arrows, text labels, and state transitions — exactly what you need for architecture diagrams and job lifecycle animations.

#### Install

```bash
# Create a dedicated environment
mamba create -n animate-manim python=3.11 manim ffmpeg -c conda-forge -y

# Activate it
mamba activate animate-manim

# Verify
manim --version
# Expected: Manim Community v0.18.x or v0.19.x or v0.20.x
```

> **Warning:** Do NOT install `manimgl` (the 3Blue1Brown fork). It is a different project with an incompatible API. Always use `manim` from conda-forge, which is Manim Community Edition.

#### Minimal Script

Create a file called `slurm_hello.py`:

```python
"""Minimal Manim scene: a Slurm job state box that transitions from PENDING to RUNNING."""

from manim import *


class SlurmJobHello(Scene):
    def construct(self) -> None:
        # Create a box representing a Slurm job
        job_box = RoundedRectangle(
            corner_radius=0.2, width=4, height=1.5, color=YELLOW
        )
        pending_label = Text("PENDING", font_size=36, color=YELLOW)
        pending_group = VGroup(job_box, pending_label)

        # Animate the box appearing
        self.play(Create(job_box), Write(pending_label))
        self.wait(0.5)

        # Transition to RUNNING state
        running_label = Text("RUNNING", font_size=36, color=GREEN)
        self.play(
            job_box.animate.set_color(GREEN),
            Transform(pending_label, running_label),
        )
        self.wait(1)
```

#### Render

```bash
manim render -qh slurm_hello.py SlurmJobHello
```

Flags:
- `-qh` = quality high (1920x1080, 30 fps)
- `-ql` = quality low (854x480, 15 fps) — use for fast previews

#### Expected Output

The rendered file lands at:

```
media/videos/slurm_hello/1080p30/SlurmJobHello.mp4
```

This MP4 is already H.264 but may use yuv444p. Re-encode for PowerPoint:

```bash
ffmpeg -i media/videos/slurm_hello/1080p30/SlurmJobHello.mp4 \
  -c:v libx264 -pix_fmt yuv420p -crf 18 -preset slow \
  slurm_job_hello_1080p.mp4
```

---

### Tool 2: Motion Canvas

Motion Canvas is a TypeScript library that produces animations via a web-based editor with live preview. It uses generator functions to describe animation timelines, which gives you precise control over timing and easing.

#### Install

```bash
# Scaffold a new project
npm init @motion-canvas@latest

# When prompted:
#   Project name: hpc-animations
#   Language: TypeScript
#   Exporter: Video (FFmpeg)

# Enter the project and install dependencies
cd hpc-animations
npm install
```

#### Minimal Script

Replace `src/scenes/example.tsx` with this file:

```typescript
/**
 * Minimal Motion Canvas scene: a pipeline animation showing
 * data flowing from Storage to Compute.
 */
import {makeScene2D} from '@motion-canvas/2d';
import {Rect, Txt} from '@motion-canvas/2d/lib/components';
import {createRef} from '@motion-canvas/core/lib/utils';
import {all, waitFor} from '@motion-canvas/core/lib/flow';

export default makeScene2D(function* (view) {
  const storageBox = createRef<Rect>();
  const computeBox = createRef<Rect>();
  const dataPacket = createRef<Rect>();

  // Storage node on the left
  view.add(
    <Rect
      ref={storageBox}
      x={-300}
      y={0}
      width={200}
      height={100}
      radius={10}
      fill={'#2196F3'}
      opacity={0}
    >
      <Txt text={'Storage'} fill={'#ffffff'} fontSize={28} />
    </Rect>,
  );

  // Compute node on the right
  view.add(
    <Rect
      ref={computeBox}
      x={300}
      y={0}
      width={200}
      height={100}
      radius={10}
      fill={'#4CAF50'}
      opacity={0}
    >
      <Txt text={'Compute'} fill={'#ffffff'} fontSize={28} />
    </Rect>,
  );

  // Data packet that moves between them
  view.add(
    <Rect
      ref={dataPacket}
      x={-300}
      y={0}
      width={40}
      height={40}
      radius={5}
      fill={'#FF9800'}
      opacity={0}
    />,
  );

  // Animate boxes appearing
  yield* all(
    storageBox().opacity(1, 0.5),
    computeBox().opacity(1, 0.5),
  );

  yield* waitFor(0.3);

  // Show and move data packet
  yield* dataPacket().opacity(1, 0.2);
  yield* dataPacket().position.x(300, 1.0);
  yield* dataPacket().opacity(0, 0.3);

  yield* waitFor(0.5);
});
```

#### Render

```bash
# Start the dev server with live preview
npm start
# Open http://localhost:9000 in your browser
# Click the render button in the editor UI to export MP4
```

For headless CLI rendering (useful in CI/build scripts):

```bash
npx motion-canvas render
```

#### Expected Output

The rendered file lands at:

```
output/project.mp4
```

Motion Canvas with the FFmpeg exporter typically outputs yuv420p by default. Verify:

```bash
ffprobe -v error -select_streams v:0 -show_entries stream=pix_fmt output/project.mp4
# Should show: pix_fmt=yuv420p
```

---

### Tool 3: matplotlib FuncAnimation

matplotlib is already installed on most HPC systems. Its `FuncAnimation` class lets you animate any plot by updating data frame-by-frame. This is ideal when your animation source is actual data — sacct output, IOR benchmark results, or synthetic cluster metrics.

#### Install

```bash
# Create a dedicated environment
mamba create -n animate-mpl python=3.11 matplotlib ffmpeg -c conda-forge -y

mamba activate animate-mpl
```

#### Minimal Script

Create a file called `squeue_bars.py`:

```python
"""Animated bar chart showing synthetic squeue job counts across partitions."""

from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np
from matplotlib.animation import FuncAnimation

# --- Synthetic squeue data ---
rng = np.random.default_rng(42)
partitions: list[str] = ["gpu", "cpu", "highmem", "debug"]
n_frames: int = 60  # 2 seconds at 30 fps

# Generate synthetic job counts that evolve over time
job_counts: np.ndarray = np.zeros((n_frames, len(partitions)), dtype=int)
for i in range(n_frames):
    job_counts[i] = rng.poisson(lam=[25, 80, 15, 5]) + (i // 10)

# --- Build the animation ---
fig, ax = plt.subplots(figsize=(19.20, 10.80), dpi=100)
fig.set_size_inches(19.20, 10.80)
colors: list[str] = ["#e74c3c", "#3498db", "#2ecc71", "#f39c12"]
bars = ax.bar(partitions, job_counts[0], color=colors)
ax.set_ylim(0, int(job_counts.max() * 1.2))
ax.set_ylabel("Jobs in Queue", fontsize=18)
ax.set_xlabel("Partition", fontsize=18)
ax.set_title("Slurm Queue Depth (squeue snapshot)", fontsize=22)
ax.tick_params(labelsize=14)

frame_text = ax.text(
    0.98, 0.95, "", transform=ax.transAxes,
    ha="right", va="top", fontsize=14, color="gray",
)


def update(frame: int) -> list:
    """Update bar heights for each animation frame."""
    for bar, height in zip(bars, job_counts[frame]):
        bar.set_height(height)
    frame_text.set_text(f"t = {frame}")
    return list(bars) + [frame_text]


anim = FuncAnimation(fig, update, frames=n_frames, interval=33, blit=True)

# --- Save to MP4 ---
output_path = Path("squeue_depth_1080p.mp4")
anim.save(
    str(output_path),
    writer="ffmpeg",
    fps=30,
    dpi=100,
    extra_args=["-pix_fmt", "yuv420p", "-crf", "18"],
)
print(f"Saved: {output_path} ({output_path.stat().st_size / 1024 / 1024:.1f} MB)")
plt.close()
```

#### Render

```bash
python squeue_bars.py
```

No separate render command — the script writes the MP4 directly.

#### Expected Output

```
squeue_depth_1080p.mp4
```

This file is already yuv420p because we passed `-pix_fmt yuv420p` in `extra_args`. It is ready to embed in PowerPoint with no re-encoding.

---

## Practical Examples

These examples go beyond "hello world" to demonstrate animations you would actually use in an HPC talk.

### Example 1: Slurm Job Lifecycle State Machine (Manim)

This animation shows a job progressing through Slurm states with colored boxes and arrows:

```python
"""Slurm job lifecycle: PENDING -> RUNNING -> COMPLETED with state machine arrows."""

from manim import *


class SlurmJobLifecycle(Scene):
    def construct(self) -> None:
        title = Text("Slurm Job Lifecycle", font_size=40).to_edge(UP)
        self.play(Write(title))

        # Define states and their colors
        states: list[tuple[str, str]] = [
            ("PENDING", YELLOW),
            ("RUNNING", GREEN),
            ("COMPLETED", BLUE),
        ]

        boxes: list[VGroup] = []
        x_positions: list[float] = [-4, 0, 4]

        for i, (label, color) in enumerate(states):
            box = RoundedRectangle(
                corner_radius=0.15, width=3, height=1.2, color=color
            )
            text = Text(label, font_size=28, color=color)
            group = VGroup(box, text).move_to(RIGHT * x_positions[i])
            boxes.append(group)

        # Animate each state appearing left to right
        for box in boxes:
            self.play(FadeIn(box, shift=UP * 0.3), run_time=0.6)

        # Draw arrows between states
        arrow_1 = Arrow(
            boxes[0].get_right(), boxes[1].get_left(),
            buff=0.2, color=WHITE,
        )
        arrow_2 = Arrow(
            boxes[1].get_right(), boxes[2].get_left(),
            buff=0.2, color=WHITE,
        )

        label_1 = Text("slurmctld\nschedules", font_size=18, color=GRAY).next_to(
            arrow_1, UP, buff=0.1
        )
        label_2 = Text("job\nexits", font_size=18, color=GRAY).next_to(
            arrow_2, UP, buff=0.1
        )

        self.play(GrowArrow(arrow_1), FadeIn(label_1), run_time=0.8)
        self.play(GrowArrow(arrow_2), FadeIn(label_2), run_time=0.8)

        # Highlight the active state with a moving glow
        highlight = SurroundingRectangle(
            boxes[0], color=YELLOW, buff=0.15, stroke_width=4
        )
        self.play(Create(highlight))
        self.wait(0.5)
        self.play(highlight.animate.move_to(boxes[1]).set_color(GREEN))
        self.wait(0.5)
        self.play(highlight.animate.move_to(boxes[2]).set_color(BLUE))
        self.wait(1)
```

Render:

```bash
mamba activate animate-manim
manim render -qh slurm_lifecycle.py SlurmJobLifecycle
ffmpeg -i media/videos/slurm_lifecycle/1080p30/SlurmJobLifecycle.mp4 \
  -c:v libx264 -pix_fmt yuv420p -crf 18 slurm_job_lifecycle_1080p.mp4
```

---

### Example 2: Queue Priority Visualization (Motion Canvas)

This animation shows jobs as colored pills flowing into a priority queue, which is useful for explaining Slurm's scheduling behavior to new users:

```typescript
/**
 * Jobs flowing into a priority queue — visualizing Slurm fair-share scheduling.
 */
import {makeScene2D} from '@motion-canvas/2d';
import {Rect, Txt, Circle} from '@motion-canvas/2d/lib/components';
import {createRef, createRefArray} from '@motion-canvas/core/lib/utils';
import {all, chain, waitFor, loop} from '@motion-canvas/core/lib/flow';
import {easeOutCubic} from '@motion-canvas/core/lib/tweening';

export default makeScene2D(function* (view) {
  const queueBox = createRef<Rect>();
  const title = createRef<Txt>();

  // Title
  view.add(
    <Txt
      ref={title}
      text={'Slurm Priority Queue'}
      y={-300}
      fontSize={42}
      fill={'#ffffff'}
      opacity={0}
    />,
  );

  // Queue container
  view.add(
    <Rect
      ref={queueBox}
      x={0}
      y={50}
      width={600}
      height={120}
      radius={15}
      stroke={'#ffffff'}
      lineWidth={3}
      opacity={0}
    >
      <Txt text={'Priority Queue'} fill={'#aaaaaa'} fontSize={20} y={70} />
    </Rect>,
  );

  yield* all(title().opacity(1, 0.5), queueBox().opacity(1, 0.5));

  // Job definitions: name, color, priority (affects x position in queue)
  const jobs = [
    {name: 'Job A', color: '#e74c3c', priority: 3, startX: -400, startY: -150},
    {name: 'Job B', color: '#3498db', priority: 1, startX: -400, startY: -150},
    {name: 'Job C', color: '#2ecc71', priority: 2, startX: -400, startY: -150},
  ];

  const queuePositions = [-200, 0, 200]; // left = highest priority

  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i];
    const pill = createRef<Rect>();

    view.add(
      <Rect
        ref={pill}
        x={job.startX}
        y={job.startY}
        width={140}
        height={50}
        radius={25}
        fill={job.color}
        opacity={0}
      >
        <Txt text={job.name} fill={'#ffffff'} fontSize={20} />
      </Rect>,
    );

    // Animate pill appearing and dropping into queue
    yield* pill().opacity(1, 0.2);
    yield* all(
      pill().position.x(queuePositions[job.priority - 1], 0.8),
      pill().position.y(50, 0.8),
    );
    yield* waitFor(0.3);
  }

  yield* waitFor(1.0);
});
```

---

### Example 3: Animated Cluster Utilization Chart (matplotlib)

This animation renders a time-evolving bar chart of CPU utilization across cluster nodes, the kind of visual you would show when explaining resource contention during a Slurm training:

```python
"""Animated cluster utilization chart from synthetic node data."""

from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np
from matplotlib.animation import FuncAnimation

# --- Synthetic cluster data ---
rng = np.random.default_rng(123)
node_names: list[str] = [f"node{i:03d}" for i in range(1, 13)]
n_frames: int = 90  # 3 seconds at 30 fps

# CPU utilization evolves over time: starts low, ramps up, then some nodes spike
utilization: np.ndarray = np.zeros((n_frames, len(node_names)))
for frame in range(n_frames):
    base = min(frame / n_frames * 80, 80)
    noise = rng.normal(0, 10, len(node_names))
    utilization[frame] = np.clip(base + noise, 0, 100)

# Simulate a hotspot on nodes 3-5 starting at frame 40
for frame in range(40, n_frames):
    utilization[frame, 2:5] = np.clip(90 + rng.normal(0, 3, 3), 85, 100)

# --- Build animation ---
fig, ax = plt.subplots(figsize=(19.20, 10.80), dpi=100)


def colormap(util: float) -> str:
    """Map utilization percentage to a color: green -> yellow -> red."""
    if util < 50:
        return "#2ecc71"
    elif util < 80:
        return "#f1c40f"
    return "#e74c3c"


bars = ax.bar(node_names, utilization[0], color=[colormap(u) for u in utilization[0]])
ax.set_ylim(0, 110)
ax.set_ylabel("CPU Utilization (%)", fontsize=18)
ax.set_xlabel("Node", fontsize=18)
ax.set_title("Cluster CPU Utilization Over Time", fontsize=22)
ax.tick_params(axis="x", rotation=45, labelsize=12)
ax.tick_params(axis="y", labelsize=14)
ax.axhline(y=80, color="red", linestyle="--", alpha=0.5, label="Overload threshold")
ax.legend(fontsize=14)

timestamp = ax.text(
    0.98, 0.95, "", transform=ax.transAxes,
    ha="right", va="top", fontsize=16, color="gray",
)


def update(frame: int) -> list:
    """Update bars for each frame."""
    for bar, util in zip(bars, utilization[frame]):
        bar.set_height(util)
        bar.set_color(colormap(util))
    timestamp.set_text(f"t = {frame * 10}s")
    return list(bars) + [timestamp]


anim = FuncAnimation(fig, update, frames=n_frames, interval=33, blit=True)

output_path = Path("cluster_utilization_1080p.mp4")
anim.save(
    str(output_path),
    writer="ffmpeg",
    fps=30,
    dpi=100,
    extra_args=["-pix_fmt", "yuv420p", "-crf", "18"],
)
print(f"Saved: {output_path} ({output_path.stat().st_size / 1024 / 1024:.1f} MB)")
plt.close()
```

---

## Hands-On Exercises

### Exercise 1: Add a FAILED State to the Manim Lifecycle

Take the Slurm Job Lifecycle example and add a `FAILED` state (in red) branching off from `RUNNING`. Add a curved arrow from RUNNING to FAILED with the label "OOM killed". Render at 1080p and verify the MP4 plays in PowerPoint.

**Hints:** Use `CurvedArrow` instead of `Arrow`. Position the FAILED box below the RUNNING box using `.next_to(running_box, DOWN)`.

### Exercise 2: Animate Real squeue Data with matplotlib

Run `squeue --format="%P %T" --noheader` on your cluster (or generate a synthetic CSV with the same format). Parse the output and animate a stacked bar chart showing PENDING vs RUNNING vs COMPLETED jobs per partition over 10 snapshots.

**Hints:** Use `ax.bar()` with `bottom` parameter for stacking. Take snapshots with a bash loop: `for i in $(seq 1 10); do squeue --format="%P %T" --noheader > snapshot_$i.csv; sleep 30; done`.

### Exercise 3: Add Node Labels to the Motion Canvas Pipeline

Extend the Storage-to-Compute Motion Canvas example to show three compute nodes instead of one. Animate data packets distributing across all three (round-robin). Add text labels showing "Rank 0", "Rank 1", "Rank 2".

**Hints:** Create an array of compute box refs. Use a `for` loop with `yield*` to animate each packet sequentially.

---

## Troubleshooting

### "PowerPoint cannot insert a video from the selected file"

Your MP4 is not using yuv420p pixel format. Verify with:

```bash
ffprobe -v error -select_streams v:0 -show_entries stream=pix_fmt your_file.mp4
```

If it shows `yuv444p` or `yuv422p`, re-encode:

```bash
ffmpeg -i your_file.mp4 -c:v libx264 -pix_fmt yuv420p -crf 18 fixed.mp4
```

### "FFmpeg not found" during Manim render

Manim requires FFmpeg on your PATH. If you installed it inside a mamba environment, make sure the environment is activated. Verify:

```bash
which ffmpeg
# Should point to something like: ~/miniforge3/envs/animate-manim/bin/ffmpeg
```

### Manim fails with "Cairo" or "Pango" errors

These are system-level dependencies that mamba handles automatically when you install via `mamba install manim`. If you installed via pip instead, you need to install Cairo and Pango manually. The fix: uninstall the pip version and reinstall via mamba.

```bash
pip uninstall manim
mamba install -c conda-forge manim
```

### Motion Canvas editor shows blank screen

Make sure you are running `npm start` from the project root directory (where `package.json` lives). Check the terminal for error messages — a common issue is a missing FFmpeg exporter. Install it:

```bash
npm install --save @motion-canvas/ffmpeg
```

### matplotlib animation is choppy or low resolution

Make sure you set both `figsize` and `dpi` to match 1920x1080:

```python
fig, ax = plt.subplots(figsize=(19.20, 10.80), dpi=100)
```

`19.20 * 100 = 1920` pixels wide. `10.80 * 100 = 1080` pixels tall. If you use default `figsize` and `dpi`, you get a tiny video that looks blurry when projected.

---

## References

- **Manim Community Edition:** https://docs.manim.community/en/stable/
- **Manim conda-forge package:** https://github.com/conda-forge/manim-feedstock
- **Motion Canvas:** https://motioncanvas.io/docs/
- **Motion Canvas FFmpeg exporter:** https://motioncanvas.io/docs/rendering/video/
- **matplotlib animation module:** https://matplotlib.org/stable/api/animation_api.html
- **FFmpeg H.264 encoding guide:** https://trac.ffmpeg.org/wiki/Encode/H.264
- **PowerPoint video requirements:** https://support.microsoft.com/en-us/office/video-and-audio-file-formats-supported-in-powerpoint

---

## Summary

You now have three code-based animation tools installed and working:

1. **Manim** — best for geometric diagrams, state machines, and architectural reveals. Install via `mamba install manim`, render via `manim render -qh`.
2. **Motion Canvas** — best for polished motion design with spring physics and easing. Install via `npm init @motion-canvas@latest`, render via the web editor or `npx motion-canvas render`.
3. **matplotlib** — best for data-driven animations from real cluster metrics. Already in your Python stack, render by calling `anim.save()` with FFmpeg.

All three produce MP4 files that embed in PowerPoint. Always verify yuv420p pixel format before presenting.

The [[animation-toolkit-for-hpc-talks-deep-dive|deep dive companion]] covers advanced recipes, workflow integration with [[just-beginner-guide|Just]] and Snakemake, containerization with [[isaaclab-metagrasp-apptainer-hpc-beginner-guide|Apptainer]], and a complete recipe book with 12 HPC-themed animations.

---

## Related Tutorials

- [[animation-toolkit-for-hpc-talks-deep-dive|Animation Toolkit Deep Dive]] — advanced recipes, workflow integration, video recreation
- [[docker-test-container-beginner-guide|Docker Containers Guide]] — container concepts for isolated build environments
- [[docker-test-container-deep-dive|Docker Deep Dive]] — container internals
- [[isaaclab-metagrasp-apptainer-hpc-beginner-guide|IsaacLab Apptainer HPC Guide]] — running containerized workloads on HPC clusters
- [[hyperqueue-basics|HyperQueue Basics]] — HPC job scheduling concepts
- [[hyperqueue-deep-dive|HyperQueue Deep Dive]] — advanced job scheduling
- [[parsl-beginner-guide|Parsl Beginner Guide]] — parallel computing workflows in Python
- [[just-beginner-guide|Just Beginner Guide]] — task runner for build automation
- [[just-deep-dive|Just Deep Dive]] — advanced Just recipes
- [[pixi-beginner-guide|Pixi Beginner Guide]] — Python/conda environment management
- [[pixi-deep-dive|Pixi Deep Dive]] — advanced Pixi usage
- [[linux-permissions-beginner-guide|Linux Permissions Guide]] — file permissions for render output directories
