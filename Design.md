---
version: alpha
name: Gear6-Cobalt-and-Bone
description: Gear6's design language, built on a single confident cobalt over a bone neutral ground. The palette replaces the aubergine system this document previously carried; type, spacing, radii and component geometry are unchanged. Cobalt is the only brand hue, semantic colour is reserved for state, and the ground is warm off-white rather than pure white so an elevated surface has something to be elevated against.

colors:
  primary: "#2451b8"
  primary-deep: "#2148a5"
  primary-press: "#3163d0"
  primary-tint: "#3a63c4"
  on-primary: "#ffffff"
  ink: "#1a1c22"
  ink-mute: "#61646f"
  link-blue: "#2451b8"
  link-hover: "#3163d0"
  canvas: "#fcfbf8"
  canvas-bone: "#f1efe9"
  canvas-mist: "#e6ecf9"
  surface-elev: "#fdfcfa"
  surface-cobalt: "#2451b8"
  hairline: "#e1ddd5"
  hairline-strong: "#d5cfc4"
  semantic-error: "#a8503a"
  semantic-success: "#2a6f54"
  semantic-warning: "#7b5a17"
  on-cobalt-mute: "#b8c6e8"

typography:
  display-xxl:
    fontFamily: "Salesforce-Avant-Garde, system-ui, -apple-system, BlinkMacSystemFont, sans-serif"
    fontSize: 64px
    fontWeight: 700
    lineHeight: 1.12
    letterSpacing: -0.768px
  display-xl:
    fontFamily: "Salesforce-Avant-Garde, system-ui, -apple-system, BlinkMacSystemFont, sans-serif"
    fontSize: 58px
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: -0.464px
  display-lg:
    fontFamily: "Salesforce-Avant-Garde, system-ui, -apple-system, BlinkMacSystemFont, sans-serif"
    fontSize: 50px
    fontWeight: 700
    lineHeight: 1.12
    letterSpacing: -0.6px
  display-md:
    fontFamily: "Salesforce-Avant-Garde, system-ui, -apple-system, BlinkMacSystemFont, sans-serif"
    fontSize: 32px
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: -0.256px
  heading-lg:
    fontFamily: "Salesforce-Avant-Garde, system-ui, -apple-system, BlinkMacSystemFont, sans-serif"
    fontSize: 24px
    fontWeight: 700
    lineHeight: 1.33
    letterSpacing: -0.096px
  heading-md:
    fontFamily: "Salesforce-Avant-Garde, system-ui, -apple-system, BlinkMacSystemFont, sans-serif"
    fontSize: 22px
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: 0
  heading-sm:
    fontFamily: "Salesforce-Avant-Garde, system-ui, -apple-system, BlinkMacSystemFont, sans-serif"
    fontSize: 18px
    fontWeight: 600
    lineHeight: 1.56
    letterSpacing: -0.0216px
  body-lg:
    fontFamily: "Salesforce-Sans, system-ui, -apple-system, sans-serif"
    fontSize: 18px
    fontWeight: 400
    lineHeight: 1.55
    letterSpacing: -0.0216px
  body-md:
    fontFamily: "Salesforce-Sans, system-ui, -apple-system, sans-serif"
    fontSize: 16px
    fontWeight: 400
    lineHeight: 1.55
    letterSpacing: 0
  body-strong:
    fontFamily: "Salesforce-Sans, system-ui, -apple-system, sans-serif"
    fontSize: 16px
    fontWeight: 700
    lineHeight: 1.5
    letterSpacing: 0.16px
  button-lg:
    fontFamily: "Salesforce-Sans, system-ui, -apple-system, sans-serif"
    fontSize: 18px
    fontWeight: 700
    lineHeight: 1.0
    letterSpacing: 0
  button-md:
    fontFamily: "Salesforce-Sans, system-ui, -apple-system, sans-serif"
    fontSize: 16px
    fontWeight: 700
    lineHeight: 1.38
    letterSpacing: 0.2px
  button-cap:
    fontFamily: "Salesforce-Sans, system-ui, -apple-system, sans-serif"
    fontSize: 14.4px
    fontWeight: 700
    lineHeight: 1.0
    letterSpacing: 0.144px
  caption:
    fontFamily: "Salesforce-Sans, system-ui, -apple-system, sans-serif"
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.43
    letterSpacing: 0.1px
  micro-cap:
    fontFamily: "Salesforce-Sans, system-ui, -apple-system, sans-serif"
    fontSize: 12px
    fontWeight: 700
    lineHeight: 1.0
    letterSpacing: 0.96px

