export function render(attrs, helpers) {
  const { classList, richText, tag } = helpers;
  const layers = Array.isArray(attrs.layers) ? attrs.layers : [];
  const layerHtml = layers.map((layer) => tag('div', {
    class: classList('slice', layer.className),
  }, tag('span', {}, richText(layer.label || '')))).join('');
  return tag('figure', { class: classList('wp-block-wbdc-dam-cross-section', 'dam-cross-section', attrs.className), 'aria-label': attrs.ariaLabel || '' },
    layerHtml + tag('figcaption', {}, richText(attrs.caption || ''))
  );
}
