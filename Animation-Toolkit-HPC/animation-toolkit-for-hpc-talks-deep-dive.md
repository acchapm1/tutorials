---
title: "Animation Toolkit for HPC Talks — Deep Dive"
date: 2026-05-21
difficulty: advanced
tags: [animation, manim, motion-canvas, matplotlib, hpc, presentations, python, typescript, mp4, powerpoint, opencv, slurm, snakemake, apptainer]
---

# Animation Toolkit for HPC Talks — Deep Dive

This reference covers everything you need to produce publication-quality animations for HPC conference talks using code-based tools. It assumes you have completed the [[animation-toolkit-for-hpc-talks-beginner-guide|beginner guide]] and have Manim, Motion Canvas, and matplotlib rendering successfully.

---

## 1. TL;DR Decision Matrix

| Criterion | Manim CE | Motion Canvas | matplotlib |
|-----------|----------|---------------|------------|
| **Language** | Python 3.10+ | TypeScript 5+ | Python 3.10+ |
| **Best for** | State machines, DAG reveals, geometric diagrams, LaTeX equations | Polished UI-style motion, pipeline flows, heatmap grids, spring physics | Data-driven animated charts from real CSV/sacct output |
| **Worst for** | Real-time data plots, rapid prototyping | Quick one-off charts, math-heavy content | Complex multi-object geometric scenes |
| **Setup complexity** | Medium — needs Cairo, Pango, LaTeX (mamba handles it) | Low — npm install, Node.js only | Lowest — already on most HPC systems |
| **Render speed (10s clip)** | 3-15s | 5-20s | 1-8s |
| **Fits HPC Python stack?** | Yes (mamba/conda-forge) | No (requires Node.js ecosystem) | Yes (already installed everywhere) |
| **Data-driven?** | Manual — you code the data into the scene | Manual — you import JSON/arrays | Native — built for plotting data |
| **Live preview** | Jupyter `%%manim` magic, `-p` flag | Built-in web editor at localhost:9000 | Jupyter `%matplotlib notebook` |
| **Version** | v0.18-0.20 (Community Edition) | v3.x | 3.8-3.10 |

**Verdict:** For a typical LCI-style talk, you will use matplotlib for 60% of your animations (anything data-driven: throughput charts, utilization heatmaps, queue depth timelines) and Manim for 35% (state machines, architecture diagrams, DAG reveals). Motion Canvas fills the remaining 5% when you need cinema-quality polish — a slick title sequence, a complex pipeline flow with spring easing, or a heatmap grid that evolves over time. Start with matplotlib because you already know it, add Manim when you need geometry, and reach for Motion Canvas only when the other two cannot achieve the visual quality you want.

---

## 2. Shared Prerequisites

### 2.1 Environment Strategy

Create one isolated environment per tool. This avoids dependency conflicts and lets you pin versions independently. If you use [[pixi-beginner-guide|Pixi]] instead of mamba, the same channel and package names work.

#### Manim Environment

```yaml
# environment-manim.yml
name: animate-manim
channels:
  - conda-forge
dependencies:
  - python=3.11
  - manim>=0.18
  - ffmpeg
  - jupyterlab          # optional: for live preview
  - pycairo             # pulled by manim, listed for clarity
  - pygobject           # Pango text rendering
  - texlive-core        # optional: for LaTeX equations
```

```bash
mamba env create -f environment-manim.yml
mamba activate animate-manim
manim --version
```

#### matplotlib Environment

```yaml
# environment-mpl.yml
name: animate-mpl
channels:
  - conda-forge
dependencies:
  - python=3.11
  - matplotlib>=3.8
  - numpy>=1.26
  - ffmpeg
  - pandas              # for reading sacct CSV data
  - jupyterlab          # optional
```

```bash
mamba env create -f environment-mpl.yml
mamba activate animate-mpl
python -c "import matplotlib; print(matplotlib.__version__)"
```

#### Motion Canvas (Node.js)

```json
{
  "name": "hpc-animations",
  "private": true,
  "type": "module",
  "scripts": {
    "start": "motion-canvas serve",
    "render": "motion-canvas render"
  },
  "dependencies": {
    "@motion-canvas/2d": "^3.0.0",
    "@motion-canvas/core": "^3.0.0",
    "@motion-canvas/ffmpeg": "^1.0.0"
  },
  "devDependencies": {
    "@motion-canvas/vite-plugin": "^3.0.0",
    "typescript": "^5.0.0",
    "vite": "^5.0.0"
  }
}
```

```bash
npm install
npm start
```

### 2.2 FFmpeg Verification

Every tool ultimately calls FFmpeg to encode MP4. Verify it is available and has H.264 support:

```bash
ffmpeg -version 2>&1 | head -1
# ffmpeg version 6.x or 7.x

ffmpeg -encoders 2>/dev/null | grep libx264
# Should show: V..... libx264    libx264 H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10
```

**The yuv420p requirement explained:** H.264 supports multiple chroma subsampling modes. `yuv444p` preserves full color resolution but is not supported by most hardware decoders, including the one PowerPoint uses on Windows. `yuv420p` (4:2:0) subsamples chroma to quarter resolution, which is imperceptible for presentation graphics and is universally compatible. Always pass `-pix_fmt yuv420p` to FFmpeg. Manim defaults to `yuv444p`, so you must always re-encode Manim output or configure it globally.

### 2.3 Render Targets

Use two quality presets throughout your workflow:

| Preset | Resolution | FPS | Use Case |
|--------|-----------|-----|----------|
| **Preview** | 854x480 | 15 | Iterating on timing and layout |
| **Production** | 1920x1080 | 30 | Final embed in PowerPoint |

For Manim, these map to `-ql` (low) and `-qh` (high). For matplotlib, change `figsize`, `dpi`, and `fps` parameters. For Motion Canvas, configure resolution in `project.ts`.

---

## 3. Manim Community Edition — Deep Section

### 3.1 Quickstart

```bash
mamba activate animate-manim
```

Create `slurm_states_quick.py`:

```python
"""Quickstart: Slurm job transitions from PENDING to RUNNING to COMPLETED."""

from manim import *


class SlurmStatesQuick(Scene):
    def construct(self) -> None:
        states: list[tuple[str, ManimColor]] = [
            ("PENDING", YELLOW),
            ("RUNNING", GREEN),
            ("COMPLETED", BLUE),
        ]
        boxes: list[VGroup] = []
        for i, (name, color) in enumerate(states):
            box = RoundedRectangle(corner_radius=0.15, width=3, height=1, color=color)
            label = Text(name, font_size=28, color=color)
            group = VGroup(box, label).shift(RIGHT * (i - 1) * 4)
            boxes.append(group)

        self.play(*[FadeIn(b) for b in boxes])
        for i in range(len(boxes) - 1):
            arrow = Arrow(boxes[i].get_right(), boxes[i + 1].get_left(), buff=0.2)
            self.play(GrowArrow(arrow), run_time=0.5)
        self.wait(1)
```

```bash
manim render -qh slurm_states_quick.py SlurmStatesQuick
# Output: media/videos/slurm_states_quick/1080p30/SlurmStatesQuick.mp4

ffmpeg -i media/videos/slurm_states_quick/1080p30/SlurmStatesQuick.mp4 \
  -c:v libx264 -pix_fmt yuv420p -crf 18 -preset slow \
  slurm_states_quick_1080p.mp4
```

### 3.2 Comprehensive Reference

#### System Dependencies

When installed via `mamba install manim`, all system dependencies (Cairo, Pango, GLib, FreeType, FFmpeg) are handled automatically. Never install Manim via pip on an HPC system unless you can guarantee these C libraries are available — `mamba` is the right choice here.

For LaTeX support (optional, for rendering equations like `MathTex(r"\sum_{i=0}^{N} t_i")`), install `texlive-core` in the same environment. On HPC systems where TeX is available as a module, `module load texlive` before rendering also works.

#### Core Mental Model

A Manim animation is built from **Scenes**. Each Scene has a `construct()` method where you create **Mobjects** (mathematical objects) and apply **Animations** to them.

- **Mobject** — any visual element: `Circle`, `Rectangle`, `Text`, `Arrow`, `VGroup`, `MathTex`, `Table`
- **Animation** — a transformation applied over time: `Create`, `FadeIn`, `Transform`, `Write`, `GrowArrow`, `MoveToTarget`
- **self.play()** — executes one or more animations simultaneously
- **self.wait()** — pauses for a duration
- **run_time** — controls animation duration in seconds

Mobjects are arranged on a coordinate grid where (0, 0) is the center of the screen. `RIGHT`, `LEFT`, `UP`, `DOWN` are unit vectors. Use `.shift()`, `.move_to()`, `.next_to()`, and `.to_edge()` for positioning.

#### Project Structure

```
my-manim-project/
├── environment-manim.yml        # mamba environment definition
├── scenes/
│   ├── slurm_lifecycle.py       # one file per animation topic
│   ├── dag_reveal.py
│   └── mpi_ring.py
├── media/                       # auto-created by manim, gitignored
│   └── videos/
├── output/                      # re-encoded PPT-ready MP4s
├── render_all.sh                # batch render script
└── .gitignore
```

`.gitignore` for Manim projects:

```
media/
__pycache__/
*.pyc
```

#### Configuration

Create `manim.cfg` in your project root to set defaults:

```ini
[CLI]
quality = high_quality
preview = false

[renderer]
background_color = #1a1a2e
pixel_width = 1920
pixel_height = 1080
frame_rate = 30
```

The dark background `#1a1a2e` reads well on projected screens and avoids the pure-black look that can appear washed out on some projectors.

#### Composing Animations

Group related mobjects with `VGroup` to move, scale, or animate them together:

```python
node_group = VGroup(box, label, status_indicator)
self.play(node_group.animate.shift(RIGHT * 2))
```

Run animations in parallel by passing multiple to `self.play()`:

```python
self.play(
    box_a.animate.set_color(GREEN),
    box_b.animate.set_color(RED),
    run_time=0.8,
)
```

Sequence animations by calling `self.play()` multiple times:

```python
self.play(Create(box))
self.play(Write(label))
self.play(GrowArrow(arrow))
```

#### Text, Color, and Timing

Use `Text()` for plain text and `MathTex()` for LaTeX. Set consistent colors by defining a palette at the top of your script:

```python
SLURM_PENDING = "#f1c40f"
SLURM_RUNNING = "#2ecc71"
SLURM_COMPLETED = "#3498db"
SLURM_FAILED = "#e74c3c"
```

Timing rule of thumb: 0.5-0.8 seconds per state transition, 0.3 seconds for minor updates, 1-2 seconds for pauses where the audience reads text. Total animation length should be 5-15 seconds for a single concept.

#### Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `Cairo not found` | pip install without system deps | `mamba install manim` instead |
| `LaTeX not found` | TeX not installed | `mamba install texlive-core` or avoid `MathTex` |
| Render takes >60s | Too many objects or too high quality | Use `-ql` for preview, optimize object count |
| Colors look wrong in PPT | yuv444p encoding | Re-encode with `-pix_fmt yuv420p` |
| Text is tiny on projector | Small `font_size` | Use minimum `font_size=24` for body, `36` for titles |

#### Performance and Iteration

Use `-ql` (480p, 15fps) while iterating. Only render `-qh` for final output. For scenes with many objects, Manim's OpenGL renderer is faster:

```bash
manim render --renderer=opengl -qh scene.py ClassName
```

Use `self.next_section()` to split long scenes into named segments that render independently.

### 3.3 Recipe Book

#### Recipe 1: Slurm Job Lifecycle State Machine

