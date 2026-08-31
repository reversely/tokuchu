# Tokuchu design language

Taken from the organizer-flow mockup (`docs/rsvp-organizer-flow.html`, local): layout and colour only. Data, copy, and field lists come from `docs/prd.md`.

## Tokens

| Token | Value | Role |
| --- | --- | --- |
| `--night` | `#0B1020` | the top band and the page ground behind the sheet |
| `--night-2` | `#141A2E` | dark cards (order summary, invite preview) |
| `--night-line` | `rgba(255,255,255,.12)` | hairlines on dark surfaces |
| `--night-text` | `#EEF2F8` | text on dark surfaces |
| `--night-muted` | `#9AA5B8` | secondary text on dark surfaces |
| `--white` | `#FFFFFF` | the sheet |
| `--ink` | `#14213D` | headings and body on the sheet |
| `--muted` | `#5B6474` | labels, captions, eyebrows |
| `--line` | `#DCE3EC` | hairlines and input borders on the sheet |
| `--pale` | `#EAF3FC` | chip and tag fill, the agent bar background |
| `--sky` | `#4DA3E8` | the one primary action, active toggles, selected outlines |
| `--sky-dark` | `#2F86CF` | primary hover, links |
| `--navy` | `#0B3D6E` | tab pill fill, tag text, brand |
| `--skel` | `#E7EAEE` | image placeholders |
| radii | 36px sheet, 22px large cards, 16px cards, 12px inputs, 999px pills | |

## Type

Google Fonts: Zilla Slab 500 and 600 for the brand, h1, h2, and the big numerals; Inter 400, 500, 600 for everything else. h1 44px at line-height 1.1; section h2 22px; lead paragraph 18px in `--muted`; labels 14px 500 in `--muted`; eyebrows 13px 600 uppercase with 0.04em tracking.

## Layout

- Top band: `--night`, 22px by 48px padding, brand left, tab pill in the middle (published only), status pill and the primary action right; sticky.
- The sheet: white, radius 36px on the top corners, overlapping the band; content grid `minmax(0, 1.25fr) minmax(300px, .9fr)` with a 40px gap and 40px side padding, max width 1360px; the right column sticky at 96px.
- Draft: one heading, one lead sentence, then the sections Details, RSVP questions, Settings, each with an eyebrow on the right; the invite preview in the right column as a dark card; the publish action repeated at the foot with the sentence saying what publishing does.
- Published: the same page with Overview and Guest Experience tabs; Overview shows four stat cards, follow-up rows with one pill action each, the guest table, the gift summary, then the editable setup sections; the order summary as a dark card on the right.
- Guest Experience: a four-segment progress bar, one question as the h1, one lead sentence, four category cards with image placeholders, the sentence box as a pill with a Go button, a quiet "Not now".
- Toast: navy pill at the foot centre for the publish confirmation.

## Rules kept from the house UI skill

No filler labels, no themed copy for standard actions, no glyphs as icons, no fabricated data in empty states. None of the mockup's copy, names, or values carries over; every string on a page is written for the page from the PRD. The light-enterprise-ui tokens do not apply here; this file replaces them for the tokuchu app.
