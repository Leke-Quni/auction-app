# Design system

The visual rules for the storefront (`apps/web`) and the admin (`apps/admin`). `docs/DESIGN.md` is the product and architecture spec and stays the source of truth for decisions; this file describes how they are built. Direction chosen by the owner on 2026-11-11: "B, soft modern" (see "Visual style" in `DESIGN.md`).

## Where things live
- Colours, radius and dark mode: the `@theme` block and the `prefers-color-scheme: dark` block in each app's `app/globals.css`. Components use token classes (`bg-surface`, `text-muted`, `border-line`), never raw hex values or `bg-white` / `text-white`.
- Fonts: `next/font/google` in each root `layout.tsx` (storefront Plus Jakarta Sans, admin Inter), exposed as `--font-body`.
- Shared primitives: `packages/ui` (`Button`, `cn`). It has a `components.json` for the shadcn CLI (base: Base UI, style `base-nova`), with `@auction/ui/*` mapped to `packages/ui/src/*`.

## Storefront tokens (light)
| Role | Token | Value |
| --- | --- | --- |
| Page / card surface | `page` / `surface` | `#faf8f5` / `#ffffff` |
| Text, secondary, tertiary | `ink`, `muted`, `subtle`, `faint` | `#1f2328`, `#645f58`, `#55504a`, `#7a746b` |
| Lines, input border | `line`, `field` | `#e7e1d8`, `#8d867b` |
| Table heads, hover, chips | `head`, `head-hover`, `chip`, `soft` | warm greys |
| Brand | `brand`, `brand-dark`, `on-brand` | `#0f766e`, `#0b5f58`, `#ffffff` |
| Urgency and time | `urgent`, `time-ok`, `time-warn` | `#b42318`, `#15803d`, `#b45309` |

Countdown colour rule (unchanged): green above 50% of the time left, orange from 50% to 10%, red at 10% or less. Brand teal is for links and primary buttons only; urgency has its own reds and oranges.

## Admin tokens
Light, near-white sidebar (`side` `#f4f3f0`), indigo accent (`#4f46e5`), amber, blue, green and red status pills with a tinted background (`*-soft`) and dark text. Radius 8px.

## Shape, type, motion
- Radius: `--radius-card` 12px (cards, notices, menus, tables) and `--radius-control` 8px (inputs, buttons) in the storefront; 8px for everything in the admin. Pills and avatars use `rounded-full`.
- Type: 13px body with tabular numbers wherever digits line up (prices, countdowns, tables). Fields are 16px on phones and touch screens so iOS does not zoom.
- Tap targets: links and buttons in the header, footer and filters are at least 24px tall.
- Icons: `lucide-react`, 24px, stroke 1.8, always `aria-hidden` with a text label on the button.
- Motion: the `motion` package, inside `MotionConfig reducedMotion="user"`. Used only for toasts sliding in; the countdown bar and hover shadows are CSS. Animate opacity and transform only.

## Dark mode
Follows the device setting (`prefers-color-scheme`); there is no switch. The same token names get other values: surface `#151c25` on page `#0e1319`, luminous teal `#2dd4bf` with dark text on it (`on-brand`), and lighter reds, ambers and greens. Admin uses a dark slate set with indigo `#818cf8`. Never write a colour that works in only one theme.

## Using shadcn components
Run the CLI from `packages/ui`. The storefront's `globals.css` maps shadcn's names (`primary`, `background`, `card`, `border`, `destructive`, ...) onto our tokens. Two names are left out on purpose: `muted` is a text colour here and `accent` is the admin's indigo, so check any component that uses `bg-muted` or `bg-accent`.

## Accessibility rules
- Contrast: body and small text 4.5:1; input borders `#8d867b` give about 3.4:1 on the page colour.
- Every field has a label or `aria-label`; each page has one `h1` and a unique `<title>`; a skip link leads to `#main`.
- Search is a combobox with a listbox; sliders show a focus ring; motion respects reduced-motion.

## Not done yet
- Admin layout density (it only has B's colours, fonts and corners).
- A dark-mode switch, and checking dark mode on every signed-in page.
- Charts for the admin (no chart library chosen).