**Concept:** Animate the full Slurm job state machine — PENDING, CONFIGURING, RUNNING, COMPLETING, COMPLETED — with transitions triggered by slurmctld events. This is the canonical diagram for teaching Slurm internals.

```python
"""Full Slurm job lifecycle state machine with all intermediate states."""

from manim import *

# Slurm state color palette
COLORS: dict[str, str] = {
    "PENDING": "#f1c40f",
    "CONFIGURING": "#e67e22",
    "RUNNING": "#2ecc71",
    "COMPLETING": "#9b59b6",
    "COMPLETED": "#3498db",
}


class SlurmFullLifecycle(Scene):
    def construct(self) -> None:
        title = Text("Slurm Job State Machine", font_size=38).to_edge(UP, buff=0.4)
        self.play(Write(title), run_time=0.6)

        # Create state boxes
        state_names: list[str] = list(COLORS.keys())
        positions: list[np.ndarray] = [
            LEFT * 5,
            LEFT * 2.5,
            ORIGIN,
            RIGHT * 2.5,
            RIGHT * 5,
        ]

        boxes: dict[str, VGroup] = {}
        for name, pos in zip(state_names, positions):
            box = RoundedRectangle(
                corner_radius=0.12,
                width=2.4,
                height=0.9,
                color=COLORS[name],
                fill_opacity=0.15,
                stroke_width=3,
            )
            label = Text(name, font_size=18, color=COLORS[name])
            group = VGroup(box, label).move_to(pos + DOWN * 0.3)
            boxes[name] = group

        # Animate states appearing one by one
        for name in state_names:
            self.play(FadeIn(boxes[name], shift=UP * 0.2), run_time=0.4)

        # Define transitions
        transitions: list[tuple[str, str, str]] = [
            ("PENDING", "CONFIGURING", "resources\nallocated"),
            ("CONFIGURING", "RUNNING", "prolog\ncomplete"),
            ("RUNNING", "COMPLETING", "job\nexits"),
            ("COMPLETING", "COMPLETED", "epilog\ncomplete"),
        ]

        for src, dst, event in transitions:
            arrow = Arrow(
                boxes[src].get_right(),
                boxes[dst].get_left(),
                buff=0.15,
                color=WHITE,
                stroke_width=2,
                max_tip_length_to_length_ratio=0.15,
            )
            event_label = Text(event, font_size=12, color=GRAY_B).next_to(
                arrow, UP, buff=0.05
            )
            self.play(GrowArrow(arrow), FadeIn(event_label), run_time=0.5)

        # Highlight traversal with a moving indicator
        indicator = SurroundingRectangle(
            boxes["PENDING"], color=WHITE, buff=0.1, stroke_width=3
        )
        self.play(Create(indicator), run_time=0.3)

        for name in state_names[1:]:
            self.play(
                indicator.animate.move_to(boxes[name]).set_color(COLORS[name]),
                run_time=0.6,
            )

        self.wait(1.5)
```

**Render command:**

```bash
manim render -qh slurm_lifecycle_full.py SlurmFullLifecycle
ffmpeg -i media/videos/slurm_lifecycle_full/1080p30/SlurmFullLifecycle.mp4 \
  -c:v libx264 -pix_fmt yuv420p -crf 18 -preset slow \
  slurm_full_lifecycle_1080p.mp4
```

**Expected render time:** ~5-8 seconds on a modern laptop.

**Gotchas:** The text font size of 18 is the minimum for 1080p projection. If your projector is low-resolution, bump all font sizes up by 30%.

---

#### Recipe 2: Workflow DAG Reveal

**Concept:** Build a Snakemake/Nextflow-style DAG node-by-node, showing how tasks depend on each other. This is the animation you show when explaining workflow managers to an audience that is used to flat shell scripts.

```python
"""Workflow DAG that builds up node-by-node, showing task dependencies."""

from manim import *


class WorkflowDAGReveal(Scene):
    def construct(self) -> None:
        title = Text("Snakemake Workflow DAG", font_size=36).to_edge(UP, buff=0.4)
        self.play(Write(title), run_time=0.5)

        # DAG node definitions: (name, position, color)
        nodes_data: list[tuple[str, np.ndarray, str]] = [
            ("download\nfastq", LEFT * 4 + UP * 1.5, "#3498db"),
            ("trim\nreads", LEFT * 1.5 + UP * 1.5, "#2ecc71"),
            ("align\nto ref", RIGHT * 1 + UP * 1.5, "#e67e22"),
            ("index\nref", LEFT * 4 + DOWN * 1.0, "#9b59b6"),
            ("call\nvariants", RIGHT * 3.5 + UP * 0.25, "#e74c3c"),
            ("generate\nreport", RIGHT * 3.5 + DOWN * 1.5, "#f1c40f"),
        ]

        # Edge definitions: (source_index, target_index)
        edges_data: list[tuple[int, int]] = [
            (0, 1),  # download -> trim
            (1, 2),  # trim -> align
            (3, 2),  # index_ref -> align
            (2, 4),  # align -> call_variants
            (4, 5),  # call_variants -> generate_report
        ]

        # Create node mobjects
        nodes: list[VGroup] = []
        for name, pos, color in nodes_data:
            box = RoundedRectangle(
                corner_radius=0.1, width=2.2, height=1.0,
                color=color, fill_opacity=0.2, stroke_width=2,
            )
            label = Text(name, font_size=16, color=color)
            group = VGroup(box, label).move_to(pos)
            nodes.append(group)

        # Animate nodes appearing in dependency order
        # Layer 0: download, index_ref (no dependencies)
        self.play(FadeIn(nodes[0], shift=DOWN * 0.2), FadeIn(nodes[3], shift=DOWN * 0.2), run_time=0.5)

        # Layer 1: trim (depends on download)
        edge_0_1 = Arrow(nodes[0].get_right(), nodes[1].get_left(), buff=0.15, color=GRAY, stroke_width=2)
        self.play(FadeIn(nodes[1], shift=DOWN * 0.2), GrowArrow(edge_0_1), run_time=0.5)

        # Layer 2: align (depends on trim + index_ref)
        edge_1_2 = Arrow(nodes[1].get_right(), nodes[2].get_left(), buff=0.15, color=GRAY, stroke_width=2)
        edge_3_2 = Arrow(nodes[3].get_right(), nodes[2].get_left(), buff=0.15, color=GRAY, stroke_width=2)
        self.play(
            FadeIn(nodes[2], shift=DOWN * 0.2),
            GrowArrow(edge_1_2),
            GrowArrow(edge_3_2),
            run_time=0.5,
        )

        # Layer 3: call_variants
        edge_2_4 = Arrow(nodes[2].get_right(), nodes[4].get_left(), buff=0.15, color=GRAY, stroke_width=2)
        self.play(FadeIn(nodes[4], shift=DOWN * 0.2), GrowArrow(edge_2_4), run_time=0.5)

        # Layer 4: generate_report
        edge_4_5 = Arrow(nodes[4].get_bottom(), nodes[5].get_top(), buff=0.15, color=GRAY, stroke_width=2)
        self.play(FadeIn(nodes[5], shift=DOWN * 0.2), GrowArrow(edge_4_5), run_time=0.5)

        self.wait(1.5)
```

**Render command:**

```bash
manim render -qh workflow_dag.py WorkflowDAGReveal
ffmpeg -i media/videos/workflow_dag/1080p30/WorkflowDAGReveal.mp4 \
  -c:v libx264 -pix_fmt yuv420p -crf 18 -preset slow \
  workflow_dag_reveal_1080p.mp4
```

**Expected render time:** ~4-6 seconds.

**Gotchas:** Arrow routing can overlap with node labels if positions are too close. Always leave at least 2 units of horizontal space between connected nodes.

---

#### Recipe 3: Apptainer/Docker Image Layer Stack

**Concept:** Visualize how container image layers stack on top of each other, with size annotations showing the cost of each layer. This is essential when teaching [[docker-test-container-beginner-guide|container concepts]] to HPC users who are used to flat filesystem installs.

```python
"""Container image layers stacking with size annotations."""

from manim import *


class ContainerLayerStack(Scene):
    def construct(self) -> None:
        title = Text("Apptainer Image Layers", font_size=36).to_edge(UP, buff=0.4)
        self.play(Write(title), run_time=0.5)

        # Layer definitions: (name, color, size_label)
        layers_data: list[tuple[str, str, str]] = [
            ("Ubuntu 22.04 base", "#3498db", "78 MB"),
            ("apt: build-essential gcc", "#2ecc71", "245 MB"),
            ("pip: numpy scipy mpi4py", "#e67e22", "180 MB"),
            ("App: /opt/hpc-bench/", "#e74c3c", "12 MB"),
            ("Config: /etc/slurm/", "#9b59b6", "< 1 MB"),
        ]

        layer_height: float = 0.8
        layer_width: float = 8.0
        start_y: float = -2.5

        layers: list[VGroup] = []
        total_label_y: float = start_y + len(layers_data) * (layer_height + 0.1) + 0.5

        for i, (name, color, size) in enumerate(layers_data):
            y_pos = start_y + i * (layer_height + 0.1)
            rect = Rectangle(
                width=layer_width, height=layer_height,
                color=color, fill_opacity=0.3, stroke_width=2,
            ).move_to(UP * y_pos)

            name_text = Text(name, font_size=20, color=WHITE).move_to(rect.get_center() + LEFT * 1.5)
            size_text = Text(size, font_size=18, color=GRAY_B).move_to(rect.get_center() + RIGHT * 2.8)

            group = VGroup(rect, name_text, size_text)
            layers.append(group)

        # Animate layers stacking from bottom up
        for i, layer in enumerate(layers):
            # Layer slides in from the left and settles
            layer.shift(LEFT * 10)
            self.play(layer.animate.shift(RIGHT * 10), run_time=0.5)

        # Add total size annotation
        brace = Brace(VGroup(*[l[0] for l in layers]), direction=RIGHT, color=WHITE)
        total = Text("515 MB total", font_size=22, color=WHITE).next_to(brace, RIGHT, buff=0.2)
        self.play(GrowFromCenter(brace), Write(total), run_time=0.6)

        # Highlight the read-only vs writable boundary
        boundary_line = DashedLine(
            LEFT * 4.5 + UP * (start_y + 3 * (layer_height + 0.1) + layer_height / 2 + 0.05),
            RIGHT * 4.5 + UP * (start_y + 3 * (layer_height + 0.1) + layer_height / 2 + 0.05),
            color=YELLOW,
            dash_length=0.15,
        )
        ro_label = Text("read-only (cached)", font_size=16, color=YELLOW).next_to(
            boundary_line, LEFT, buff=0.1
        ).shift(DOWN * 0.3)
        rw_label = Text("writable (overlay)", font_size=16, color=YELLOW).next_to(
            boundary_line, LEFT, buff=0.1
        ).shift(UP * 0.3)

        self.play(Create(boundary_line), FadeIn(ro_label), FadeIn(rw_label), run_time=0.6)
        self.wait(1.5)
```

**Render command:**

```bash
manim render -qh container_layers.py ContainerLayerStack
ffmpeg -i media/videos/container_layers/1080p30/ContainerLayerStack.mp4 \
  -c:v libx264 -pix_fmt yuv420p -crf 18 -preset slow \
  container_layer_stack_1080p.mp4
```

**Expected render time:** ~4-6 seconds.

**Gotchas:** The layer names must fit inside the rectangle. At `font_size=20` with `layer_width=8.0`, you have room for about 35 characters. Longer names should be abbreviated.

---

#### Recipe 4: MPI Communication Pattern

