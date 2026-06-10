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

The current POC asks the LLM to choose an ordered repair bundle per pass: a full simplified block tree, a small additive vision CSS stylesheet, a complete replacement vision CSS stylesheet, or a full rendered HTML document as a rare escape hatch. A bundle can contain multiple artifacts when the visual mismatch needs coordinated structure and styling changes. The deterministic proxy still supports older local patch actions for cheap debugging.

## Repair Rules

- Work large to small: semantic/content failures, macro section layout and grid geometry, responsive structure, component scale/selector failures, then fine spacing/color/typography polish.
- Do not spend a pass on fine spacing while an obvious issue remains, such as an asymmetric source grid becoming symmetric, escaped markup, missing form semantics, missing content, or a giant mislabeled component.
- Choose up to four ordered repair artifacts: `block-tree`, `vision-css-addition`, `vision-css`, or `rendered-html`.
- Prefer `block-tree` when composition, editable content, wrappers, core/custom block choices, forms, or escaped markup are wrong.
- Use `vision-css-addition` when the block structure is semantically correct and the remaining discrepancy is a small styling refinement.
- Use `vision-css` only when the block structure is semantically correct and prior vision CSS needs complete replacement.
- Use `rendered-html` only as an explicitly justified escape hatch.
- Prefer core block structure, block attributes, and block supports before custom blocks.
- Use custom blocks only for the smallest subtree that needs a custom editor model, behavior, or markup contract.
- Preserve editable rich text, links, form labels/placeholders, repeated items, and inspector controls.
- Do not use raw HTML blocks unless the plan explains why core/custom static blocks cannot preserve both fidelity and editability.
- If escaped markup is visible in the browser, repair the block tree or block attributes rather than styling the text to look less wrong.
- Keep regenerated artifacts scoped to the observed discrepancy.
- Treat the repair pass limit as a ceiling, not a target.
- Regressed candidates are rejected. When passes remain, the next repair should restart from the best measured pass and choose a different high-leverage bundle.
- Stop after the configured repair pass limit or earlier when visual drift is acceptable.

## Output

Return a repair proposal with:

- observed discrepancy
- likely cause in block tree, block wrapper DOM, CSS cascade, responsive behavior, or missing custom block
- tasks: concrete ordered task list, each with issue, target, repair artifact, exact fix, and verification check
- artifact: `block-tree`, `vision-css-addition`, `vision-css`, or `rendered-html`
- content: full replacement artifact for block-tree, vision-css, and rendered-html; additive scoped CSS for vision-css-addition
- preferred production repair location
- expected visual effect
- editability risk