rounded:
  xs: 2px
  sm: 4px
  md: 8px
  lg: 12px
  xl: 16px
  xxl: 48px
  pill: 90px

spacing:
  xs: 4px
  sm: 8px
  md: 12px
  lg: 16px
  xl: 20px
  xxl: 24px
  huge: 28px

components:
  button-primary-pill:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.button-md}"
    rounded: "{rounded.pill}"
    padding: 14px 28px
  button-primary-pill-pressed:
    backgroundColor: "{colors.primary-press}"
    textColor: "{colors.on-primary}"
    typography: "{typography.button-md}"
    rounded: "{rounded.pill}"
    padding: 14px 28px
  button-secondary-pill:
    backgroundColor: "{colors.canvas-mist}"
    textColor: "{colors.ink}"
    typography: "{typography.button-md}"
    rounded: "{rounded.pill}"
    padding: 10px 30px
  button-outline-cobalt:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.primary}"
    typography: "{typography.button-md}"
    rounded: "{rounded.pill}"
    padding: 14px 28px
  button-outline-on-cobalt:
    backgroundColor: "{colors.surface-cobalt}"
    textColor: "{colors.on-primary}"
    typography: "{typography.button-md}"
    rounded: "{rounded.pill}"
    padding: 14px 28px
  text-input:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    typography: "{typography.body-md}"
    rounded: "{rounded.sm}"
    padding: 10px 12px
  pill-cap-shade:
    backgroundColor: "{colors.canvas-bone}"
    textColor: "{colors.ink}"
    typography: "{typography.micro-cap}"
    rounded: "{rounded.pill}"
    padding: 4px 12px
  card-pricing:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    typography: "{typography.body-md}"
    rounded: "{rounded.xl}"
    padding: 32px
  card-pricing-featured:
    backgroundColor: "{colors.surface-cobalt}"
    textColor: "{colors.on-primary}"
    typography: "{typography.body-md}"
    rounded: "{rounded.xl}"
    padding: 32px
  card-feature-bone:
    backgroundColor: "{colors.canvas-bone}"
    textColor: "{colors.ink}"
    typography: "{typography.body-md}"
    rounded: "{rounded.xl}"
    padding: 32px
  card-cobalt-band:
    backgroundColor: "{colors.surface-cobalt}"
    textColor: "{colors.on-primary}"
    typography: "{typography.body-lg}"
    rounded: "{rounded.xl}"
    padding: 48px
  card-stat:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.primary}"
    typography: "{typography.display-lg}"
    rounded: "{rounded.xl}"
    padding: 32px
  nav-bar-light:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    typography: "{typography.body-md}"
    rounded: "{rounded.xs}"
    padding: 16px 24px
  link-on-light:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.link-blue}"
    typography: "{typography.body-md}"
    rounded: "{rounded.xs}"
    padding: 0px
  link-on-cobalt:
    backgroundColor: "{colors.surface-cobalt}"
    textColor: "{colors.on-primary}"
    typography: "{typography.body-md}"
    rounded: "{rounded.xs}"
    padding: 0px
  footer-cobalt:
    backgroundColor: "{colors.surface-cobalt}"
    textColor: "{colors.on-primary}"
    typography: "{typography.caption}"
    rounded: "{rounded.xs}"
    padding: 32px 24px
---

## Overview