**Concept:** Animate MPI ranks arranged in a ring (or grid) passing messages to each other. This is the go-to animation for teaching MPI_Send/MPI_Recv, ring allreduce, or halo exchange patterns.

```python
"""MPI ranks in a ring topology with animated message passing."""

from manim import *
import numpy as np


class MPIRingCommunication(Scene):
    def construct(self) -> None:
        title = Text("MPI Ring AllReduce", font_size=36).to_edge(UP, buff=0.4)
        self.play(Write(title), run_time=0.5)

        n_ranks: int = 6
        radius: float = 2.5
        rank_colors: list[str] = ["#e74c3c", "#3498db", "#2ecc71", "#f1c40f", "#9b59b6", "#e67e22"]

        # Create rank nodes in a circle
        rank_nodes: list[VGroup] = []
        angles: list[float] = [i * 2 * np.pi / n_ranks + np.pi / 2 for i in range(n_ranks)]

        for i in range(n_ranks):
            x = radius * np.cos(angles[i])
            y = radius * np.sin(angles[i]) - 0.5
            circle = Circle(radius=0.5, color=rank_colors[i], fill_opacity=0.3, stroke_width=3)
            label = Text(f"Rank {i}", font_size=18, color=rank_colors[i])
            group = VGroup(circle, label).move_to(RIGHT * x + UP * y)
            rank_nodes.append(group)

        # Fade in all ranks
        self.play(*[FadeIn(node) for node in rank_nodes], run_time=0.6)

        # Animate messages passing around the ring (each rank sends to rank+1)
        step_label = Text("Step 1: Send to neighbor", font_size=22, color=GRAY).to_edge(DOWN, buff=0.5)
        self.play(FadeIn(step_label), run_time=0.3)

        for step in range(3):
            messages: list[Dot] = []
            message_anims: list[Animation] = []

            for i in range(n_ranks):
                src_pos = rank_nodes[i].get_center()
                dst_idx = (i + 1) % n_ranks
                dst_pos = rank_nodes[dst_idx].get_center()

                msg = Dot(point=src_pos, radius=0.12, color=rank_colors[i])
                messages.append(msg)

            # Show messages appearing
            self.play(*[FadeIn(m, scale=0.5) for m in messages], run_time=0.2)

            # Move messages to their destinations
            move_anims = []
            for i, msg in enumerate(messages):
                dst_idx = (i + 1) % n_ranks
                dst_pos = rank_nodes[dst_idx].get_center()
                move_anims.append(msg.animate.move_to(dst_pos))

            self.play(*move_anims, run_time=0.6)

            # Fade out messages (received)
            self.play(*[FadeOut(m, scale=0.5) for m in messages], run_time=0.2)

            # Update step label
            if step < 2:
                new_label = Text(f"Step {step + 2}: Send to neighbor", font_size=22, color=GRAY).to_edge(
                    DOWN, buff=0.5
                )
                self.play(Transform(step_label, new_label), run_time=0.2)

        # Final label
        complete_label = Text("AllReduce complete — all ranks have global sum", font_size=22, color=GREEN).to_edge(
            DOWN, buff=0.5
        )
        self.play(Transform(step_label, complete_label), run_time=0.4)
        self.play(*[node[0].animate.set_color(GREEN) for node in rank_nodes], run_time=0.5)
        self.wait(1.5)
```

**Render command:**

```bash
manim render -qh mpi_ring.py MPIRingCommunication
ffmpeg -i media/videos/mpi_ring/1080p30/MPIRingCommunication.mp4 \
  -c:v libx264 -pix_fmt yuv420p -crf 18 -preset slow \
  mpi_ring_allreduce_1080p.mp4
```

**Expected render time:** ~8-12 seconds (many animated objects per frame).

**Gotchas:** With 6+ ranks, message dots can overlap during transit. Increase `radius` or reduce dot `radius` to avoid visual clutter. For 8+ ranks, switch to a grid layout instead of a ring.

---

## 4. Motion Canvas — Deep Section

### 4.1 Quickstart

```bash
npm init @motion-canvas@latest
# Name: hpc-mc-animations
# Language: TypeScript
# Exporter: Video (FFmpeg)

cd hpc-mc-animations
npm install
```

Create `src/scenes/slurm_queue.tsx`:

```typescript
/**
 * Quickstart: jobs flowing into a Slurm priority queue.
 */
import {makeScene2D} from '@motion-canvas/2d';
import {Rect, Txt} from '@motion-canvas/2d/lib/components';
import {createRef} from '@motion-canvas/core/lib/utils';
import {all, waitFor} from '@motion-canvas/core/lib/flow';

export default makeScene2D(function* (view) {
  const queueLabel = createRef<Txt>();
  view.add(<Txt ref={queueLabel} text={'Slurm Queue'} y={-280} fontSize={40} fill={'#ffffff'} opacity={0} />);
  yield* queueLabel().opacity(1, 0.5);

  const jobNames = ['Job_001', 'Job_002', 'Job_003'];
  const colors = ['#e74c3c', '#3498db', '#2ecc71'];

  for (let i = 0; i < jobNames.length; i++) {
    const pill = createRef<Rect>();
    view.add(
      <Rect ref={pill} x={-500} y={-100 + i * 80} width={160} height={50} radius={25} fill={colors[i]} opacity={0}>
        <Txt text={jobNames[i]} fill={'#ffffff'} fontSize={20} />
      </Rect>,
    );
    yield* pill().opacity(1, 0.2);
    yield* pill().position.x(0, 0.6);
  }
  yield* waitFor(1.0);
});
```

```bash
npm start
# Render via the UI at localhost:9000, or:
npx motion-canvas render
# Output: output/project.mp4
```

### 4.2 Comprehensive Reference

#### System Dependencies

Motion Canvas requires Node.js 18+ and npm. For the FFmpeg video exporter, FFmpeg must be on your PATH. On HPC systems, load Node.js via your module system or install it with [[pixi-beginner-guide|Pixi]]:

```bash
pixi global install nodejs
```

#### Core Mental Model

Motion Canvas uses **generator functions** (`function*`) to describe animations. Each `yield*` expression pauses execution until the animation completes. This makes sequencing intuitive:

```typescript
yield* box().opacity(1, 0.5);   // fade in over 0.5s, then continue
yield* box().position.x(300, 1.0); // slide right over 1.0s, then continue
```

Use `all()` for parallel animations and `chain()` for explicit sequencing:

```typescript
yield* all(
  boxA().opacity(1, 0.5),
  boxB().opacity(1, 0.5),
);
```

Key components: `Rect`, `Circle`, `Txt`, `Line`, `Layout`, `Img`. Every component is a **signal-based reactive node** — you animate properties by calling them as setters with a duration.

#### Project Structure

```
hpc-mc-animations/
├── package.json
├── tsconfig.json
├── vite.config.ts
├── src/
│   ├── project.ts            # project configuration (resolution, fps, scenes)
│   └── scenes/
│       ├── slurm_queue.tsx
│       ├── cluster_heatmap.tsx
│       └── cicd_pipeline.tsx
├── output/                    # rendered video files
└── .gitignore
```

Configure resolution in `src/project.ts`:

```typescript
import {makeProject} from '@motion-canvas/core';
import slurmQueue from './scenes/slurm_queue?scene';

export default makeProject({
  scenes: [slurmQueue],
  // Production: 1920x1080 @ 30fps
  size: {x: 1920, y: 1080},
  fps: 30,
  // Preview: uncomment for faster iteration
  // size: {x: 854, y: 480},
  // fps: 15,
});
```

#### Timing and Easing

Motion Canvas has excellent built-in easing functions:

```typescript
import {easeOutCubic, easeInOutQuad, spring} from '@motion-canvas/core/lib/tweening';

yield* box().position.x(300, 0.8, easeOutCubic);  // smooth deceleration
yield* box().scale(1.2, 0.5, spring(2, 100));      // bouncy spring
```

For HPC animations, `easeOutCubic` is the best default — it gives a natural "arriving" feel without being distracting.

#### Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| Blank editor screen | Missing scene import in `project.ts` | Verify `scenes` array includes your scene |
| FFmpeg export fails | FFmpeg not on PATH | `which ffmpeg` or install `@motion-canvas/ffmpeg` |
| Jerky playback in editor | Complex scene + slow machine | Reduce `fps` to 15 for preview |
| Type errors in JSX | Missing `@motion-canvas/2d` types | Run `npm install` again |

### 4.3 Recipe Book

#### Recipe 1: Slurm Queue Dynamics

**Concept:** Jobs as colored pills flowing into a priority queue, being scheduled, and leaving. This shows the scheduling lifecycle from a queue management perspective.

```typescript
/**
 * Slurm queue dynamics: jobs arrive, get prioritized, and are dispatched to nodes.
 */
import {makeScene2D} from '@motion-canvas/2d';
import {Rect, Txt, Line} from '@motion-canvas/2d/lib/components';
import {createRef, createRefArray} from '@motion-canvas/core/lib/utils';
import {all, chain, waitFor, sequence} from '@motion-canvas/core/lib/flow';
import {easeOutCubic} from '@motion-canvas/core/lib/tweening';

export default makeScene2D(function* (view) {
  // Title
  const title = createRef<Txt>();
  view.add(<Txt ref={title} text={'Slurm Scheduler Queue'} y={-350} fontSize={38} fill={'#ffffff'} opacity={0} />);
  yield* title().opacity(1, 0.4);

  // Queue container
  const queueBox = createRef<Rect>();
  view.add(
    <Rect ref={queueBox} x={0} y={-50} width={700} height={100} radius={12} stroke={'#555555'} lineWidth={2} opacity={0}>
      <Txt text={'Priority Queue'} fill={'#666666'} fontSize={16} y={60} />
    </Rect>,
  );
  yield* queueBox().opacity(1, 0.4);

  // Compute node boxes at bottom
  const nodeColors = ['#27ae60', '#2980b9', '#8e44ad'];
  const nodeNames = ['gpu-node01', 'cpu-node01', 'cpu-node02'];
  const nodeRefs = createRefArray<Rect>();

  for (let i = 0; i < 3; i++) {
    view.add(
      <Rect
        ref={nodeRefs}
        x={-250 + i * 250}
        y={200}
        width={180}
        height={80}
        radius={8}
        fill={nodeColors[i]}
        opacity={0}
      >
        <Txt text={nodeNames[i]} fill={'#ffffff'} fontSize={16} />
      </Rect>,
    );
  }
  yield* all(...nodeRefs.map(n => n.opacity(1, 0.4)));

  // Job definitions
  const jobs = [
    {name: 'gpu_train', color: '#e74c3c', targetNode: 0, priority: 1},
    {name: 'data_prep', color: '#f39c12', targetNode: 1, priority: 3},
    {name: 'analysis', color: '#1abc9c', targetNode: 2, priority: 2},
    {name: 'postproc', color: '#e67e22', targetNode: 1, priority: 4},
  ];

  const queueSlots = [-250, -90, 70, 230]; // x positions in queue

  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i];
    const pill = createRef<Rect>();

    // Job appears from the left
    view.add(
      <Rect ref={pill} x={-600} y={-50} width={140} height={45} radius={22} fill={job.color} opacity={0}>
        <Txt text={job.name} fill={'#ffffff'} fontSize={16} />
      </Rect>,
    );

    yield* pill().opacity(1, 0.15);

    // Slide into queue position
    yield* pill().position.x(queueSlots[job.priority - 1], 0.5, easeOutCubic);
    yield* waitFor(0.3);

    // Dispatch to compute node (slide down)
    yield* all(
      pill().position.x(nodeRefs[job.targetNode].position.x(), 0.5),
      pill().position.y(120, 0.5),
    );
    yield* pill().opacity(0, 0.3);
  }

  // Final message
  const done = createRef<Txt>();
  view.add(<Txt ref={done} text={'All jobs dispatched'} y={330} fontSize={24} fill={'#2ecc71'} opacity={0} />);
  yield* done().opacity(1, 0.5);
  yield* waitFor(1.0);
});
```

