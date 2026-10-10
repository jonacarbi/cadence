# Design system

Source: `site/style.css`. The Mac app and web UI use the same tokens (Agent B).

| Token | Light | Dark |
|---|---|---|
| paper | #EEF1F8 | #080B1E |
| raised | #FFFFFF | #10163A |
| ink | #0C1233 | #E8EBF7 |
| signal (site) / beat (app) | #3434E8 | #9499FF |
| beat (site, lime highlight) | #C6F432 | #CFFA45 |
| line / staff | #D3D9E8 | #222A55 |
| muted | #4A5173 | #A0A7CA |
| ok | #0F7A4A | #4CD38E |
| warn | #8A5A00 | #F2C14E |

Type: Funnel Display (display, 400-700) and Onest (UI, 400-600); system mono for code and labels. The app self-hosts both in `server/web/fonts`; the site loads them from Google Fonts.

Rules: indigo ink with one electric indigo signal. Lime is reserved for "the beat": the h1 highlight, the active step dot, the "you" tag and the mark's dot; never for text on light. Dark follows the system, with a manual toggle stored in localStorage. Motion: highlight sweep and the hero stepper (auto-advance stops on interaction, off under `prefers-reduced-motion`).

Layout: max width 1280px, fluid gutter `clamp(16px,4vw,48px)`. Two-column breakpoint at 860px.