Gear6's design language centers on one saturated cobalt (`{colors.primary}`) over a bone neutral ground. The cobalt is the only brand hue in the system, applied as the filled button, the selected state, the featured tier, the closing band, and the wordmark. Everything around it is warm off-white: bone surfaces, hairlines drawn from that same warm family, and ink just shy of black. The contrast lands on the brand rather than on the interface, which is what lets a page stay quiet while still having a point of view.

Typography splits between two humanist sans families. The display tier runs at 700 weight at sizes 32-64px with negative letter-spacing for tight optical density on hero headlines. The UI tier uses the second family at 400-700 with slightly relaxed leading (1.55), so body copy reads quietly without competing with the cobalt moments.

Buttons are pill-shaped at 90px radius with an unusual amount of horizontal padding (28-30px), giving them a distinctly comfortable, almost over-padded feel. The primary cobalt pill is the only filled button in most contexts; secondary actions use a pale mist pill (`{colors.canvas-mist}`), which is the cobalt at its lightest rather than a second hue. Inline links use the brand itself (`{colors.link-blue}`) and carry an underline, because on a page whose only chromatic element is cobalt, colour alone no longer marks a link.

**Key Characteristics:**
- A single cobalt primary (`{colors.primary}`) reused across CTAs, selection, the featured tier, the closing band, and the wordmark. One hue, no second accent.
- Bone neutral ground (`{colors.canvas-bone}`) with a cobalt mist tint (`{colors.canvas-mist}`) for selected and secondary surfaces. Warm ground, cool brand.
- Off-white canvas (`#fcfbf8`) rather than pure white, so an elevated surface has something to be elevated against.
- Pill buttons at `{rounded.pill}` (90px radius) with generous 28-30px horizontal padding, over-padded by SaaS-default standards, deliberately so.
- Tight negative letter-spacing on display sizes (-0.768px on the 64px hero) for editorial-density headlines.
- Semantic colour reserved for state and never used for emphasis. Cobalt sits 64 degrees from the nearest semantic hue, so brand and status never argue.
- Statistics cards rendered in massive cobalt display type on bone. Quantitative emphasis through scale alone.

## Colors

The palette is Cobalt and Bone: one confident brand hue against a soft warm ground, on the argument that calm is not the same as timid.

### Brand & Accent
- **Cobalt** (`{colors.primary}` - `#2451b8`): The brand's primary surface and CTA color. Saturated and bright enough that a selected row reads as selected without going dark, which is the failure mode of a deep, heavily saturated brand fill.
- **Cobalt Deep** (`{colors.primary-deep}` - `#2148a5`): The text-and-border weight of the brand. Use it for cobalt type, hairlines, and focus rings on light surfaces, where the fill weight does not clear 4.5:1.
- **Cobalt Press** (`{colors.primary-press}` - `#3163d0`): Pressed-state lift of the primary, one step brighter.
- **Cobalt Tint** (`{colors.primary-tint}` - `#3a63c4`): Border accent on cobalt-on-cobalt surfaces.
- **Link** (`{colors.link-blue}` - `#2451b8`): Inline link color, identical to the primary by design. Links carry a persistent underline, since colour no longer separates them from the rest of the system.
- **Link Hover** (`{colors.link-hover}` - `#3163d0`): The press weight, reused on link hover.

### Surface
- **Canvas** (`{colors.canvas}` - `#fcfbf8`): Default content surface. Off-white, never pure white.
- **Canvas Bone** (`{colors.canvas-bone}` - `#f1efe9`): Warm neutral for feature bands, secondary surfaces, and the quiet ground behind dense lists.
- **Canvas Mist** (`{colors.canvas-mist}` - `#e6ecf9`): The cobalt at its lightest. Secondary-button surface, selected rows, soft section bands. This is the token that makes selection readable without a saturated block behind it.
- **Surface Cobalt** (`{colors.surface-cobalt}` - `#2451b8`): The primary reused as a surface for the featured tier, the closing band, and the footer.
- **Hairline** (`{colors.hairline}` - `#e1ddd5`): 1px borders on cards and table dividers, drawn from the bone family rather than a neutral grey so it sits on the warm ground without a seam.
- **Hairline Strong** (`{colors.hairline-strong}` - `#d5cfc4`): The heavier divider, for group boundaries rather than row boundaries.