**Render command:**

```bash
npx motion-canvas render
# Output: output/project.mp4
```

**Expected render time:** ~8-12 seconds.

**Gotchas:** If you add more than 4 jobs, extend the `queueSlots` array and widen `queueBox` to avoid overflow.

---

#### Recipe 2: Cluster Utilization Heatmap Evolution

**Concept:** An N x M grid of rectangles representing cluster nodes, colored by CPU utilization, evolving over time. This is the animation you show when discussing how load distributes (or fails to distribute) across a cluster.

```typescript
/**
 * Cluster utilization heatmap: 4x6 grid of nodes animating from idle to loaded.
 */
import {makeScene2D} from '@motion-canvas/2d';
import {Rect, Txt} from '@motion-canvas/2d/lib/components';
import {createRef, createRefArray} from '@motion-canvas/core/lib/utils';
import {all, waitFor, loop} from '@motion-canvas/core/lib/flow';
import {Color} from '@motion-canvas/core/lib/types';

function utilizationColor(util: number): string {
  if (util < 30) return '#2ecc71';   // green: idle
  if (util < 60) return '#f1c40f';   // yellow: moderate
  if (util < 85) return '#e67e22';   // orange: busy
  return '#e74c3c';                   // red: overloaded
}

export default makeScene2D(function* (view) {
  const title = createRef<Txt>();
  view.add(<Txt ref={title} text={'Cluster Utilization Heatmap'} y={-350} fontSize={38} fill={'#ffffff'} opacity={0} />);
  yield* title().opacity(1, 0.4);

  const rows = 4;
  const cols = 6;
  const cellSize = 100;
  const gap = 8;
  const startX = -(cols * (cellSize + gap)) / 2 + cellSize / 2;
  const startY = -(rows * (cellSize + gap)) / 2 + cellSize / 2 + 30;

  const cells = createRefArray<Rect>();
  const labels = createRefArray<Txt>();

  // Build grid
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = startX + c * (cellSize + gap);
      const y = startY + r * (cellSize + gap);
      const nodeId = r * cols + c;
      view.add(
        <Rect ref={cells} x={x} y={y} width={cellSize} height={cellSize} radius={6} fill={'#2ecc71'} opacity={0}>
          <Txt ref={labels} text={`n${String(nodeId).padStart(2, '0')}`} fill={'#ffffff'} fontSize={14} y={-15} />
          <Txt text={'0%'} fill={'#ffffff'} fontSize={18} y={15} />
        </Rect>,
      );
    }
  }

  // Fade in the grid
  yield* all(...cells.map(c => c.opacity(1, 0.3)));

  // Simulate 5 time steps of utilization changes
  const utilSnapshots = [
    // Step 0: mostly idle
    [10, 5, 8, 12, 3, 7, 15, 20, 5, 8, 10, 6, 3, 9, 11, 4, 8, 12, 5, 7, 10, 3, 6, 9],
    // Step 1: jobs arriving
    [45, 50, 38, 12, 3, 7, 55, 60, 42, 8, 10, 6, 35, 40, 11, 4, 8, 12, 50, 45, 38, 3, 6, 9],
    // Step 2: GPU nodes spike
    [92, 95, 88, 85, 50, 45, 55, 60, 42, 38, 35, 30, 90, 88, 85, 40, 38, 35, 50, 45, 38, 30, 28, 25],
    // Step 3: load spreading
    [75, 78, 72, 70, 65, 62, 70, 72, 68, 65, 60, 58, 72, 70, 68, 65, 62, 60, 70, 68, 65, 60, 58, 55],
    // Step 4: some nodes overloaded
    [95, 98, 92, 70, 65, 62, 88, 92, 90, 65, 60, 58, 96, 95, 92, 65, 62, 60, 70, 68, 65, 60, 58, 55],
  ];

  const timeLabel = createRef<Txt>();
  view.add(<Txt ref={timeLabel} text={'t = 0:00'} x={350} y={-300} fontSize={22} fill={'#888888'} opacity={0} />);
  yield* timeLabel().opacity(1, 0.3);

  for (let step = 0; step < utilSnapshots.length; step++) {
    const snapshot = utilSnapshots[step];
    const anims = [];

    for (let i = 0; i < snapshot.length; i++) {
      anims.push(cells[i].fill(utilizationColor(snapshot[i]), 0.5));
    }

    yield* all(...anims);
    yield* timeLabel().text(`t = ${step}:00`, 0.1);
    yield* waitFor(0.8);
  }

  yield* waitFor(1.0);
});
```

**Render command:**

```bash
npx motion-canvas render
```

**Expected render time:** ~10-15 seconds.

**Gotchas:** The `Txt` children inside `Rect` showing percentages are hardcoded at `0%` in this version. To make them dynamic, create separate `Txt` refs and update their `text()` signal in the animation loop.

---

#### Recipe 3: CI/CD Pipeline Progression

**Concept:** Animate a CI/CD pipeline where stages progress from idle to running to complete, showing how a container image gets built, tested, and deployed. Useful for teaching [[docker-test-container-deep-dive|container build pipelines]] to HPC teams adopting DevOps practices.

```typescript
/**
 * CI/CD pipeline: stages animate from idle -> running -> complete.
 */
import {makeScene2D} from '@motion-canvas/2d';
import {Rect, Txt, Circle} from '@motion-canvas/2d/lib/components';
import {createRef, createRefArray} from '@motion-canvas/core/lib/utils';
import {all, chain, waitFor} from '@motion-canvas/core/lib/flow';
import {easeOutCubic} from '@motion-canvas/core/lib/tweening';

const IDLE_COLOR = '#555555';
const RUNNING_COLOR = '#f39c12';
const COMPLETE_COLOR = '#2ecc71';
const FAILED_COLOR = '#e74c3c';

export default makeScene2D(function* (view) {
  const title = createRef<Txt>();
  view.add(<Txt ref={title} text={'CI/CD Pipeline: HPC Container Build'} y={-320} fontSize={36} fill={'#ffffff'} opacity={0} />);
  yield* title().opacity(1, 0.4);

  const stages = [
    {name: 'Lint\nDockerfile', x: -400},
    {name: 'Build\nApptainer', x: -160},
    {name: 'Unit\nTests', x: 80},
    {name: 'Integration\nTests', x: 320},
    {name: 'Push to\nRegistry', x: 560},
  ];

  const stageRefs = createRefArray<Rect>();
  const statusDots = createRefArray<Circle>();
  const stageWidth = 140;
  const stageHeight = 90;

  // Draw pipeline stages
  for (let i = 0; i < stages.length; i++) {
    const s = stages[i];
    view.add(
      <Rect ref={stageRefs} x={s.x} y={0} width={stageWidth} height={stageHeight} radius={8} stroke={IDLE_COLOR} lineWidth={2} opacity={0}>
        <Txt text={s.name} fill={'#cccccc'} fontSize={16} textAlign={'center'} />
        <Circle ref={statusDots} x={0} y={55} width={16} height={16} fill={IDLE_COLOR} />
      </Rect>,
    );

    // Draw arrow between stages (except after the last one)
    if (i < stages.length - 1) {
      const nextX = stages[i + 1].x;
      view.add(
        <Rect x={(s.x + nextX) / 2} y={0} width={nextX - s.x - stageWidth - 10} height={2} fill={'#555555'} opacity={0} />,
      );
    }
  }

  // Fade in all stages
  yield* all(...stageRefs.map(s => s.opacity(1, 0.3)));
  yield* waitFor(0.5);

  // Animate each stage: idle -> running (yellow) -> complete (green)
  for (let i = 0; i < stages.length; i++) {
    // Running state
    yield* all(
      stageRefs[i].stroke(RUNNING_COLOR, 0.3),
      statusDots[i].fill(RUNNING_COLOR, 0.3),
    );
    yield* waitFor(0.6); // simulate work

    // Complete state
    yield* all(
      stageRefs[i].stroke(COMPLETE_COLOR, 0.3),
      statusDots[i].fill(COMPLETE_COLOR, 0.3),
    );
    yield* waitFor(0.2);
  }

  // Success banner
  const banner = createRef<Txt>();
  view.add(<Txt ref={banner} text={'Pipeline PASSED — image pushed to registry'} y={200} fontSize={26} fill={'#2ecc71'} opacity={0} />);
  yield* banner().opacity(1, 0.5);
  yield* waitFor(1.0);
});
```

**Render command:**

```bash
npx motion-canvas render
```

**Expected render time:** ~8-10 seconds.

**Gotchas:** The arrow connectors between stages are simplified as thin `Rect` elements. For proper arrowheads, use `Line` with `endArrow={true}` or draw SVG path arrows.

---

#### Recipe 4: Data Movement Across Cluster Fabric

**Concept:** Animate data flowing from parallel filesystem (storage) through the interconnect fabric to compute nodes and then to GPUs. This visualizes the I/O bottleneck that HPC users always ask about.

```typescript
/**
 * Data movement: Lustre storage -> InfiniBand fabric -> compute nodes -> GPUs.
 */
import {makeScene2D} from '@motion-canvas/2d';
import {Rect, Txt, Circle, Line} from '@motion-canvas/2d/lib/components';
import {createRef, createRefArray} from '@motion-canvas/core/lib/utils';
import {all, chain, waitFor, sequence} from '@motion-canvas/core/lib/flow';
import {easeOutCubic, easeInOutQuad} from '@motion-canvas/core/lib/tweening';

export default makeScene2D(function* (view) {
  const title = createRef<Txt>();
  view.add(<Txt ref={title} text={'Data Movement: Storage to GPU'} y={-350} fontSize={36} fill={'#ffffff'} opacity={0} />);
  yield* title().opacity(1, 0.4);

  // Layer labels
  const layers = [
    {name: 'Lustre /scratch', y: -200, color: '#3498db', width: 500},
    {name: 'InfiniBand Fabric', y: -50, color: '#9b59b6', width: 600},
    {name: 'Compute Nodes', y: 100, color: '#2ecc71', width: 600},
    {name: 'NVIDIA GPUs', y: 250, color: '#e74c3c', width: 500},
  ];

  const layerRefs = createRefArray<Rect>();

  for (const layer of layers) {
    view.add(
      <Rect ref={layerRefs} x={0} y={layer.y} width={layer.width} height={70} radius={10} stroke={layer.color} lineWidth={2} opacity={0}>
        <Txt text={layer.name} fill={layer.color} fontSize={22} />
      </Rect>,
    );
  }

  yield* all(...layerRefs.map(l => l.opacity(1, 0.3)));
  yield* waitFor(0.3);

  // Animate data packets flowing down through each layer
  const packetColors = ['#3498db', '#1abc9c', '#e67e22'];
  const packetLabels = ['Block A', 'Block B', 'Block C'];

  for (let p = 0; p < 3; p++) {
    const packet = createRef<Rect>();
    const xOffset = (p - 1) * 160;

    view.add(
      <Rect ref={packet} x={xOffset} y={-200} width={80} height={30} radius={15} fill={packetColors[p]} opacity={0}>
        <Txt text={packetLabels[p]} fill={'#ffffff'} fontSize={12} />
      </Rect>,
    );

    yield* packet().opacity(1, 0.15);

    // Flow through each layer
    for (let l = 1; l < layers.length; l++) {
      yield* packet().position.y(layers[l].y, 0.4, easeOutCubic);
      yield* waitFor(0.1);
    }

    yield* packet().opacity(0, 0.2);
  }

  // Bandwidth annotation
  const bwLabel = createRef<Txt>();
  view.add(
    <Txt ref={bwLabel} text={'Bottleneck: Lustre -> IB fabric (100 Gb/s per OST)'} y={350} fontSize={20} fill={'#f39c12'} opacity={0} />,
  );
  yield* bwLabel().opacity(1, 0.5);
  yield* waitFor(1.5);
});
```

