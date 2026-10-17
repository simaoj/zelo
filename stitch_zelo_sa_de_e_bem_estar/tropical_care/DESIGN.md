---
name: Tropical Care
colors:
  surface: '#fbf9f5'
  surface-dim: '#dbdad6'
  surface-bright: '#fbf9f5'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f5f3ef'
  surface-container: '#efeeea'
  surface-container-high: '#eae8e4'
  surface-container-highest: '#e4e2de'
  on-surface: '#1b1c1a'
  on-surface-variant: '#574239'
  inverse-surface: '#30312e'
  inverse-on-surface: '#f2f0ed'
  outline: '#8b7267'
  outline-variant: '#dec0b4'
  surface-tint: '#a23f00'
  primary: '#a23f00'
  on-primary: '#ffffff'
  primary-container: '#ff8243'
  on-primary-container: '#682600'
  inverse-primary: '#ffb695'
  secondary: '#006a6a'
  on-secondary: '#ffffff'
  secondary-container: '#85f1f0'
  on-secondary-container: '#006e6e'
  tertiary: '#6c5e00'
  on-tertiary: '#ffffff'
  tertiary-container: '#b7a649'
  on-tertiary-container: '#443b00'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#ffdbcc'
  primary-fixed-dim: '#ffb695'
  on-primary-fixed: '#351000'
  on-primary-fixed-variant: '#7b2f00'
  secondary-fixed: '#88f4f3'
  secondary-fixed-dim: '#6ad7d7'
  on-secondary-fixed: '#002020'
  on-secondary-fixed-variant: '#004f4f'
  tertiary-fixed: '#f7e37f'
  tertiary-fixed-dim: '#dac766'
  on-tertiary-fixed: '#211b00'
  on-tertiary-fixed-variant: '#524700'
  background: '#fbf9f5'
  on-background: '#1b1c1a'
  surface-variant: '#e4e2de'
typography:
  headline-xl:
    fontFamily: Newsreader
    fontSize: 40px
    fontWeight: '600'
    lineHeight: 48px
    letterSpacing: -0.02em
  headline-xl-mobile:
    fontFamily: Newsreader
    fontSize: 32px
    fontWeight: '600'
    lineHeight: 40px
    letterSpacing: -0.01em
  headline-lg:
    fontFamily: Newsreader
    fontSize: 32px
    fontWeight: '600'
    lineHeight: 40px
    letterSpacing: -0.015em
  headline-lg-mobile:
    fontFamily: Newsreader
    fontSize: 26px
    fontWeight: '600'
    lineHeight: 34px
    letterSpacing: -0.01em
  headline-md:
    fontFamily: Newsreader
    fontSize: 24px
    fontWeight: '500'
    lineHeight: 32px
  headline-sm:
    fontFamily: Newsreader
    fontSize: 20px
    fontWeight: '500'
    lineHeight: 28px
  title-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 18px
    fontWeight: '600'
    lineHeight: 26px
  body-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  body-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  label-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 13px
    fontWeight: '600'
    lineHeight: 18px
    letterSpacing: 0.01em
  label-sm:
    fontFamily: Plus Jakarta Sans
    fontSize: 11px
    fontWeight: '600'
    lineHeight: 14px
    letterSpacing: 0.03em
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  gutter: 1rem
  gutter-mobile: 0.75rem
  margin: 2rem
  margin-mobile: 1.25rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 1rem
  space-lg: 1.5rem
  space-xl: 2.25rem
---

## Brand & Style

This design system translates daily healthcare into an uplifting, life-affirming routine rather than a sterile clinical chore. Designed for individuals and families managing chronic health, daily wellness routines, medication schedules, and preventative care, the aesthetic rejects the cold, sterile, hospital-white palette common to legacy health platforms. 

Instead, it blends warm editorial warmth with humanized modern minimalism. The visual voice is empathetic, sunny, organized, and deeply reassuring. Clean geometric structures—inspired by gentle semicircular sunbursts and organic arches—frame crisp data visualizations, allowing medical numbers, tracking insights, and reminders to feel approachable, humane, and deeply comforting.

## Colors

The palette is grounded in the warmth of the "Tropical Punch" harmonies:

- **Primary (`#FF8243`)**: A sunlit, vibrant coral-orange designated for high-intent actions, primary interactive triggers, active tab states, and pivotal notifications.
- **Secondary (`#069494`)**: Deep teal / petroleum green serving as the anchor of precision, medical credibility, analytics, graphs, and completed health markers.
- **Tertiary (`#FCE883`)**: Soft solar yellow paired alongside delicate blush rose (`#FFC0CB`) to build warm, reassuring card containers, subtle alert tags, category chips, and soft background accents.
- **Neutral & Canvas (`#FDFBF7`)**: Warm linen-cream base canvas complemented by pure white (`#FFFFFF`) elevated surface layers, avoiding clinical sterile blue-greys entirely. Deep charcoal-espresso (`#2B2625`) serves as high-contrast accessible typography.

