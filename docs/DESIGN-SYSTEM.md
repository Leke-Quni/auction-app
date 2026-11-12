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
The storefront follows the device setting (`prefers-color-scheme`) unless the visitor picks Light or Dark with the System / Light / Dark switch in the header (2026-11-12, owner's request, first in the footer and moved up; `apps/web/app/theme-switch.tsx`). Below 400px wide the three buttons become one that steps through the choices, so the header stays on two rows. The choice is kept in this browser's `localStorage` (`theme`; System is no entry), applied as `data-theme` on `<html>` by a small script in the layout's `<head>` before the page paints, and the dark tokens live in two blocks in `globals.css` that a test keeps identical. The admin app has no switch yet and still follows the device. The same token names get other values: surface `#151c25` on page `#0e1319`, luminous teal `#2dd4bf` with dark text on it (`on-brand`), and lighter reds, ambers and greens. Admin uses a dark slate set with indigo `#818cf8`. Never write a colour that works in only one theme.

## Using shadcn components
Run the CLI from `packages/ui`. The storefront's `globals.css` maps shadcn's names (`primary`, `background`, `card`, `border`, `destructive`, ...) onto our tokens. Two names are left out on purpose: `muted` is a text colour here and `accent` is the admin's indigo, so check any component that uses `bg-muted` or `bg-accent`.

## Accessibility rules
- Contrast: body and small text 4.5:1; input borders `#8d867b` give about 3.4:1 on the page colour.
- Every field has a label or `aria-label`; each page has one `h1` and a unique `<title>`; a skip link leads to `#main`.
- Search is a combobox with a listbox; sliders show a focus ring; motion respects reduced-motion.

## Not done yet
- Admin layout density (it only has B's colours, fonts and corners).
- A theme switch in the admin app, and checking dark mode on every signed-in page.
- Charts for the admin (no chart library chosen).

## How the restyle was done
- Restyle step 1 (decided 2026-11-11, owner picked direction "B, soft modern" from clickable prototypes): warm off-white page and warm grey lines, Plus Jakarta Sans (storefront) and Inter (admin) through `next/font`, a quiet light admin sidebar, and darker text and urgency colours for contrast. Colours are tokens in each app's `globals.css`; the storefront's hardcoded hex values became tokens first. Step 2 (2026-11-11): storefront cards, inputs and buttons have rounded corners (`--radius-card` 12px, `--radius-control` 8px in `apps/web/app/globals.css`), and the header is white with a teal logo, a pill search box and a teal Sign up button; facts tables are rounded too. Step 3 (2026-11-11): fields are 16px on phones and touch screens (iOS does not zoom), header, footer and filter links and buttons are at least 24px tall, listing cards have roomier padding, a larger price and a soft hover shadow. Step 4 (2026-11-11): the home and search pages are wider (up to 72rem) with the filter sidebar as its own column from 900px up (it used to sit in the left margin from 1180px) and bigger photo cards; other pages keep the narrow column. Step 5 (2026-11-11): dark mode follows the device setting, icons are `lucide-react`, toasts animate with `motion`, `packages/ui` is set up for the shadcn CLI, and the visual rules are written down in `docs/DESIGN-SYSTEM.md`. Admin radius: every rounded box and control in the admin is 8px (`--radius-control` in `apps/admin/app/globals.css`). The admin was changed without a signed-in look; the owner checks it after the restyle is finished. The dense, information-first layout stays until then.