**Render command:**

```bash
npx motion-canvas render
```

**Expected render time:** ~6-10 seconds.

**Gotchas:** The packet flow is sequential in this version. For a more realistic visualization, use `sequence()` with small delays to overlap packet movements.

---

## 5. matplotlib — Deep Section

### 5.1 Quickstart

```bash
mamba activate animate-mpl
```

Create `sacct_quick.py`:

```python
"""Quickstart: animated sacct throughput bar chart."""

from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np
from matplotlib.animation import FuncAnimation

rng = np.random.default_rng(42)
hours: np.ndarray = np.arange(0, 24)
n_frames: int = len(hours)
throughput: np.ndarray = rng.poisson(lam=50, size=n_frames) + np.sin(hours / 24 * 2 * np.pi) * 20

fig, ax = plt.subplots(figsize=(19.20, 10.80), dpi=100)
bar_container = ax.bar([], [], color="#3498db")
ax.set_xlim(-0.5, 23.5)
ax.set_ylim(0, int(throughput.max() * 1.3))
ax.set_xlabel("Hour of Day", fontsize=18)
ax.set_ylabel("Jobs Completed", fontsize=18)
ax.set_title("sacct: Cluster Throughput by Hour", fontsize=24)


def update(frame: int) -> list:
    ax.cla()
    ax.set_xlim(-0.5, 23.5)
    ax.set_ylim(0, int(throughput.max() * 1.3))
    ax.set_xlabel("Hour of Day", fontsize=18)
    ax.set_ylabel("Jobs Completed", fontsize=18)
    ax.set_title("sacct: Cluster Throughput by Hour", fontsize=24)
    bars = ax.bar(hours[: frame + 1], throughput[: frame + 1], color="#3498db")
    return list(bars)


anim = FuncAnimation(fig, update, frames=n_frames, interval=100)
output = Path("sacct_throughput_quick_1080p.mp4")
anim.save(str(output), writer="ffmpeg", fps=30, dpi=100, extra_args=["-pix_fmt", "yuv420p", "-crf", "18"])
print(f"Saved: {output}")
plt.close()
```

```bash
python sacct_quick.py
# Output: sacct_throughput_quick_1080p.mp4
```

### 5.2 Comprehensive Reference

#### Core Mental Model

`FuncAnimation` calls your `update()` function once per frame, passing the frame number. Inside `update()`, you modify the plot data. matplotlib redraws the changed artists and FFmpeg encodes the frame.

Two approaches:

1. **Artist update (fast, uses blit):** Create plot elements once, then update their data properties in `update()`. Requires `blit=True` and returning the list of changed artists.

2. **Clear and redraw (simple, no blit):** Call `ax.cla()` inside `update()` and rebuild the entire plot. Slower but easier to get right for complex layouts.

For HPC animations with <200 frames, the clear-and-redraw approach is fine. For 500+ frames, use artist update with blit.

#### Resolution Setup

Always compute `figsize` from your target resolution:

```python
target_width: int = 1920  # pixels
target_height: int = 1080
dpi: int = 100

fig, ax = plt.subplots(
    figsize=(target_width / dpi, target_height / dpi),
    dpi=dpi,
)
```

For preview renders, use `854 x 480` at `dpi=100` with `fps=15`.

#### Saving with Correct Codec

Always pass yuv420p explicitly:

```python
anim.save(
    "output.mp4",
    writer="ffmpeg",
    fps=30,
    dpi=100,
    extra_args=["-vcodec", "libx264", "-pix_fmt", "yuv420p", "-crf", "18"],
)
```

The `-crf 18` setting gives excellent quality at reasonable file size (typically 2-10 MB for a 10-second 1080p clip).

#### Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `MovieWriter ffmpeg unavailable` | FFmpeg not installed | `mamba install ffmpeg` |
| Choppy animation | Too few frames or wrong fps | Set `frames` to `duration_seconds * fps` |
| Huge file size | CRF too low or resolution too high | Use `-crf 23` for smaller files |
| Blurry when projected | Wrong figsize/dpi combo | Verify `figsize * dpi = target resolution` |
| Axes labels cut off | `tight_layout` not called | Add `fig.tight_layout()` before animating |

#### Performance Tips

- Pre-compute all data before calling `FuncAnimation`. Never do I/O or heavy computation inside `update()`.
- Use `numpy` vectorized operations for data generation.
- For very long animations (>500 frames), consider rendering at 15fps and using FFmpeg to interpolate to 30fps:

```bash
ffmpeg -i input_15fps.mp4 -filter:v "minterpolate=fps=30" -pix_fmt yuv420p output_30fps.mp4
```

### 5.3 Recipe Book

#### Recipe 1: Animated sacct Throughput Plot

**Concept:** A stacked area chart showing job throughput from synthetic sacct data, broken down by job state (COMPLETED, FAILED, TIMEOUT). This is the chart you show when explaining SLA compliance or cluster health.

```python
"""Animated sacct throughput: stacked area chart by job exit state."""

from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np
from matplotlib.animation import FuncAnimation

# --- Synthetic sacct data ---
rng = np.random.default_rng(42)
hours: np.ndarray = np.arange(0, 48)  # 48 hours of data
n_frames: int = len(hours)

# Job counts per hour by exit state
completed: np.ndarray = rng.poisson(lam=80, size=n_frames) + np.clip(
    np.sin(hours / 24 * 2 * np.pi) * 30, -20, 30
).astype(int)
failed: np.ndarray = rng.poisson(lam=5, size=n_frames)
timeout: np.ndarray = rng.poisson(lam=3, size=n_frames)

# Inject a failure spike at hour 18 (simulating a bad node)
failed[16:22] = rng.poisson(lam=25, size=6)

# --- Build animation ---
fig, ax = plt.subplots(figsize=(19.20, 10.80), dpi=100)
fig.tight_layout(pad=3.0)

y_max: int = int((completed + failed + timeout).max() * 1.2)


def update(frame: int) -> list:
    """Draw stacked area up to current frame."""
    ax.cla()
    ax.set_xlim(0, 47)
    ax.set_ylim(0, y_max)
    ax.set_xlabel("Hours Since Epoch", fontsize=18)
    ax.set_ylabel("Jobs / Hour", fontsize=18)
    ax.set_title("sacct Throughput by Exit State", fontsize=24)
    ax.tick_params(labelsize=14)

    x = hours[: frame + 1]
    ax.fill_between(x, 0, completed[: frame + 1], alpha=0.7, color="#2ecc71", label="COMPLETED")
    ax.fill_between(
        x, completed[: frame + 1],
        completed[: frame + 1] + failed[: frame + 1],
        alpha=0.7, color="#e74c3c", label="FAILED",
    )
    ax.fill_between(
        x,
        completed[: frame + 1] + failed[: frame + 1],
        completed[: frame + 1] + failed[: frame + 1] + timeout[: frame + 1],
        alpha=0.7, color="#f39c12", label="TIMEOUT",
    )

    if frame > 0:
        ax.legend(fontsize=14, loc="upper right")

    timestamp = ax.text(
        0.02, 0.95, f"Hour {hours[frame]}", transform=ax.transAxes,
        fontsize=16, color="gray", va="top",
    )
    return []


anim = FuncAnimation(fig, update, frames=n_frames, interval=100)
output_path = Path("sacct_throughput_stacked_1080p.mp4")
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

**Render command:**

```bash
python sacct_throughput.py
```

**Expected render time:** ~3-5 seconds.

**Gotchas:** The failure spike at hour 18 is intentional — it creates a visual story ("what happened here?") that makes the animation useful as a teaching moment. Without narrative spikes, data animations are boring.

---

#### Recipe 2: Cluster Utilization Heatmap Timeline

**Concept:** A 2D heatmap grid (nodes x time) colored by CPU or memory utilization, revealing patterns like diurnal load cycles or hotspot nodes. This replaces the static Ganglia/Grafana screenshot with something that shows temporal dynamics.

```python
"""Animated cluster utilization heatmap: node x time grid."""

from pathlib import Path

import matplotlib.pyplot as plt
import matplotlib.colors as mcolors
import numpy as np
from matplotlib.animation import FuncAnimation

# --- Synthetic cluster data ---
rng = np.random.default_rng(99)
n_nodes: int = 16
n_timesteps: int = 60  # each frame adds one column to the heatmap
node_labels: list[str] = [f"node{i:02d}" for i in range(n_nodes)]

# Generate utilization matrix: (n_nodes, n_timesteps)
# Base pattern: diurnal cycle with some hotspot nodes
utilization: np.ndarray = np.zeros((n_nodes, n_timesteps))
for t in range(n_timesteps):
    base = 40 + 30 * np.sin(t / n_timesteps * 2 * np.pi)
    utilization[:, t] = np.clip(base + rng.normal(0, 15, n_nodes), 0, 100)

# Inject hotspot on nodes 3-5 from timestep 20 onward
utilization[3:6, 20:] = np.clip(90 + rng.normal(0, 5, (3, n_timesteps - 20)), 80, 100)

# Custom colormap: green -> yellow -> red
cmap = mcolors.LinearSegmentedColormap.from_list(
    "cluster_util", ["#2ecc71", "#f1c40f", "#e74c3c"]
)

# --- Build animation ---
fig, ax = plt.subplots(figsize=(19.20, 10.80), dpi=100)
fig.tight_layout(pad=3.0)


def update(frame: int) -> list:
    """Show heatmap up to current timestep."""
    ax.cla()
    visible = frame + 1
    data = utilization[:, :visible]

    im = ax.imshow(
        data, aspect="auto", cmap=cmap, vmin=0, vmax=100,
        interpolation="nearest",
    )
    ax.set_yticks(range(n_nodes))
    ax.set_yticklabels(node_labels, fontsize=12)
    ax.set_xlabel("Time Step", fontsize=18)
    ax.set_ylabel("Node", fontsize=18)
    ax.set_title("Cluster CPU Utilization Heatmap", fontsize=24)
    ax.tick_params(axis="x", labelsize=14)

    # Add colorbar only on first frame (it persists across frames with cla)
    if frame == 0:
        cbar = fig.colorbar(im, ax=ax, label="CPU %", shrink=0.8)
        cbar.ax.tick_params(labelsize=12)

    return []


anim = FuncAnimation(fig, update, frames=n_timesteps, interval=80)
output_path = Path("cluster_heatmap_timeline_1080p.mp4")
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

**Render command:**

```bash
python cluster_heatmap.py
```

**Expected render time:** ~5-8 seconds.

**Gotchas:** The colorbar gets redrawn every frame with `ax.cla()`. For cleaner output, create the colorbar on a separate axis that is not cleared, or accept the slight flicker.

---

#### Recipe 3: I/O Bandwidth Across Benchmark Run

**Concept:** Animated line chart showing read/write bandwidth during a synthetic IOR benchmark, revealing phases of sequential write, sequential read, and the performance cliff at high process counts.