### Text
- **Ink** (`{colors.ink}` - `#1a1c22`): Primary body text on light surfaces. Off-black with a faint cool cast that ties it to the cobalt.
- **Ink Mute** (`{colors.ink-mute}` - `#61646f`): Secondary text, captions, helper copy.
- **On Primary** (`{colors.on-primary}` - `#ffffff`): Text on cobalt surfaces and filled CTAs.
- **On Cobalt Mute** (`{colors.on-cobalt-mute}` - `#b8c6e8`): Secondary text on cobalt surfaces. A desaturated blue that reads as muted-light without going grey.

### Semantic
Semantic colour marks state. It is never used for emphasis, never a surface fill behind unread content, and never doubled as a wash plus a border plus a chip on the same element. One hue, one meaning.

- **Error** (`{colors.semantic-error}` - `#a8503a`): Form error and destructive-action color.
- **Warning** (`{colors.semantic-warning}` - `#7b5a17`): At-risk and degraded state.
- **Success** (`{colors.semantic-success}` - `#2a6f54`): Inline success indicators.

### Dark Rendering
The dark set is not an inversion. `{colors.primary}` stays a dark fill under white type, and the text-and-border weight lifts to a light cobalt instead, because one hex cannot both sit under white text and be readable as text on a dark ground.

| Token | Dark value | Note |
|---|---|---|
| `{colors.primary}` | `#3a67cf` | Fill only, always under `{colors.on-primary}` |
| `{colors.primary-deep}` | `#9fb6ef` | Text, borders, focus rings on dark |
| `{colors.primary-press}` | `#4b79e0` | Pressed lift |
| `{colors.primary-tint}` | `#6c80bb` | Dashed and low-emphasis strokes |
| `{colors.canvas}` | `#16171d` | Off-black, never pure black |
| `{colors.canvas-bone}` | `#1f2027` | Quiet ground |
| `{colors.canvas-mist}` | `#272a35` | Selected rows and secondary surfaces |
| `{colors.hairline}` | `#32343f` | Row and card dividers |
| `{colors.ink}` | `#e1e2e9` | Body text |
| `{colors.ink-mute}` | `#989cab` | Secondary text |
| `{colors.link-blue}` | `#8fb0f0` | Inline links |
| `{colors.semantic-error}` | `#e58f78` | |
| `{colors.semantic-warning}` | `#dab060` | |
| `{colors.semantic-success}` | `#57c096` | |

## Typography

### Font Family

The display tier is **Salesforce Avant Garde** — a proprietary humanist sans with broad apertures and a slightly geometric character. When unavailable, fall back to the system font stack (`system-ui, -apple-system, BlinkMacSystemFont`).

The UI tier is **Salesforce Sans** — a separate proprietary face used for body, captions, and button labels. Same fallback chain.

Both faces are proprietary and not freely available. Substitute with **Inter** (open-source via Google Fonts) at matching weights for both display and body — Inter is the closest open analogue across both tiers.

### Hierarchy

| Token | Size | Weight | Line Height | Letter Spacing | Use |
|---|---|---|---|---|---|
| `{typography.display-xxl}` | 64px | 700 | 1.12 | -0.768px | Marketing hero headline |
| `{typography.display-xl}` | 58px | 600 | 1.25 | -0.464px | Section openers |
| `{typography.display-lg}` | 50px | 700 | 1.12 | -0.6px | Statistics callouts |
| `{typography.display-md}` | 32px | 700 | 1.25 | -0.256px | Card / feature titles |
| `{typography.heading-lg}` | 24px | 700 | 1.33 | -0.096px | Pricing tier names |
| `{typography.heading-md}` | 22px | 600 | 1.4 | 0 | Sub-section heading |
| `{typography.heading-sm}` | 18px | 600 | 1.56 | -0.0216px | Compact card title |
| `{typography.body-lg}` | 18px | 400 | 1.55 | -0.0216px | Marketing body lead |
| `{typography.body-md}` | 16px | 400 | 1.55 | 0 | Default UI body |
| `{typography.body-strong}` | 16px | 700 | 1.5 | 0.16px | Emphasized body |
| `{typography.button-lg}` | 18px | 700 | 1.0 | 0 | Hero pill button label |
| `{typography.button-md}` | 16px | 700 | 1.38 | 0.2px | Standard pill button label |
| `{typography.button-cap}` | 14.4px | 700 | 1.0 | 0.144px | Compact pill label |
| `{typography.caption}` | 14px | 400 | 1.43 | 0.1px | Helper, footnote |
| `{typography.micro-cap}` | 12px | 700 | 1.0 | 0.96px | All-caps eyebrow |

