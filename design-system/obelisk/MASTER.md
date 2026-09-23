# Obelisk design system (master)

Sources: the brand logo and banner, plus `ui-ux-pro-max` recommendations (Trust & Authority pattern,
Minimalism / Swiss style, subtle motion, spacious density). The skill's suggested palette
(navy / gold / purple) was **rejected** because it clashed with the brand; colors come from the brand assets.

## Hard rules (owner decision, 23 Sep 2026)
The site must never look "vibe coded". Never use:
- purple or pink gradients
- pill-shaped buttons (buttons, tabs, chips and badges use at most a 3px radius)
- fake testimonials or reviews, or fake or placeholder numbers (only real numbers from the chain or database)
- vague hero copy; say concretely what the product does
- em dashes in site copy, page titles or messages the user signs
- emoji as icons (use SVG)
- Indonesian text anywhere a user or a repository visitor can see it

## Audience and tone
General users, in English. Calm and confident, no jargon on the surface.
Technical terms (TEE, ZK) belong in the "under the hood" and security sections.

## Visual direction (owner decision, 23 Sep 2026)
Palette and layout follow Hirael "Agency Landing" (MIT): light, navy, orange accent.
A light hero with an orange flow and fluted glass (our own WebGL shader with a CSS fallback),
numbered sections alternating white and gray, and a navy CTA band and footer with a giant wordmark.

## Colors
| Token | Value | Use |
|---|---|---|
| `--bg` | `#FFFFFF` | main sections |
| `--surface-2` | `#F5F5F5` | alternating sections, cards |
| `--hero` | `#EFEFEF` | hero background |
| `--ink` | `#111827` | main text (gray-900) |
| `--muted` | `#5F6368` | secondary text (6.3:1 contrast) |
| `--line` | `#E5E5E5` | 1px lines |
| `--accent` | `#F26522` | primary CTA, markers, heading accents |
| `--navy` | `#1A1D2E` | CTA band and footer (`.dark`) |
| status | ok `#15803D` / warn `#A16207` / bad `#B91C1C` | log labels |

## Typography
- Headings and UI: **Inter** medium, tight tracking (-0.025 to -0.035em)
- Onchain data: **JetBrains Mono**
- No serif headings

## Signature elements
- Numbered section labels: a dark number box plus a bordered label, 3px corners.
- Action buttons: text that rolls on hover plus a white arrow box, 3px corners.
- Radius: landing cards 12 to 14px, nav bar 10px; buttons, tabs, chips, badges and app cards 3px. No pill shapes.
- The white fact chip with a shadow is only for provable claims (it links to a real transaction).
- Product visuals (vault preview, proof pipeline, attack replay) only show real data from the chain.

## Spacing and layout
Spacious: section padding 96 to 144px on desktop, 64 to 80px on mobile. Max container 1120px, 20px gutter.

## Motion
Subtle: fade plus a 12px translateY, 300 to 400ms, ease-out. Everything is disabled under `prefers-reduced-motion`.

## Checklist (ui-ux-pro-max)
- [ ] Text contrast at least 4.5:1 (dark and light)
- [ ] Visible focus (2px outline)
- [ ] Touch targets at least 44px
- [ ] SVG icons, no emoji
- [ ] Responsive at 375 / 768 / 1024 / 1440, no horizontal scroll
- [ ] Hero images use next/image priority, CLS < 0.1
- [ ] reduced-motion respected
