# Daily Technician Audit Cockpit UI Guideline

## Brand Positioning

Daily Technician Audit Cockpit is an operational command center for daily field audit work. It should feel calm, precise, trustworthy, and efficient for repeated use. The interface is map-first and risk-focused, with a macOS utility-app character rather than a marketing dashboard.

## Visual Personality

- Calm operational cockpit
- macOS utility app, not a decorative web dashboard
- Glassy and layered, but restrained
- Compact, readable, and built for scanning
- Risk-forward through semantic color, not visual noise

## Color System

Use semantic colors consistently:

- Accent blue: navigation, active states, focus rings, selected neutral rows
- Red: high risk and critical findings only
- Orange: medium risk, warnings, and pending attention
- Cyan/blue: low/info states and GPS starts
- Green: healthy, complete, attendance in, resolved/OK
- Neutral gray: background, metadata, inactive controls

Light mode should use Apple-like neutral grays rather than pure white everywhere. Dark mode should use Space Gray tones rather than pure black or navy.

## Surface And Depth

Depth should communicate interaction and hierarchy:

- App background: quiet neutral gray
- Side panels: translucent material with subtle separators
- List rows and KPI tiles: shallow raised surfaces
- Floating map controls, popovers, modals: glass material with wide soft shadow
- Selected rows: semantic tint, small left rail, and restrained focus ring
- Avoid heavy glow, dark sticker shadows, and decorative depth

## Typography

Use the Apple system stack first:

```css
-apple-system, BlinkMacSystemFont, "SF Pro Text", "DM Sans", system-ui, sans-serif
```

Type roles:

- App title and inspector title: 650-700 weight
- List row title: 650 weight
- KPI numbers: 700 weight and tabular numerals
- Metadata and body copy: 400 weight
- Labels and section headers: 600 weight, small, muted

Avoid relying on color alone for hierarchy. Avoid excessive uppercase outside small section labels.

## Shape

- Toolbar controls: 9-11px radius
- Rows and compact cards: 9-11px radius
- Popovers and modals: 16-18px radius
- Pills and chips: full radius
- Map markers: circular with white ring and soft shadow

## Map UI

The map is the main canvas.

- Keep top overlays minimal: route/team, risk, high issue, GPS state
- Hide secondary details such as distance totals behind secondary pills, hover, or popovers
- Keep bottom legend compact: primary layers visible, secondary layers hidden until needed
- Use glass material for floating map UI
- Keep labels compact and avoid overlapping marker content
- Offset overlapping dots only slightly; never make offset look like false movement

## Density

This is a daily work tool. Favor compact information density:

- Left lists should show many routes/issues without heavy cards
- KPI/stat strips should be compact
- The right inspector can be dense, but section boundaries must remain clear
- Avoid landing-page spacing, oversized headings, and decorative empty space

## Interaction

- Hover: slight tint or shallow lift
- Press: subtle scale/press effect
- Focus: Apple-blue focus ring
- Selection: tint + left rail + restrained ring
- Respect reduced motion

## Copy And Language

Use concise Indonesian operational language. Keep terminology consistent:

- Tinggi, Sedang, Rendah for severity labels
- Routes, Issues may remain as product navigation labels if already established
- Avoid mixing multiple terms for the same state
- Put secondary explanations in tooltips or popovers, not always-visible helper text