```python
"""Animated I/O bandwidth chart from synthetic IOR benchmark data."""

from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np
from matplotlib.animation import FuncAnimation

# --- Synthetic IOR data ---
rng = np.random.default_rng(77)
n_samples: int = 120
time_seconds: np.ndarray = np.arange(n_samples)

# Phase 1 (0-40): Sequential write — high bandwidth, slight ramp
# Phase 2 (40-80): Sequential read — higher bandwidth
# Phase 3 (80-120): Random I/O — much lower, noisy
write_bw: np.ndarray = np.zeros(n_samples)
read_bw: np.ndarray = np.zeros(n_samples)

# Sequential write phase
write_bw[:40] = 8.0 + np.linspace(0, 2, 40) + rng.normal(0, 0.5, 40)
read_bw[:40] = 0.1 + rng.normal(0, 0.05, 40)

# Sequential read phase
write_bw[40:80] = 0.2 + rng.normal(0, 0.1, 40)
read_bw[40:80] = 12.0 + np.linspace(0, -1, 40) + rng.normal(0, 0.8, 40)

# Random I/O phase
write_bw[80:] = 1.5 + rng.normal(0, 0.8, 40)
read_bw[80:] = 2.0 + rng.normal(0, 1.0, 40)

write_bw = np.clip(write_bw, 0, 20)
read_bw = np.clip(read_bw, 0, 20)

# --- Build animation ---
fig, ax = plt.subplots(figsize=(19.20, 10.80), dpi=100)
fig.tight_layout(pad=3.0)

# Phase annotations
phases: list[tuple[int, int, str, str]] = [
    (0, 40, "Sequential Write", "#e74c3c"),
    (40, 80, "Sequential Read", "#3498db"),
    (80, 120, "Random I/O", "#9b59b6"),
]


def update(frame: int) -> list:
    """Draw bandwidth lines up to current time."""
    ax.cla()
    ax.set_xlim(0, n_samples)
    ax.set_ylim(0, 16)
    ax.set_xlabel("Time (seconds)", fontsize=18)
    ax.set_ylabel("Bandwidth (GB/s)", fontsize=18)
    ax.set_title("IOR Benchmark: I/O Bandwidth Over Time", fontsize=24)
    ax.tick_params(labelsize=14)

    t = time_seconds[: frame + 1]
    ax.plot(t, write_bw[: frame + 1], color="#e74c3c", linewidth=2.5, label="Write BW")
    ax.plot(t, read_bw[: frame + 1], color="#3498db", linewidth=2.5, label="Read BW")
    ax.legend(fontsize=14, loc="upper right")

    # Show phase label for current phase
    for start, end, name, color in phases:
        if start <= frame < end:
            ax.axvspan(start, min(frame + 1, end), alpha=0.1, color=color)
            ax.text(
                (start + min(frame + 1, end)) / 2, 15, name,
                fontsize=16, color=color, ha="center", va="top",
            )
        elif frame >= end:
            ax.axvspan(start, end, alpha=0.05, color=color)

    return []


anim = FuncAnimation(fig, update, frames=n_samples, interval=50)
output_path = Path("ior_bandwidth_1080p.mp4")
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

**Render command:**

```bash
python ior_bandwidth.py
```

**Expected render time:** ~4-7 seconds.

**Gotchas:** The phase transition at samples 40 and 80 is abrupt. For a smoother visual, add 2-3 transition frames where bandwidth ramps down/up using `np.linspace`.

---

#### Recipe 4: Queue Wait-Time Distribution Comparison

**Concept:** Animated histograms showing wait-time distributions across Slurm partitions. Each partition's histogram builds up over time, allowing visual comparison of how different partitions serve jobs. This is the animation you show when advocating for fair-share policy changes.

```python
"""Animated queue wait-time histograms comparing Slurm partitions."""

from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np
from matplotlib.animation import FuncAnimation

# --- Synthetic wait-time data per partition ---
rng = np.random.default_rng(55)

partitions: dict[str, dict] = {
    "gpu": {
        "color": "#e74c3c",
        "wait_times": np.clip(rng.exponential(scale=45, size=500), 0, 300),
    },
    "cpu": {
        "color": "#3498db",
        "wait_times": np.clip(rng.exponential(scale=10, size=800), 0, 120),
    },
    "highmem": {
        "color": "#2ecc71",
        "wait_times": np.clip(rng.exponential(scale=25, size=300), 0, 200),
    },
    "debug": {
        "color": "#f39c12",
        "wait_times": np.clip(rng.exponential(scale=2, size=200), 0, 30),
    },
}

bins: np.ndarray = np.linspace(0, 300, 40)
n_frames: int = 60  # build up over 60 frames

fig, axes = plt.subplots(2, 2, figsize=(19.20, 10.80), dpi=100)
fig.suptitle("Queue Wait-Time Distribution by Partition", fontsize=26, y=0.98)
fig.tight_layout(pad=4.0, rect=[0, 0, 1, 0.95])

partition_list = list(partitions.items())


