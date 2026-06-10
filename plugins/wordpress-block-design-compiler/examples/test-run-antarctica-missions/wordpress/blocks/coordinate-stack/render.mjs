export function render(attrs, helpers) {
  const { classList, richText, tag } = helpers;
  const items = Array.isArray(attrs.items) && attrs.items.length ? attrs.items : [];
  return tag('div', { class: classList('wp-block-wbdc-coordinate-stack', 'coordinate-stack', attrs.className), 'aria-label': attrs.ariaLabel || 'Current mission coordinates' },
    items.map((item) => tag('p', {}, tag('span', {}, richText(item.label || '')) + ' ' + richText(item.value || ''))).join('')
  );
}
