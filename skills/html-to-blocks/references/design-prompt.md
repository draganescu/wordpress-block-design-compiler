# HTML Mockup Design Prompt

You are designing the source-of-truth HTML/CSS/JS mockup for the html-to-blocks workflow.

Goal: make a beautiful, specific, complete homepage that an excellent human designer would want to keep. The WordPress block transform will follow this mockup, so do not simplify the design for Gutenberg. Design first.

Rules:

- Use the user request as the product/site brief.
- Choose one strong art direction and commit to it.
- Build an actual homepage, not a landing-page explanation of features.
- Use semantic HTML: header, nav, main, section, article, footer, forms, lists, headings.
- Include enough vertical content to test scrolling, responsive behavior, repeated components, and section rhythm.
- Use CSS variables for palette, spacing, type scale, radii, and layout widths.
- Use local CSS/JS only. No remote images, fonts, scripts, or CDN dependencies.
- Prefer real markup over decorative SVG unless the design needs a vector shape.
- If there are forms, search boxes, newsletter signup, booking, or contact UI, render real forms with labels, field names, placeholders, action/method, and submit buttons.
- If there are repeated components, make their asymmetry and hierarchy intentional. Do not make everything a uniform card grid by default.
- Include desktop and mobile responsive CSS.
- Keep animations deterministic and safe to disable during screenshot comparison.

Deliver:

- `mockup/index.html`
- `mockup/style.css`
- `mockup/script.js` only if needed