def update(frame: int) -> list:
    """Progressively reveal histogram data."""
    fraction = (frame + 1) / n_frames  # 0.0 to 1.0

    for idx, (name, data) in enumerate(partition_list):
        ax = axes[idx // 2][idx % 2]
        ax.cla()

        n_samples = int(len(data["wait_times"]) * fraction)
        subset = data["wait_times"][:n_samples]

        ax.hist(subset, bins=bins, color=data["color"], alpha=0.75, edgecolor="white")
        ax.set_xlim(0, 300)
        ax.set_ylim(0, 60)
        ax.set_xlabel("Wait Time (minutes)", fontsize=14)
        ax.set_ylabel("Job Count", fontsize=14)
        ax.set_title(f"{name} partition (n={n_samples})", fontsize=18)
        ax.tick_params(labelsize=12)

        if n_samples > 0:
            median = np.median(subset)
            ax.axvline(median, color="white", linestyle="--", linewidth=2)
            ax.text(
                median + 5, 55, f"median={median:.0f}m",
                fontsize=12, color="white", va="top",
            )

    return []


anim = FuncAnimation(fig, update, frames=n_frames, interval=80)
output_path = Path("queue_wait_times_1080p.mp4")
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

**Render command:**

```bash
python queue_wait_times.py
```

**Expected render time:** ~5-8 seconds.

**Gotchas:** The y-axis limit of 60 is tuned for this synthetic data. With real sacct data, compute the actual max bin count first and add 20% headroom.

---

## 6. Side-by-Side Comparison: Slurm Job Lifecycle in All Three Tools

To help you choose, here is the same animation — Slurm job lifecycle state machine (PENDING → RUNNING → COMPLETED) — implemented in all three tools.

### Manim Version

```python
"""Side-by-side comparison: Slurm lifecycle in Manim."""

from manim import *


class SlurmLifecycleManim(Scene):
    def construct(self) -> None:
        states = [("PENDING", YELLOW), ("RUNNING", GREEN), ("COMPLETED", BLUE)]
        boxes = []
        for i, (name, color) in enumerate(states):
            box = RoundedRectangle(corner_radius=0.15, width=3.5, height=1.2, color=color, fill_opacity=0.15)
            label = Text(name, font_size=30, color=color)
            group = VGroup(box, label).move_to(RIGHT * (i - 1) * 4.5)
            boxes.append(group)

        self.play(*[FadeIn(b) for b in boxes])
        for i in range(len(boxes) - 1):
            arrow = Arrow(boxes[i].get_right(), boxes[i + 1].get_left(), buff=0.2, color=WHITE)
            self.play(GrowArrow(arrow), run_time=0.5)

        highlight = SurroundingRectangle(boxes[0], color=YELLOW, buff=0.1, stroke_width=3)
        self.play(Create(highlight))
        for i, (_, color) in enumerate(states[1:], 1):
            self.play(highlight.animate.move_to(boxes[i]).set_color(color), run_time=0.6)
        self.wait(1)
```

**Lines of code:** 20. **Render time:** ~4s. **Visual:** Clean vector graphics, precise positioning.

### Motion Canvas Version

```typescript
/**
 * Side-by-side comparison: Slurm lifecycle in Motion Canvas.
 */
import {makeScene2D} from '@motion-canvas/2d';
import {Rect, Txt, Line} from '@motion-canvas/2d/lib/components';
import {createRef, createRefArray} from '@motion-canvas/core/lib/utils';
import {all, waitFor} from '@motion-canvas/core/lib/flow';
import {easeOutCubic} from '@motion-canvas/core/lib/tweening';

export default makeScene2D(function* (view) {
  const states = [
    {name: 'PENDING', color: '#f1c40f', x: -400},
    {name: 'RUNNING', color: '#2ecc71', x: 0},
    {name: 'COMPLETED', color: '#3498db', x: 400},
  ];

  const boxes = createRefArray<Rect>();

  for (const s of states) {
    view.add(
      <Rect ref={boxes} x={s.x} y={0} width={250} height={80} radius={10}
            stroke={s.color} lineWidth={3} opacity={0}>
        <Txt text={s.name} fill={s.color} fontSize={28} />
      </Rect>,
    );
  }

  yield* all(...boxes.map(b => b.opacity(1, 0.4)));

  // Arrows (simplified as lines)
  for (let i = 0; i < states.length - 1; i++) {
    const arrow = createRef<Line>();
    view.add(
      <Line ref={arrow}
            points={[[states[i].x + 130, 0], [states[i + 1].x - 130, 0]]}
            stroke={'#ffffff'} lineWidth={2} endArrow opacity={0} />,
    );
    yield* arrow().opacity(1, 0.3);
  }

  // Highlight traversal
  const highlight = createRef<Rect>();
  view.add(
    <Rect ref={highlight} x={states[0].x} y={0} width={270} height={100}
          radius={12} stroke={'#f1c40f'} lineWidth={3} opacity={0} />,
  );
  yield* highlight().opacity(1, 0.3);

  for (let i = 1; i < states.length; i++) {
    yield* all(
      highlight().position.x(states[i].x, 0.5, easeOutCubic),
      highlight().stroke(states[i].color, 0.5),
    );
    yield* waitFor(0.3);
  }

  yield* waitFor(1.0);
});
```

**Lines of code:** 42. **Render time:** ~6s. **Visual:** Smooth easing, polished feel.

### matplotlib Version

```python
"""Side-by-side comparison: Slurm lifecycle in matplotlib."""

from pathlib import Path

import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
from matplotlib.animation import FuncAnimation

states: list[tuple[str, str, float]] = [
    ("PENDING", "#f1c40f", 0.15),
    ("RUNNING", "#2ecc71", 0.45),
    ("COMPLETED", "#3498db", 0.75),
]

fig, ax = plt.subplots(figsize=(19.20, 10.80), dpi=100)
ax.set_xlim(0, 1)
ax.set_ylim(0, 1)
ax.axis("off")
ax.set_title("Slurm Job Lifecycle", fontsize=30, pad=20)

n_frames: int = 90
phase_frames: int = 30  # frames per state


def update(frame: int) -> list:
    """Progressively reveal states and highlight the active one."""
    ax.cla()
    ax.set_xlim(0, 1)
    ax.set_ylim(0, 1)
    ax.axis("off")
    ax.set_title("Slurm Job Lifecycle", fontsize=30, pad=20)

    active_state: int = min(frame // phase_frames, len(states) - 1)

    for i, (name, color, x) in enumerate(states):
        if frame >= i * 10:  # staggered appearance
            alpha = 1.0 if i <= active_state else 0.3
            lw = 4 if i == active_state else 2
            box = mpatches.FancyBboxPatch(
                (x - 0.08, 0.4), 0.16, 0.12,
                boxstyle="round,pad=0.02",
                facecolor=color, alpha=alpha * 0.3,
                edgecolor=color, linewidth=lw,
            )
            ax.add_patch(box)
            ax.text(x, 0.46, name, ha="center", va="center", fontsize=22, color=color, alpha=alpha)

    # Arrows
    for i in range(len(states) - 1):
        if frame >= (i + 1) * 10:
            ax.annotate(
                "", xy=(states[i + 1][2] - 0.09, 0.46),
                xytext=(states[i][2] + 0.09, 0.46),
                arrowprops=dict(arrowstyle="->", color="white", lw=2),
            )

    return []


anim = FuncAnimation(fig, update, frames=n_frames, interval=33)
output_path = Path("slurm_lifecycle_mpl_1080p.mp4")
anim.save(
    str(output_path), writer="ffmpeg", fps=30, dpi=100,
    extra_args=["-pix_fmt", "yuv420p", "-crf", "18"],
)
plt.close()
```

**Lines of code:** 52. **Render time:** ~3s. **Visual:** Functional but less polished — matplotlib is not designed for geometric animation.

### Comparison Summary

| Metric | Manim | Motion Canvas | matplotlib |
|--------|-------|---------------|------------|
| Lines of code | 20 | 42 | 52 |
| Render time | ~4s | ~6s | ~3s |
| Visual polish | High | Highest | Adequate |
| PPT embedding | Re-encode needed | Ready | Ready |
| Data-driven capability | Manual | Manual | Native |

**Verdict for this animation:** Manim wins for state machine diagrams — fewest lines, cleanest output, best geometric primitives. Use matplotlib only when the states are derived from data.

---

## 7. Workflow Integration

### 7.1 Snakemake Rule for Animation Regeneration

If your talk data changes (new cluster metrics, updated sacct output), you want animations to regenerate automatically. A Snakemake rule makes this reproducible:

```python
# Snakefile
rule render_sacct_animation:
    input:
        script="scenes/sacct_throughput.py",
        data="data/sacct_export.csv",
    output:
        "output/sacct_throughput_stacked_1080p.mp4",
    conda:
        "environment-mpl.yml"
    shell:
        """
        python {input.script} --data {input.data} --output {output}
        """


rule render_manim_scene:
    input:
        script="scenes/slurm_lifecycle.py",
    output:
        "output/slurm_full_lifecycle_1080p.mp4",
    conda:
        "environment-manim.yml"
    shell:
        """
        manim render -qh {input.script} SlurmFullLifecycle
        ffmpeg -y -i media/videos/slurm_lifecycle/1080p30/SlurmFullLifecycle.mp4 \
          -c:v libx264 -pix_fmt yuv420p -crf 18 -preset slow {output}
        """


rule all_animations:
    input:
        "output/sacct_throughput_stacked_1080p.mp4",
        "output/slurm_full_lifecycle_1080p.mp4",
```

### 7.2 Apptainer Containerization

Manim has the most complex dependencies (Cairo, Pango, GLib). Containerizing the render environment eliminates "works on my laptop" problems. See the [[isaaclab-metagrasp-apptainer-hpc-beginner-guide|Apptainer HPC guide]] for the general pattern; here is a Manim-specific definition:

```
Bootstrap: docker
From: condaforge/miniforge3:latest

%post
    mamba install -y -n base -c conda-forge manim ffmpeg texlive-core
    mamba clean -afy

%runscript
    exec manim "$@"

%labels
    Author HPC-Animation-Toolkit
    Version 1.0
```

Build and render:

```bash
apptainer build manim.sif manim.def
apptainer run manim.sif render -qh scenes/slurm_lifecycle.py SlurmFullLifecycle
```

### 7.3 Makefile / render-all.sh Pattern

For simpler projects without Snakemake, a [[just-beginner-guide|Justfile]] or shell script works:

```bash
#!/usr/bin/env bash
# render_all.sh — render all animations for the talk
set -euo pipefail

MANIM_ENV="animate-manim"
MPL_ENV="animate-mpl"
OUTPUT_DIR="output"
mkdir -p "$OUTPUT_DIR"

echo "=== Rendering Manim scenes ==="
mamba run -n "$MANIM_ENV" manim render -qh scenes/slurm_lifecycle.py SlurmFullLifecycle
ffmpeg -y -i media/videos/slurm_lifecycle/1080p30/SlurmFullLifecycle.mp4 \
  -c:v libx264 -pix_fmt yuv420p -crf 18 -preset slow \
  "$OUTPUT_DIR/slurm_full_lifecycle_1080p.mp4"

mamba run -n "$MANIM_ENV" manim render -qh scenes/workflow_dag.py WorkflowDAGReveal
ffmpeg -y -i media/videos/workflow_dag/1080p30/WorkflowDAGReveal.mp4 \
  -c:v libx264 -pix_fmt yuv420p -crf 18 -preset slow \
  "$OUTPUT_DIR/workflow_dag_reveal_1080p.mp4"

echo "=== Rendering matplotlib scenes ==="
mamba run -n "$MPL_ENV" python scenes/sacct_throughput.py
mv sacct_throughput_stacked_1080p.mp4 "$OUTPUT_DIR/"

mamba run -n "$MPL_ENV" python scenes/cluster_heatmap.py
mv cluster_heatmap_timeline_1080p.mp4 "$OUTPUT_DIR/"

echo "=== Rendering Motion Canvas ==="
cd motion-canvas-project
npx motion-canvas render
cp output/project.mp4 "../$OUTPUT_DIR/slurm_queue_dynamics_1080p.mp4"
cd ..

echo "=== All renders complete ==="
ls -lh "$OUTPUT_DIR"/*.mp4
```

Alternatively, as a [[just-deep-dive|Justfile]]:

```just
# justfile for animation rendering

output_dir := "output"

# Render all animations
all: manim-scenes mpl-scenes mc-scenes
    @echo "All renders complete"
    @ls -lh {{output_dir}}/*.mp4

# Render Manim scenes
manim-scenes:
    mkdir -p {{output_dir}}
    mamba run -n animate-manim manim render -qh scenes/slurm_lifecycle.py SlurmFullLifecycle
    ffmpeg -y -i media/videos/slurm_lifecycle/1080p30/SlurmFullLifecycle.mp4 \
      -c:v libx264 -pix_fmt yuv420p -crf 18 -preset slow \
      {{output_dir}}/slurm_full_lifecycle_1080p.mp4

# Render matplotlib scenes
mpl-scenes:
    mkdir -p {{output_dir}}
    mamba run -n animate-mpl python scenes/sacct_throughput.py
    mv sacct_throughput_stacked_1080p.mp4 {{output_dir}}/

# Render Motion Canvas scenes
mc-scenes:
    mkdir -p {{output_dir}}
    cd motion-canvas-project && npx motion-canvas render
    cp motion-canvas-project/output/project.mp4 {{output_dir}}/slurm_queue_dynamics_1080p.mp4

# Preview (low quality, fast)
preview scene:
    mamba run -n animate-manim manim render -ql scenes/{{scene}}.py

# Clean rendered output
clean:
    rm -rf media/ {{output_dir}}/ motion-canvas-project/output/
```

### 7.4 Git Hygiene

**Commit:** Source scripts, environment files, Justfile/Snakefile, `project.ts`, `package.json`.

**Gitignore:** Rendered media (`media/`, `output/`, `*.mp4`), node_modules, `__pycache__`.

```gitignore
# .gitignore for animation projects
media/
output/
*.mp4
node_modules/
__pycache__/
*.pyc
.DS_Store
```

MP4 files are binary blobs that do not diff well. Store them in a shared drive or use `git-lfs` if you must version them.

---

## 8. PowerPoint Embedding Cheatsheet

### Insert Video

1. Open PowerPoint, navigate to the slide where the animation should appear
2. **Insert → Video → This Device** (Windows) or **Insert → Video → Movie from File** (macOS)
3. Select your yuv420p-encoded MP4 file
4. Resize the video frame to fill the slide (or a portion of it)

### Playback Settings

In the **Playback** tab (appears when the video is selected):

| Setting | Recommended Value | Why |
|---------|-------------------|-----|
| **Start** | Automatically | Animation plays when slide advances |
| **Loop until stopped** | Check for ambient/background animations | Useful for title slides |
| **Rewind after playing** | Check | Returns to first frame when done |
| **Hide while not playing** | Uncheck | Shows first frame as a static preview |

### Aspect Ratio

Your animations are 16:9 (1920x1080). PowerPoint slides are also 16:9 by default. If you see black bars, right-click the video → **Size and Position** → set width to slide width and aspect ratio lock.

### File Size Targets

| Duration | Target Size | CRF Setting |
|----------|-------------|-------------|
| < 5 seconds | < 2 MB | 23 |
| 5-15 seconds | < 8 MB | 18 |
| 15-30 seconds | < 15 MB | 18 |
| > 30 seconds | < 25 MB | 20 |

PowerPoint embeds the video file inside the .pptx. Keep individual videos under 25 MB to avoid slow file transfers. Total .pptx with all videos should stay under 100 MB.

### GIF Fallback for Short Clips

For clips under 5 seconds, an animated GIF can be simpler (no playback controls, auto-loops):

```bash
ffmpeg -i short_clip.mp4 -vf "fps=15,scale=960:-1" -loop 0 short_clip.gif
```

Insert via **Insert → Picture**. GIFs auto-play in slideshow mode. Downside: GIF files are much larger than MP4 for the same content and quality is lower.

---

## 9. When NOT to Use Animation

Animation is a powerful communication tool, but it is not always the right choice. Overusing animation makes you the speaker who "spent more time on effects than content."

**Use a static PNG when:** The diagram is simple enough to understand at a glance. A Slurm architecture overview with 5 labeled boxes does not need animation. Export a single frame from Manim with `self.wait(0); manim render -s` (the `-s` flag saves a PNG of the last frame).

**Use a live demo when:** You are walking through code or a terminal session. Switching to a pre-rendered video of a terminal breaks the "this is happening right now" feel. Use `tmux` or `asciinema` for terminal recordings instead.

**Do not animate when the audience is reading.** If your slide has a paragraph of text that people need to read, adding a moving animation next to it splits attention and slows comprehension. Animation works best on slides with minimal text.

**Time budget:** A 30-minute talk should have at most 4-6 animations totaling 60-90 seconds of video. More than that, and the medium becomes the message.

---

## 10. Recreating Existing Videos as Code-Based Animations

Sometimes you have a screen recording of a Grafana dashboard, a Slurm terminal session, or a live demo that you want to convert into a cleaner, repeatable animation. This section covers the pipeline for that conversion.

### 10.1 Pipeline Pattern

```
Source Video → Frame Extraction → CV/OCR/Tracking → CSV/JSON → Animation Script → MP4
  (screen        (ffmpeg)         (OpenCV,           (structured    (Manim,          (embed
   recording)                      Tesseract)          data)         matplotlib)       in PPT)
```

The key insight is that you are not trying to "convert" the video — you are extracting the *data* from it and re-animating from data.

### 10.2 Extraction Backend Matrix

| Source Video Type | Extraction Tool | Output Format | Best Animation Tool |
|-------------------|-----------------|---------------|---------------------|
| Grafana dashboard recording | OpenCV + Tesseract OCR | CSV of metric values over time | matplotlib |
| Terminal session (sacct, squeue output) | Tesseract OCR on frames | Text lines per frame | matplotlib or Manim |
| Architecture diagram walkthrough | Manual frame selection + tracing | Node/edge list (JSON) | Manim |
| Animated chart (from another tool) | OpenCV color tracking | Data series as CSV | matplotlib |
| Live coding demo | asciinema (re-record, don't extract) | asciicast v2 | N/A (keep as terminal) |

### 10.3 Recipe A: Slurm Dashboard Recreation with matplotlib

**Scenario:** You have a 30-second screen recording of a Grafana dashboard showing cluster CPU utilization. You want to recreate it as a clean matplotlib animation.

```python
"""
Recipe A: Extract data from Grafana dashboard recording and recreate as matplotlib animation.

Step 1: Extract frames from source video.
Step 2: OCR the metric values from each frame.
Step 3: Build a clean animation from the extracted data.

This example uses synthetic data to simulate what OCR would produce.
"""

from pathlib import Path

import numpy as np
import matplotlib.pyplot as plt
from matplotlib.animation import FuncAnimation

# --- Step 1 & 2: Frame extraction and OCR ---
# In practice, you would run:
#   ffmpeg -i grafana_recording.mp4 -vf "fps=1" frames/frame_%04d.png
# Then OCR each frame with pytesseract to extract the metric value.
#
# For this recipe, we simulate the OCR output:

rng = np.random.default_rng(42)
n_extracted_points: int = 30  # one per second of source video
timestamps: np.ndarray = np.arange(n_extracted_points)

# Simulated OCR-extracted CPU utilization values (with realistic OCR noise)
raw_ocr_values: list[float] = []
base_value: float = 45.0
for i in range(n_extracted_points):
    base_value += rng.normal(0.5, 2.0)
    base_value = np.clip(base_value, 10, 95)
    # Simulate OCR error: occasionally misread a digit
    if rng.random() < 0.05:
        raw_ocr_values.append(base_value + rng.choice([-10, 10]))
    else:
        raw_ocr_values.append(base_value)

ocr_values: np.ndarray = np.array(raw_ocr_values)

# --- Step 2.5: Clean the OCR data ---
# Simple median filter to remove OCR misreads
from scipy.ndimage import median_filter

try:
    cleaned_values: np.ndarray = median_filter(ocr_values, size=3)
except ImportError:
    # scipy not available — fallback to raw values
    cleaned_values = ocr_values

# --- Step 3: Build the animation ---
fig, (ax_raw, ax_clean) = plt.subplots(1, 2, figsize=(19.20, 10.80), dpi=100)
fig.suptitle("Dashboard Recreation: Raw OCR vs Cleaned Animation", fontsize=26, y=0.98)
fig.tight_layout(pad=4.0, rect=[0, 0, 1, 0.93])


def update(frame: int) -> list:
    """Build both plots incrementally."""
    # Left: raw OCR values
    ax_raw.cla()
    ax_raw.set_xlim(0, n_extracted_points)
    ax_raw.set_ylim(0, 100)
    ax_raw.set_xlabel("Time (seconds from recording)", fontsize=16)
    ax_raw.set_ylabel("CPU %", fontsize=16)
    ax_raw.set_title("Raw OCR Extraction", fontsize=20)
    ax_raw.plot(
        timestamps[: frame + 1], ocr_values[: frame + 1],
        "o-", color="#e74c3c", markersize=4, linewidth=1.5,
    )

    # Right: cleaned and smoothed
    ax_clean.cla()
    ax_clean.set_xlim(0, n_extracted_points)
    ax_clean.set_ylim(0, 100)
    ax_clean.set_xlabel("Time (seconds)", fontsize=16)
    ax_clean.set_ylabel("CPU %", fontsize=16)
    ax_clean.set_title("Cleaned Animation Data", fontsize=20)
    ax_clean.fill_between(
        timestamps[: frame + 1], 0, cleaned_values[: frame + 1],
        alpha=0.4, color="#3498db",
    )
    ax_clean.plot(
        timestamps[: frame + 1], cleaned_values[: frame + 1],
        color="#3498db", linewidth=2.5,
    )
    ax_clean.axhline(y=80, color="#e74c3c", linestyle="--", alpha=0.5, label="Alert threshold")
    if frame > 0:
        ax_clean.legend(fontsize=12)

    return []


anim = FuncAnimation(fig, update, frames=n_extracted_points, interval=100)
output_path = Path("dashboard_recreation_1080p.mp4")
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

**Render command:**

```bash
python dashboard_recreation.py
```

**Expected render time:** ~3-5 seconds.

### 10.4 Recipe B: Architecture Diagram Remake with Manim

**Scenario:** You have a video of someone drawing an HPC cluster architecture on a whiteboard (or revealing it in slides). You want to recreate it as a clean vector animation.

```python
"""
Recipe B: Recreate an architecture diagram from video frames using Manim.

Step 1: Extract key frames from the source video.
Step 2: Identify components and their spatial relationships (manual or CV-assisted).
Step 3: Rebuild as a Manim scene with clean vector graphics.

The component list below simulates what you'd extract from a whiteboard video.
"""

from manim import *


class ClusterArchitectureRemake(Scene):
    def construct(self) -> None:
        title = Text("HPC Cluster Architecture", font_size=36).to_edge(UP, buff=0.3)
        subtitle = Text(
            "(recreated from whiteboard recording)", font_size=18, color=GRAY
        ).next_to(title, DOWN, buff=0.1)
        self.play(Write(title), FadeIn(subtitle), run_time=0.6)

        # --- Components extracted from source video ---
        # Login nodes
        login_box = RoundedRectangle(
            corner_radius=0.1, width=2.5, height=0.8,
            color="#3498db", fill_opacity=0.2,
        ).move_to(LEFT * 4.5 + UP * 1.5)
        login_label = Text("Login Nodes", font_size=16, color="#3498db").move_to(login_box)
        login = VGroup(login_box, login_label)

        # Head node / slurmctld
        head_box = RoundedRectangle(
            corner_radius=0.1, width=2.5, height=0.8,
            color="#e67e22", fill_opacity=0.2,
        ).move_to(LEFT * 1.5 + UP * 1.5)
        head_label = Text("slurmctld", font_size=16, color="#e67e22").move_to(head_box)
        head = VGroup(head_box, head_label)

        # Compute partition
        compute_box = RoundedRectangle(
            corner_radius=0.1, width=4.0, height=1.5,
            color="#2ecc71", fill_opacity=0.1,
        ).move_to(RIGHT * 2 + DOWN * 0.5)
        compute_label = Text("Compute Partition\n(128 nodes)", font_size=16, color="#2ecc71").move_to(compute_box)
        compute = VGroup(compute_box, compute_label)

        # GPU partition
        gpu_box = RoundedRectangle(
            corner_radius=0.1, width=3.0, height=1.0,
            color="#e74c3c", fill_opacity=0.1,
        ).move_to(RIGHT * 2 + DOWN * 2.3)
        gpu_label = Text("GPU Partition\n(8 nodes, 4x A100)", font_size=14, color="#e74c3c").move_to(gpu_box)
        gpu = VGroup(gpu_box, gpu_label)

        # Parallel filesystem
        storage_box = RoundedRectangle(
            corner_radius=0.1, width=3.0, height=0.8,
            color="#9b59b6", fill_opacity=0.2,
        ).move_to(LEFT * 3.5 + DOWN * 2.3)
        storage_label = Text("Lustre /scratch", font_size=16, color="#9b59b6").move_to(storage_box)
        storage = VGroup(storage_box, storage_label)

        # Animate components appearing in the order they were drawn on the whiteboard
        components = [login, head, compute, gpu, storage]
        for comp in components:
            self.play(FadeIn(comp, shift=UP * 0.15), run_time=0.4)

        # Draw connections (simulating the lines drawn on the whiteboard)
        connections: list[tuple[VGroup, VGroup]] = [
            (login, head),
            (head, compute),
            (head, gpu),
            (storage, compute),
            (storage, gpu),
        ]

        for src, dst in connections:
            line = Line(
                src.get_center(), dst.get_center(),
                color=GRAY, stroke_width=1.5,
            )
            self.play(Create(line), run_time=0.3)

        # InfiniBand fabric label across the middle
        ib_label = Text(
            "InfiniBand HDR (200 Gb/s)", font_size=14, color=GRAY_B
        ).move_to(DOWN * 0.5 + LEFT * 2.5)
        self.play(FadeIn(ib_label), run_time=0.3)

        self.wait(2.0)
```

**Render command:**

```bash
manim render -qh arch_remake.py ClusterArchitectureRemake
ffmpeg -i media/videos/arch_remake/1080p30/ClusterArchitectureRemake.mp4 \
  -c:v libx264 -pix_fmt yuv420p -crf 18 -preset slow \
  cluster_architecture_remake_1080p.mp4
```

**Expected render time:** ~4-6 seconds.

### 10.5 Honest Limits of the Pipeline

The video-to-animation pipeline has real constraints:

- **OCR accuracy:** Tesseract struggles with custom fonts, anti-aliased text on dark backgrounds (Grafana), and numbers that look similar (6/8, 1/7). Expect 5-15% error rate that requires manual correction.
- **Temporal alignment:** Frame extraction at 1fps loses sub-second dynamics. For fast-changing dashboards, extract at higher fps but expect larger intermediate files.
- **Spatial relationships:** Extracting the topology of an architecture diagram from video is a manual process. No CV tool reliably identifies "this box connects to that box" from a whiteboard photo. Plan to trace connections by hand.
- **When to give up:** If the source video is longer than 60 seconds or contains more than 10 distinct data series, it is faster to ask for the raw data and build the animation from scratch than to reverse-engineer it from pixels.

### 10.6 Companion Tooling Note

If your video extraction needs go beyond simple OCR, consider building a small CLI tool that wraps OpenCV and Tesseract into a pipeline. A minimal structure:

```bash
# Example pipeline using ffmpeg + tesseract (no custom code needed for simple cases)
mkdir -p frames
ffmpeg -i dashboard_recording.mp4 -vf "fps=1,crop=400:50:100:200" frames/metric_%04d.png
for f in frames/metric_*.png; do
  tesseract "$f" stdout --psm 7 2>/dev/null
done > extracted_values.txt
```

The `crop` filter isolates the metric region of interest. `--psm 7` tells Tesseract to treat the input as a single line of text. Pipe the output into your matplotlib script.

---

## Related Tutorials

- [[animation-toolkit-for-hpc-talks-beginner-guide|Animation Toolkit Beginner Guide]] — installation, first animations, quickstart for all three tools
- [[docker-test-container-beginner-guide|Docker Containers Guide]] — container concepts for isolated build environments
- [[docker-test-container-deep-dive|Docker Deep Dive]] — container internals, multi-stage builds
- [[isaaclab-metagrasp-apptainer-hpc-beginner-guide|IsaacLab Apptainer HPC Guide]] — running containerized workloads on HPC clusters
- [[hyperqueue-basics|HyperQueue Basics]] — HPC job scheduling concepts
- [[hyperqueue-deep-dive|HyperQueue Deep Dive]] — advanced job scheduling, auto-allocation
- [[parsl-beginner-guide|Parsl Beginner Guide]] — parallel computing workflows in Python
- [[just-beginner-guide|Just Beginner Guide]] — task runner for build automation
- [[just-deep-dive|Just Deep Dive]] — advanced Just recipes and patterns
- [[pixi-beginner-guide|Pixi Beginner Guide]] — Python/conda environment management
- [[pixi-deep-dive|Pixi Deep Dive]] — advanced Pixi, multi-platform environments
- [[kubernetes-beginner-guide|Kubernetes Guide]] — container orchestration concepts
- [[linux-permissions-beginner-guide|Linux Permissions Guide]] — file permissions for render output
- [[cgroups-beginner-guide|Cgroups Beginner Guide]] — resource management fundamentals
- [[cgroups-deep-dive|Cgroups Deep Dive]] — advanced resource isolation

---

Pick one recipe from this guide, render it tonight, and embed it in your next slide deck — that single commit to "animation as code" will teach you more than reading the rest of this document twice.