## Typography

The typographic hierarchy pairs classical warmth with contemporary digital utility:

- **Editorial Headings (`Newsreader`)**: Infuses conversational elegance, empathy, and literary confidence into screen titles, greeting banners, and reflective health journal milestones.
- **Interface & Data Sans (`Plus Jakarta Sans`)**: Delivers open counters, legible tabular numbers, and rounded geometric terminals perfectly suited for medication dosages, time pickers, vital sign logs, and button CTAs.

## Layout & Spacing

A fluid grid architecture engineered for frictionless handheld mobile execution and airy desktop/tablet dashboards:

- **Handheld Layout**: A 4-column fluid structure framed by `1.25rem` outer canvas padding (`margin-mobile`), ensuring one-handed reachability with comfortable vertical touch targets.
- **Tablet & Desktop**: Fluid 8 and 12-column grids scaling up to an ergonomic max-width container of `1160px` with generous `2rem` outer page margins.
- **Spacing Rhythm**: Governed by an intuitive 8pt / 4pt sub-scale. Critical card contents use `space-md` (16px) or `space-lg` (24px) to separate metrics, preventing visual fatigue and sensory overload during stressful care moments.

## Elevation & Depth

Visual depth is achieved through gentle, sunlit atmospheric layering rather than stark black drops:

- **Surface Tiers**: Base application background rests at `#FDFBF7`. Foreground cards, module segments, and modal sheets elevate through pure white `#FFFFFF` or pale pastel wash surfaces (such as `#FFF5EC` or `#FFF9DF`).
- **Warm Ambient Diffusions**: Drop shadows reject sterile grey hexes. Instead, they leverage low-opacity orange/umber diffusions:
  - *Resting Card*: `0 4px 20px -2px rgba(89, 44, 18, 0.05)`
  - *Elevated Modal / Floating Action*: `0 12px 36px -4px rgba(89, 44, 18, 0.09)`
- **Hairline Outlines**: Elements sit within soft borders tinted at `rgba(43, 38, 37, 0.06)`, providing crisp edge definition on variable screen displays.

## Shapes

The shape system draws direct inspiration from the welcoming semicircles and soft geometry of the brand logomark:

- **Standard Containers**: Input fields, standard cards, and action sheets rely on an inviting `roundedness: 2` (16px / `1rem` radius).
- **Emblematic Arch Accents**: Header backdrops, featured insight banners, and progress meters incorporate rounded top arches (semicircular curvature `rounded-t-full`) reflecting the warmth of sunrise shapes.
- **Interactive Badges**: Pill radii (`rounded-full`) are applied universally to tags, metric pills, and floating action triggers for friendly, tactile ergonomics.

## Components

### Buttons
- **Primary CTA**: Solid coral `#FF8243` background, high-contrast white `#FFFFFF` label (`label-md`), full height minimum of 48px, radius `1rem` or full pill. Hover transitions to `#F27231` with warm glow.
- **Secondary / Action**: Delicate teal stroke `#069494` or light cream-wash `#E7F5F5` surface with bold `#069494` text for analytical or secondary care flows.
- **Ghost**: Transparent background with subtle terracotta tinting on press.

### Cards & Care Modules
- **Metric Cards**: Elevated white surface with a top or side semicircular accent tab in `#FCE883` or `#FFC0CB`. Displays vital signs or scheduled doses with clear numbers in `Plus Jakarta Sans` and an explanatory caption in `Newsreader`.
- **Alert / Reassurance Banners**: Soft sunrise wash (`#FFF9DF`) paired with warm amber or teal icons to deliver friendly daily reminders without alarmist medical styling.

### Input Fields & Controls
- **Text Inputs**: Crisp `#FFFFFF` backgrounds with an understated `1.5px` border in `#EBE6DF`. On focus, the field transitions to a `#FF8243` stroke paired with a gentle 3px diffuse focus ring (`rgba(255, 130, 67, 0.15)`).
- **Checkboxes & Radios**: Pill-curved selection modules. Checked states feature solid `#069494` fills with clear white iconography, signaling completion and care achievement.

### Chips & Filter Tags
- **Status Chips**: Compact, pill-shaped tags utilizing soft pastel fills (`#FFC0CB` at 35% opacity or `#FCE883` at 40% opacity) combined with dark charcoal-espresso typography (`#2B2625`).