### Principles
- **Tight tracking on display.** Negative letter-spacing across 32–64px sizes; the proprietary face is wide by default, the negative tracking pulls it into editorial density.
- **Body at 1.55 leading.** Slightly relaxed for marketing readability without crossing into airy / 1.7+ territory.
- **Caps for eyebrows.** All eyebrows render uppercase with positive 0.96–0.144px tracking depending on size.

### Note on Font Substitutes
Use **Inter** (open-source Google Fonts) for both display and UI tiers — Inter at 700 weight with `-0.768px` letter-spacing closely approximates the brand's display behavior. For maximum brand fidelity, **Lato** is a softer humanist alternative that pairs well at body sizes. Avoid System UI fonts on the body — the brand's subtle warmth disappears at default weights.

## Layout

### Spacing System
- **Base unit**: 8px (with 4 / 12 / 16 / 20 / 24 / 28 sub-tokens for fine vertical rhythm).
- **Tokens**: `{spacing.xs}` 4px · `{spacing.sm}` 8px · `{spacing.md}` 12px · `{spacing.lg}` 16px · `{spacing.xl}` 20px · `{spacing.xxl}` 24px · `{spacing.huge}` 28px.
- **Section padding**: 64–96px on marketing surfaces; tightens to 48px on transactional pages.
- **Card internal padding**: 32px on pricing cards; 48px on cobalt band cards.

### Grid & Container
- Marketing pages center in a ~1240px container with edge-bleeding mesh washs escaping the container.
- Pricing collapses 4-up → 2-up → 1-up at 992 / 768 breakpoints.
- Statistics row: 3-column grid with massive 50px cobalt display numerals.

### Whitespace Philosophy
The mesh washs fill most of the negative space on marketing pages — sections feel expansive without being literally empty. On transactional pages the gradients drop, and whitespace reverts to traditional 48px-section breathing room.

## Elevation & Depth

| Level | Treatment | Use |
|---|---|---|
| 0 | Flat | Default surface |
| 1 | `box-shadow: rgba(0,0,0,0.1) 0 5px 20px 0` | Floating buttons on hero |
| 2 | `box-shadow: rgba(0,0,0,0.1) 0 0 32px 0` | Product UI mockup composites |
| 3 | `box-shadow: rgba(0,0,0,0.2) 0 1px 10px 0` | Toast / notification chrome |
| 4 | `box-shadow: rgb(58,99,196) 0 0 0 1px inset` | Cobalt inset border (button focus, special chrome), drawn from `{colors.primary-tint}` |

### Decorative Depth
The brand's depth language is the **mesh wash** - warm bone, cobalt mist, and a pale slate stop blurred together at large radii to create soft atmospheric backdrops behind product UI screenshots. The gradient is the brand's flavor of "depth without shadows": the eye perceives the product mockup as floating above a luminous backdrop without any literal lift.

## Shapes

### Border Radius Scale

| Token | Value | Use |
|---|---|---|
| `{rounded.xs}` | 2px | Hairline tags, status pills (rare) |
| `{rounded.sm}` | 4px | Form inputs |
| `{rounded.md}` | 8px | Compact card chrome, video frames |
| `{rounded.lg}` | 12px | Mid-size cards, secondary surface |
| `{rounded.xl}` | 16px | Pricing cards, feature cards |
| `{rounded.xxl}` | 48px | Stat badge backdrops |
| `{rounded.pill}` | 90px | All buttons |

