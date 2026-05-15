---
title: Dotfiles Tool Questionnaire
date: 2026-04-11
tags:
  - dotfiles
  - tools
  - decision-guide
---

# Dotfiles Tool Questionnaire

## Introduction

Choosing the right dotfile management tool depends on your specific needs, environment, and experience level. This questionnaire will help you decide between **GNU Stow** (simple, lightweight) and **chezmoi** (feature-rich, multi-machine).

Answer the questions below honestly—there are no wrong answers. Your responses will guide you toward the tool that best fits your workflow.

---

## Your Environment

**1. What operating systems do you use?**
- [x] macOS only
- [x] Linux only
- [ ] Both macOS and Linux
- [ ] Windows (and/or WSL)

**2. How many machines do you manage dotfiles across?**
- [ ] Just one
- [ ] 2-3 machines
- [x] 4 or more machines

**3. Do your machines have different architectures?** (e.g., x86_64, ARM, Apple Silicon)
- [ ] No, all the same
- [x] Yes, some differences
- [ ] Unsure

---

## Your Experience Level

**4. How comfortable are you with git?**
- [ ] Not comfortable; prefer GUI tools or minimal git interaction
- [ ] Somewhat comfortable; basic operations are fine
- [x] Very comfortable; I use advanced git features regularly

**5. Have you used templating languages before?** (Go templates, Jinja2, etc.)
- [x] No, never
- [ ] Yes, but not regularly
- [ ] Yes, regularly in my work

**6. How comfortable are you with the command line?**
- [ ] Beginner; I prefer GUIs and minimal terminal use
- [ ] Intermediate; comfortable with common commands
- [x] Advanced; I spend most time in the terminal

---

## Your Needs

**7. Do you need to manage secrets/credentials in your dotfiles?** (API keys, tokens, passwords)
- [ ] No, my configs don't include secrets
- [x] Yes, and I want them encrypted
- [x] Yes, but I keep them separate from dotfiles

**8. Do you need different configurations per machine?** (e.g., work vs personal, different shells)
- [ ] No, all machines have identical configs
- [x] Somewhat; minor differences per machine
- [ ] Yes, significant differences between machines

**9. Do you want auto-install capability?** (Homebrew, apt packages as part of setup)
- [ ] No, I manage packages separately
- [ ] Maybe; would be nice but not essential
- [x] Yes, fully automated setup is important

**10. Which of these tools do you use?** (select all that apply)
- [x] neovim/vim
- [x] tmux
- [x] zsh/bash
- [x] git
- [x] ssh
- [ ] Other shells or terminal tools

**11. How often do you change your dotfiles?**
- [ ] Rarely; my setup is stable
- [x] Monthly or less frequently
- [ ] Weekly or more frequently

---

## Your Preferences

**12. Tool philosophy: what appeals to you more?**
- [x] A. Simple, lightweight tool with minimal dependencies
- [ ] B. Comprehensive tool with built-in solutions for common problems

**13. State management: what do you prefer?**
- [ ] A. Plain git repo with symlinks (transparent, easy to inspect)
- [x] B. Tool-managed state with abstraction (cleaner, less to manage)

**14. Is encryption important to you?**
- [ ] No, not necessary
- [x] Nice to have, but not essential
- [ ] Very important for my use case

---

## Scoring Guide

### Mostly A answers?
**GNU Stow is likely your best fit.** Stow is simple, lightweight, and transparent. You manage a plain git repository with symlinks—no hidden state, no special syntax. Perfect if you want minimal overhead and enjoy direct git control.

### Mostly B answers?
**chezmoi is likely your best fit.** chezmoi offers templates, encryption, machine-specific configs, and hooks for automation. Ideal if you manage multiple machines with different needs and want a polished, feature-complete solution.

### Mixed answers?
You might benefit from both tools' features. Consider your top 2-3 priorities (encryption? multi-machine? simplicity?) and let that guide your choice.

---

## Next Steps

Once you've answered the questions above, you have two paths forward:

- **Quick start?** Check [[dotfiles-beginner-guide]] for side-by-side setup instructions for both tools.
- **Deep dive?** Explore [[dotfiles-deep-dive]] for comprehensive coverage, best practices, and advanced patterns.

**Ready to commit?** Once you've decided on GNU Stow or chezmoi, let me know and I'll create a personalized in-depth user guide tailored to your specific setup and needs!
# Next Steps

Once you've answered the questions above, you have two paths forward:

- **Quick start?** Check [[dotfiles-beginner-guide]] for side-by-side setup instructions for both tools.
- **Deep dive?** Explore [[dotfiles-deep-dive]] for comprehensive coverage, best practices, and advanced patterns.
- **Chose Chezmoi?** Jump to [[chezmoi-beginner-guide|Chezmoi Beginner Guide]] for a dedicated getting-started guide, then [[chezmoi-deep-dive|Chezmoi Deep Dive]] for templates, encryption, and multi-machine strategies.

**Ready to commit?** Once you've decided on GNU Stow or chezmoi, let me know and I'll create a personalized in-depth user guide tailored to your specific setup and needs!
