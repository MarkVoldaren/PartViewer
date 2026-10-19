# UI/UX review

## Implemented

- Shared light and dark palettes for explorer, request intake, queue, import screens and sign-in. The toggle starts from the system preference, remembers explicit choices and supports storage being unavailable.
- Neutral navy surfaces and a teal action color; semantic warning, error, success and reference colors adapt to both themes.
- Stronger page hierarchy, segmented navigation, larger form controls, consistent rounded panels and quieter surface borders.
- Responsive navigation wrapping, more readable data tables, sticky request selection cells and clearer explorer guidance.
- Keyboard skip link, visible focus indicators, current-page navigation semantics and reduced-motion support.

## Proposed next improvements

1. **Simplify the request queue.** Show request number, customer/part, scope, age, urgency and status by default. Move approval flags, historical snapshots and notes into an expandable row or detail drawer. Keep CSV export for full records. The current 1,700px minimum table makes frequent horizontal scrolling necessary.
2. **Make readiness actionable.** Put readiness totals before the assembly tree, with filters for blocked assemblies and direct links to the relevant work-order card. Preserve independent assembly status and incomplete-estimate warnings.
3. **Improve part lookup.** Add keyboard arrow navigation, Escape dismissal, explicit loading feedback and recently reviewed parts. Keep internal ID and item classification visible in results.
4. **Preview imports before replacement.** Summarize file roles, row counts, validation findings and differences from the current snapshot before the existing replace action. Show last successful import and a clear recovery path on errors.
5. **Reduce request-entry effort.** Make the wizard progress steps navigable with validation, focus the first invalid field and show a compact persistent summary of selected part and customer. Consider draft recovery for interrupted work.

## Validation

Production TypeScript/Vite build passed. Browser visual verification is still required for populated request, assembly and import states at desktop and mobile sizes in both themes.