### Photography Geometry
The brand uses **product UI screenshots** more than photography. UI mockups sit on top of mesh washs at roughly 4:3 aspect, with no shadow but with the gradient providing the "lift" the eye expects. Real photography appears in customer-logo strips and the occasional case-study card, treated as full-bleed inside `{rounded.xl}` containers.

## Components

### Buttons

**`button-primary-pill`** — the dominant CTA system-wide.
- Background `{colors.primary}`, text `{colors.on-primary}`, type `{typography.button-md}`, padding `14px 28px`, rounded `{rounded.pill}` 90px.
- Pressed state `button-primary-pill-pressed` shifts background to `{colors.primary-press}`.

**`button-secondary-pill`** — the pale mist alternative.
- Background `{colors.canvas-mist}`, text `{colors.ink}`, padding `10px 30px`, same pill geometry. Used as the second action beside the primary cobalt pill.

**`button-outline-cobalt`** — outline variant on white surfaces.
- Background `{colors.canvas}`, text `{colors.primary}`, 2px solid `{colors.primary}` border, same pill shape.

**`button-outline-on-cobalt`** — outline on cobalt canvas.
- Background `{colors.surface-cobalt}` (transparent over the surface), text `{colors.on-primary}`, 2px solid `{colors.on-primary}` border, same pill shape.

### Cards & Containers

**`card-pricing`** — standard pricing tier card.
- Background `{colors.canvas}`, padding `{spacing.xxl}+` (32px), rounded `{rounded.xl}` 16px, 1px `{colors.hairline}` border. Title in `{typography.heading-lg}`, price in `{typography.display-md}`, body in `{typography.body-md}`, CTA pinned to bottom as `button-primary-pill`.

**`card-pricing-featured`** — the inverted cobalt featured tier.
- Background `{colors.surface-cobalt}`, text `{colors.on-primary}`, otherwise identical to `card-pricing`. The cobalt fill is the brand's signature featured-tier choice.

**`card-feature-bone`** — feature explanation card on the bone track.
- Background `{colors.canvas-bone}`, text `{colors.ink}`, rounded `{rounded.xl}`, padding 32px.

**`card-cobalt-band`** — large horizontal band card with cobalt fill, often containing the closing CTA of a marketing page.
- Background `{colors.surface-cobalt}`, text `{colors.on-primary}`, padding 48px, rounded `{rounded.xl}` 16px.

**`card-stat`** — statistics callout card.
- Background `{colors.canvas}`, text `{colors.primary}` rendered in `{typography.display-lg}` (50px cobalt numeral). Holds a single percentage/number with a small caption underneath.

### Inputs & Forms

**`text-input`** — standard form field.
- Background `{colors.canvas}`, text `{colors.ink}`, type `{typography.body-md}`, padding `10px 12px`, rounded `{rounded.sm}` 4px, 1px `{colors.hairline}` border.

### Navigation

**`nav-bar-light`** — top nav across all marketing pages.
- Background `{colors.canvas}`, text `{colors.ink}`, padding `{spacing.lg} {spacing.xxl}`. Logo wordmark on the left, nav items center, two pill buttons on the right (`button-secondary-pill` for "Sign In", `button-primary-pill` for "Try For Free").

### Pills, Tags, and Chips

**`pill-cap-shade`** — small all-caps pill used as eyebrow above pricing-tier titles.
- Background `{colors.canvas-bone}`, text `{colors.ink}`, type `{typography.micro-cap}`, padding `4px 12px`, rounded `{rounded.pill}`.

### Signature Components

**Mesh Wash Backdrop** - warm bone (`#f7f2e8`) + cobalt mist (`#e3eaf8`) + pale slate (`#eceff2`) stops blurred together behind hero bands. Implemented as a CSS radial-gradient stack, not a single image. Provides the brand's depth/luminosity without literal shadows.

