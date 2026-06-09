# Transform POC Report

## Summary

- Sections analyzed: 5
- Blocks in assembled tree: 28
- Custom blocks: poc/kind-marquee, poc/studio-inquiry

## Section Strategies

- `hero`: core-assembly
  - Core attempt: Core blocks plus custom classes preserve the content model and are sufficient for this section.
- `story`: core-assembly
  - Core attempt: Core blocks plus custom classes preserve the content model and are sufficient for this section.
- `values-marquee`: custom-block (poc/kind-marquee)
  - Core attempt: A static core group could show the words, but editable repeated marquee items, speed, and duplicated track markup need a purpose-built block.
- `collection`: core-assembly
  - Core attempt: Core blocks plus custom classes preserve the content model and are sufficient for this section.
- `inquiry`: custom-block (poc/studio-inquiry)
  - Core attempt: Core blocks can fake the CTA, but the mockup contains structured inputs and submission UI that need explicit fields and controls.

## Outputs

- Mockup: `mockup/index.html`
- Plan: `plan/block-implementation-plan.json`
- Block markup: `wordpress/content.html`
- Rendered HTML: `rendered/rendered-blocks.html`
