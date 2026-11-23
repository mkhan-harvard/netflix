# Muhammed Khan: portfolio and VBR Lab

Personal site of Muhammed Khan, plus **VBR Lab**, an in-browser simulator of adaptive bitrate (ABR) decisions for live streaming.

## VBR Lab

Netflix moved every Live event to capped VBR encoding on January 26, 2026 and said its next step is testing ABR algorithms that use the actual sizes of upcoming segments instead of nominal bitrates ([Netflix TechBlog, April 2026](https://netflixtechblog.com/smarter-live-streaming-at-scale-rolling-out-vbr-for-all-netflix-live-events-c8f833b238cc)). VBR Lab asks what that is worth to a single player.

Two simulated players watch the same live event over the same network with the **same decision rule**. The only difference is what each believes the next segments cost:

- **Nominal**: every segment costs its label bitrate.
- **Size-aware**: uses the real size of each upcoming segment that has already been published; past the live edge it assumes the latest real-to-nominal ratio, never below nominal.

A third, **buffer-based** player is an outside reference: BBA-0 from Huang et al., ["A Buffer-Based Approach to Rate Adaptation"](https://web.stanford.edu/class/cs244/papers/sigcomm2014-video.pdf) (SIGCOMM 2014, Stanford and Netflix). It ignores throughput and maps buffer level to bitrate: lowest rung at or below 2 s, highest from 7 s, linear in between, with the paper's hysteresis. The paper reached the top rung at 90% of a 240 s buffer; these thresholds are set the same way from the 8 s live cap.

The shared rule plays the next 3 segments forward at 90% of estimated throughput (harmonic mean of the last 5 downloads) and picks the highest rung that keeps the buffer above 2.5 s, stepping up at most one rung at a time with 2 s of extra margin.

### Model

| Piece | Choice |
| --- | --- |
| Ladder | 6 rungs, 400 kbps to 8 Mbps, illustrative quality score per rung |
| Segments | 2 s |
| Capped VBR | size follows scene complexity, capped at 1.6x nominal; higher rungs swing more |
| CBR | within ±10% of nominal |
| Live | player starts 4 segments behind the live edge and cannot fetch future segments |
| Networks | synthetic traces: steady Wi-Fi, busy evening Wi-Fi, LTE with drops |

Everything is synthetic and simplified. The quality score is not VMAF, there is one viewer and no server-side capacity model, and it assumes the server can report sizes of already-encoded segments.

### Check it yourself

- Switch the encoding to **CBR**: both players behave almost identically, as they should when labels match reality. A unit test enforces this.
- Results for one seed vary; the lab always shows a 50-seed average next to the single run.
- The buffer-based player gives the highest quality on Wi-Fi (and the fewest switches on steady Wi-Fi), but stalls three to six times as long on LTE: an 8 s live buffer leaves a buffer-only signal little time to react.

## Design

Every page is a sheet in one engineering drawing set: a frame with grid zones, the same menu on every sheet, and a title block that doubles as the contact section. The typeface is B612, designed for aircraft cockpit displays.

## Run locally

The pages use ES modules, so open them through a local server, not by double-clicking:

```bash
npx serve .            # or: python3 -m http.server
npm test               # 10 unit tests (Node 18+)
npm run check          # lists any placeholder text left on the site
```

## Files

```
index.html            portfolio home
vbr-lab/index.html    the lab with write-up
netflix/index.html    lab with a note for a Netflix application (unlisted)
assets/sim.js         simulation engine, no DOM, fully tested
assets/lab.js         UI: controls, SVG charts, tables
assets/style.css      shared styles: whiteprint (light) and blueprint (dark)
assets/fonts/         B612 typeface, self-hosted (SIL Open Font License)
tests/sim.test.js     unit tests
```
