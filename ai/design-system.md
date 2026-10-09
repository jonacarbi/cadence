# Design system

Source: `site/style.css`. The Mac app and web UI use the same tokens (Agent B).

| Token | Light | Dark |
|---|---|---|
| paper | #F3EFE6 | #121110 |
| ink | #17140F | #EDE8DE |
| beat | #E5482B | #FF6A4A |
| staff | #D9D2C3 | #2A2724 |
| muted | #6B645A | #9A9286 |
| ok | #2F7D4F | not set |
| warn | #B7791F | not set |

Type: Newsreader (display, serif) and Hanken Grotesk (UI, tabular-nums). Weights 400, 500, italic 400.

Rules: one accent (beat). Radius 6px everywhere. Rules and measure lines use staff. Motion is one beat pulse on the hero dot; disabled under `prefers-reduced-motion`. Dark follows the system, with a manual toggle stored in localStorage.

Layout: max width 1280px, fluid gutter `clamp(16px,4vw,48px)`. Two-column breakpoint at 760px.
