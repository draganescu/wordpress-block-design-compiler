# LLM Vision Repair Brief

Use this brief shape for the brokered LLM call. The POC can call OpenAI directly with:

```bash
npm run poc:transform:openai
```

The OpenAI API key is read from the process environment or local env files such as `.env.local`.

## Inputs

- Source mockup HTML: `mockup/index.html`
- Initial rendered block HTML: `rendered/rendered-blocks.base.html`
- Final rendered block HTML from current POC loop: `rendered/rendered-blocks.html`
- Block tree: `wordpress/block-tree.json`
- Block implementation plan: `plan/block-implementation-plan.json`
- Screenshots and diffs: see `vision/pass-*/`

## Role

Interpret the visual differences between the mockup screenshot, rendered block screenshot, and PNG diff. The PNG diff is a measurement signal, not the diagnosis.

The current POC applies only scoped CSS from the returned proposal. The production implementation should apply the same diagnosis to the correct repair location: core block structure, block attributes/supports, custom static block source, or narrow bridge CSS.

## Repair Rules

- Prefer core block structure, block attributes, and block supports before custom blocks.
- Use custom blocks only for the smallest subtree that needs a custom editor model, behavior, or markup contract.
- Preserve editable rich text, links, form labels/placeholders, repeated items, and inspector controls.
- Do not use raw HTML blocks unless the plan explains why core/custom static blocks cannot preserve both fidelity and editability.
- Keep repairs scoped to the observed discrepancy.
- Stop after one to three repair passes, or earlier when visual drift is acceptable.

## Output

Return a repair proposal with:

- observed discrepancy
- likely cause in block tree, block wrapper DOM, CSS cascade, responsive behavior, or missing custom block
- scoped CSS patch for this POC
- preferred production repair location
- expected visual effect
- editability risk