**Floating Product UI Mockup** — product screenshots framed in `{rounded.lg}` (12px) containers, positioned above the mesh wash with no border or shadow. The gradient does the lifting.

**Cobalt Footer Band** — every marketing page closes with a full-bleed `card-cobalt-band` containing a closing CTA in white type. The band height is generous (~480–600px on desktop) and reads as the page's signature.

**`link-on-light`** — inline links in body copy on light surfaces.
- Text `{colors.link-blue}` rendered in `{typography.body-md}`. No underline by default; underline appears on hover via the link-hover behavior.

**`link-on-cobalt`** — links inside cobalt surfaces.
- Text `{colors.on-primary}` with persistent underline.

**`footer-cobalt`** — site-wide footer.
- Background `{colors.surface-cobalt}`, text `{colors.on-primary}` rendered in `{typography.caption}`, padding `{spacing.huge}+ {spacing.xxl}` (32px 24px). Holds 4–5 columns of `{colors.on-cobalt-mute}` link groups, social icons, and a small legal/copyright row at the bottom.

## Do's and Don'ts

### Do
- Reserve `{colors.primary}` cobalt for filled CTAs, the featured pricing tier, and the closing cobalt band. One hue carries all of them.
- Use `{rounded.pill}` (90px) for every button across the system — never a rounded-rectangle button.
- Pair display tiers with negative letter-spacing (`-0.768px` at 64px); the proprietary face needs the tracking pull.
- Compose hero bands with mesh wash backdrop + floating product UI mockup; the gradient is the depth.
- Use `{colors.link-blue}` for inline links, and always with an underline. The link colour is the brand colour, so the underline is what marks it as a link.

### Don't
- Do not add a second accent colour. Cobalt is the whole chromatic system; the semantic trio is state, not accent.
- Don't shrink button padding below `14px 28px` — the over-padded pill is part of the brand feel.
- Don't render display tiers at default tracking (0) — without negative letter-spacing the headlines read loose and unedited.
- Don't put product UI screenshots inside cards — they sit ABOVE the mesh wash, never inside chrome.
- Do not use cobalt for body text — it's a surface and CTA color, not a type color at body sizes.
- Don't replace the pill shape with a square button anywhere.

## Responsive Behavior

### Breakpoints

| Name | Width | Key Changes |
|---|---|---|
| Wide | ≥ 1440px | Full-bleed mesh-wash hero; pricing 4-up |
| Desktop | 1024–1440px | Default content max-width; pricing 4-up |
| Tablet | 768–1023px | Pricing 2-up; product UI mockups crop to focal panel |
| Mobile | < 768px | Pricing 1-up; hamburger nav; display-xxl drops 64 → 40px |

### Touch Targets
- Pill buttons hit ≥ 48×48px due to the over-padded geometry. WCAG AAA compliant.
- Form fields stay at the 44px minimum height.

### Collapsing Strategy
- Display tiers stair-step 64 → 50 → 32 → 28 → 24 across breakpoints.
- Mesh washes re-tile on mobile to prevent the wash from disappearing entirely.
- Floating product UI mockups crop to the most actionable inner panel on mobile.
- Pricing tiers stair-step 4 → 2 → 1; cobalt featured tier stays distinguished.
- Top nav collapses to hamburger below 768px; menu inherits canvas color.

### Image Behavior
Product UI mockups use `srcset` for desktop / tablet / mobile crops; the mobile crop centers on the most actionable inner panel rather than scaling the whole composite down.

## Iteration Guide

1. Focus on ONE component at a time.
2. Reference component names and tokens directly (`{colors.primary}`, `{button-primary-pill}-pressed`, `{rounded.pill}`).
3. Run `npx @google/design.md lint DESIGN.md` after edits.
4. Add new variants as separate entries.
5. Default body to `{typography.body-md}`; reserve `{typography.body-lg}` for marketing leads.
6. Keep cobalt scarce. One filled cobalt button per viewport, and selection uses `{colors.canvas-mist}` rather than a filled block.
7. Pair every hero band with the mesh wash backdrop; bare-canvas heroes read as off-brand.
